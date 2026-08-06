/**
 * V17-A 流式转录客户端 — UI 无关、SSR 安全、可注入测试的浏览器侧状态机。
 *
 * ## 职责
 *
 * 桥接两类输入到一个受控生命周期：
 *
 * - **上游 PCM chunk**（V16 capture 提供）：`sendChunk` 只接受合法 PCM
 *   字节，本模块不访问 microphone、不采集、不保存 PCM（发送后即丢弃）；
 * - **服务端事件**（V04/V05 语义）：经 `streamingTranscriptionServerMessageSchema`
 *   校验后直接归并进 V05 reducer 快照（**复用**，不复制第二套 reducer），
 *   外部经 `onSnapshot` 拿到组合文本。
 *
 * ## 生命周期与唯一终态
 *
 * - `idle → starting → open → terminal`；`open` 内部记录是否已发出
 *   finish/cancel 终态动作（其后拒绝一切发送）；
 * - 终态只有 `final`（成功）、`failed`（服务端失败事件）、`cancelled`、
 *   `disconnected`、`ticket-failed`、`connection-failed`、`protocol-error`、
 *   `aborted`；final/failed/disconnect/cancel/协议错误/网络错误/AbortSignal
 *   的所有竞争路径**只收敛一次**（`onTerminal` 至多触发一次），与 V12/V13
 *   服务端通道的唯一终态纪律对称；
 * - 收到服务端终态事件后本端立即关闭 socket（服务端随后 close 到达时已
 *   终态，被忽略）。
 *
 * ## 安全纪律
 *
 * - ticket 只出现在 `Sec-WebSocket-Protocol: ticket.<ticket>` 握手子协议，
 *   **不进入 URL**（URL 由注入的 `resolveWsUrl` 生成，且经
 *   `validateStreamingWsUrl` 校验协议/主机/内嵌凭证）且握手后立即丢弃；
 *   长时 bearer 从不进入本模块（ticket 由注入的受认证 client 换取）；
 * - 日志只含受控标签、稳定 code 与 operationId/segmentId：不含 ticket、
 *   bearer、PCM、转录文本、URL 或 stack（服务端错误消息一律不记录）；
 * - 浏览器 API（WebSocket 构造器、ticket client）**构造时注入**，模块顶层
 *   不读取 window/WebSocket，SSR 导入安全；
 * - 发送序列由本端自产自校验：envelope sequence 从 0 严格连续（start 占
 *   0），PCM chunkSequence 独立连续；服务端消息序列违约（跳号、重复、
 *   跨 operation/segment、终态后事件）由 V05 reducer 拒绝并收敛为
 *   protocol-error。
 *
 * ## 与 V17 的分工
 *
 * 本模块不接 composer、不写字幕 UI、不自动发起 Agent Turn、不做任何
 * 重试；V17 负责把 `sendChunk` 接到 V16 capture、把 `onSnapshot` 接到 UI，
 * 并在需要时新建实例重试。
 */

import {
  MAX_PCM_CHUNK_BYTES,
  STREAMING_TRANSCRIPTION_CHANNELS,
  STREAMING_TRANSCRIPTION_PCM_ENCODING,
  STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
  StreamingTranscriptionStateError,
  applyStreamingTranscriptionEvent,
  createStreamingTranscriptionSnapshot,
  streamingTranscriptionProtocolVersion,
  streamingTranscriptionServerMessageSchema,
  type StreamingTranscriptionClientMessage,
  type StreamingTranscriptionFailureCode,
  type StreamingTranscriptionSnapshot,
  type StreamingTranscriptionServerMessage,
} from '@educanvas/agent-core';
import { type StreamingTranscriptionTicketClient } from './streaming-transcription-ticket-client';

/** 客户端阶段：idle（未 start）→ starting（ticket/握手）→ open（可发送）→ terminal。 */
export type StreamingTranscriptionClientPhase =
  'idle' | 'starting' | 'open' | 'terminal';

/**
 * 终态原因（只收敛一次）：
 * - `final`：收到服务端 final 事件；
 * - `failed`：收到服务端 failed 事件（failureCode 非 CANCELLED 或本地未取消）；
 * - `cancelled`：本地已发 cancel 且收到 failed + CANCELLED 确认；
 * - `disconnected`：socket 在未收到终态事件前断开（含本地 disconnect）；
 * - `ticket-failed`：换取握手 ticket 失败；
 * - `connection-failed`：握手失败（open 之前 close/error）；
 * - `protocol-error`：服务端消息非法或事件序列违约；
 * - `aborted`：AbortSignal 触发。
 */
export type StreamingTranscriptionTerminalReason =
  | 'final'
  | 'failed'
  | 'cancelled'
  | 'disconnected'
  | 'ticket-failed'
  | 'connection-failed'
  | 'protocol-error'
  | 'aborted';

/** 客户端稳定错误码；所有拒绝动作抛 `StreamingTranscriptionClientError`。 */
export type StreamingTranscriptionClientErrorCode =
  | 'NOT_STARTED'
  | 'ALREADY_STARTED'
  | 'ALREADY_TERMINAL'
  | 'FINISHED'
  | 'CANCELLED'
  | 'INVALID_PCM'
  | 'TICKET_FAILED'
  | 'CONNECTION_FAILED'
  | 'PROTOCOL_ERROR'
  | 'ABORTED';

/** 终态结果：reason + 可选的领域/客户端/服务端稳定码。 */
export interface StreamingTranscriptionTerminalResult {
  readonly reason: StreamingTranscriptionTerminalReason;
  /** reason === 'failed' 时：V04 稳定失败码。 */
  readonly failureCode?: StreamingTranscriptionFailureCode;
  /** ticket/connection/protocol/abort 类终态的客户端稳定码。 */
  readonly errorCode?: StreamingTranscriptionClientErrorCode;
  /** 服务端传输错误帧（`{ error: { code } }`）携带的稳定码。 */
  readonly serverCode?: string;
}

export interface StreamingTranscriptionClientStatus {
  readonly phase: StreamingTranscriptionClientPhase;
  readonly terminal: StreamingTranscriptionTerminalResult | null;
}

/** 日志条目：只含受控标签与稳定 id/code，绝不含凭证、PCM、文本或 stack。 */
export interface StreamingTranscriptionClientLogEntry {
  readonly label:
    | 'ticket_failed'
    | 'connection_failed'
    | 'socket_error'
    | 'socket_closed'
    | 'message_sent'
    | 'event_applied'
    | 'protocol_rejected'
    | 'terminal';
  readonly code?: string;
  readonly operationId?: string;
  readonly segmentId?: string;
}

export interface StreamingTranscriptionClientOptions {
  /** 受认证 ticket client（V17 注入 BFF 实现；测试注入 fake）。 */
  readonly ticketClient: StreamingTranscriptionTicketClient;
  /**
   * 浏览器 WebSocket 构造器（构造时注入；SSR 导入不读取全局 WebSocket）。
   * 必须是可 `new` 且带静态 OPEN/CONNECTING/CLOSED 常量的构造器。
   */
  readonly WebSocketCtor: typeof WebSocket;
  /**
   * 握手 URL 生成器：只负责 `?notebookId=...`，**不得**包含 ticket
   * （ticket 只走子协议）；由 V17 按部署注入（浏览器侧用 location）。
   * 返回值必须通过 `validateStreamingWsUrl` 校验，否则 start() 以
   * CONNECTION_FAILED 拒绝（凭证投递目标受控）。
   */
  readonly resolveWsUrl: (input: { notebookId: string }) => string;
  /**
   * 允许明文 `ws://` 的 host（含端口，精确匹配）白名单；缺省空数组 =
   * 只接受 `wss://`（生产安全默认）。开发环境显式放行本地地址，例如
   * `['127.0.0.1:8787']`。
   */
  readonly allowedInsecureWsHosts?: readonly string[];
  /** 脱敏日志 sink；缺省静默。 */
  readonly log?: (entry: StreamingTranscriptionClientLogEntry) => void;
  /** operationId 生成（测试注入固定值）；缺省 crypto.randomUUID。 */
  readonly createOperationId?: () => string;
  /** segmentId 生成（测试注入固定值）；缺省 crypto.randomUUID。 */
  readonly createSegmentId?: () => string;
  /** 每次事件归并后的 V05 快照（含组合文本）。 */
  readonly onSnapshot?: (snapshot: StreamingTranscriptionSnapshot) => void;
  /** 阶段/终态变化通知。 */
  readonly onStatus?: (status: StreamingTranscriptionClientStatus) => void;
  /** 终态收敛回调（至多一次）。 */
  readonly onTerminal?: (result: StreamingTranscriptionTerminalResult) => void;
}

/**
 * 客户端动作在非法阶段被拒绝时抛出：只暴露稳定 code，不携带服务端消息、
 * 响应体或 stack。
 */
export class StreamingTranscriptionClientError extends Error {
  override readonly name = 'StreamingTranscriptionClientError';

  constructor(readonly code: StreamingTranscriptionClientErrorCode) {
    super(code);
  }
}

/** 把 PCM 字节编码为 wire 上的严格 base64（纯函数，无环境 API）。 */
export function encodePcmToBase64(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index]!;
    const b1 = bytes[index + 1];
    const b2 = bytes[index + 2];
    result += alphabet[b0 >> 2]!;
    result += alphabet[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)]!;
    result +=
      b1 === undefined
        ? '='
        : alphabet[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)]!;
    result += b2 === undefined ? '=' : alphabet[b2 & 0x3f]!;
  }
  return result;
}

/** WS 握手 URL 校验失败的稳定原因。 */
export type StreamingWsUrlValidationReason =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'embedded-credentials'
  | 'insecure-host-not-allowed';

export type StreamingWsUrlValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: StreamingWsUrlValidationReason };

/**
 * 校验握手 URL 的投递目标（凭证投递安全边界）。一次性 ticket 经子协议
 * 投递，但 URL 仍是配置错误可能把 ticket 带到任意地址的位置：
 *
 * - 只接受 `wss://`（生产），或显式白名单 host 的 `ws://`（本地开发）；
 * - 拒绝 URL 内嵌凭证（userinfo），防止配置把账号/密码拼进地址；
 * - 解析失败（相对路径、非 URL）一律拒绝；
 * - host 白名单按 `host[:port]` 精确匹配，宽松前缀不放行。
 */
export function validateStreamingWsUrl(
  url: string,
  allowedInsecureHosts: readonly string[] = [],
): StreamingWsUrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'embedded-credentials' };
  }
  if (parsed.protocol === 'wss:') return { ok: true };
  if (parsed.protocol !== 'ws:') {
    return { ok: false, reason: 'unsupported-protocol' };
  }
  if (allowedInsecureHosts.includes(parsed.host)) return { ok: true };
  return { ok: false, reason: 'insecure-host-not-allowed' };
}

/** 服务端错误帧形状：`{ error: { code } }`（传输层稳定错误，非 V04 事件）。 */
interface TransportErrorFrame {
  error?: { code?: unknown };
}

/**
 * 单实例单向客户端。每个实例一个会话：ticket 失败或握手失败后进入终态，
 * 重试由调用方新建实例完成（与 V12/V13 服务端"每连接一个通道"对称）。
 */
export class StreamingTranscriptionClient {
  private readonly ticketClient: StreamingTranscriptionTicketClient;
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly resolveWsUrl: (input: { notebookId: string }) => string;
  private readonly log: (entry: StreamingTranscriptionClientLogEntry) => void;
  private readonly createOperationId: () => string;
  private readonly createSegmentId: () => string;
  private readonly onSnapshot?: (
    snapshot: StreamingTranscriptionSnapshot,
  ) => void;
  private readonly onStatus?: (
    status: StreamingTranscriptionClientStatus,
  ) => void;
  private readonly onTerminal?: (
    result: StreamingTranscriptionTerminalResult,
  ) => void;
  private readonly allowedInsecureWsHosts: readonly string[];

  private phase: StreamingTranscriptionClientPhase = 'idle';
  private terminalResult: StreamingTranscriptionTerminalResult | null = null;
  private terminalNotified = false;
  private snapshot: StreamingTranscriptionSnapshot | null = null;
  private socket: WebSocket | null = null;
  private operationId: string | null = null;
  private segmentId: string | null = null;
  /** 下一条 client 消息的 envelope sequence（start 固定 0，此后从 1 起）。 */
  private nextEnvelopeSequence = 1;
  /** 下一条 chunk 消息的独立连续序号（PCM 分片分域，从 0 起）。 */
  private nextChunkSequence = 0;
  private terminalActionSent: 'none' | 'finish' | 'cancel' = 'none';
  /** disconnect() 主动断开中：close 事件由 disconnect 统一收敛，不得抢先终态。 */
  private disconnecting = false;
  private userAbortSignal: AbortSignal | null = null;
  private readonly onAbort = (): void => {
    this.abortRequested();
  };
  private startResolve: (() => void) | null = null;
  private startReject:
    ((error: StreamingTranscriptionClientError) => void) | null = null;

  constructor(options: StreamingTranscriptionClientOptions) {
    this.ticketClient = options.ticketClient;
    this.WebSocketCtor = options.WebSocketCtor;
    this.resolveWsUrl = options.resolveWsUrl;
    this.log = options.log ?? (() => undefined);
    this.allowedInsecureWsHosts = options.allowedInsecureWsHosts ?? [];
    this.createOperationId = options.createOperationId ?? crypto.randomUUID;
    this.createSegmentId = options.createSegmentId ?? crypto.randomUUID;
    this.onSnapshot = options.onSnapshot;
    this.onStatus = options.onStatus;
    this.onTerminal = options.onTerminal;
  }

  /** 当前 V05 归并快照；未 start 或尚未收到事件时为空 operation 快照。 */
  getSnapshot(): StreamingTranscriptionSnapshot {
    if (this.snapshot === null) {
      throw new StreamingTranscriptionClientError('NOT_STARTED');
    }
    return this.snapshot;
  }

  getStatus(): StreamingTranscriptionClientStatus {
    return { phase: this.phase, terminal: this.terminalResult };
  }

  /**
   * 开始会话：换取 ticket → 建立 WebSocket（子协议 `ticket.<ticket>`）→
   * 发送 start。Promise 在 start 消息已写入 socket 后 resolve；
   * ticket 失败/握手失败/被 abort 时 reject 稳定 `StreamingTranscriptionClientError`。
   */
  start(input: { notebookId: string; signal?: AbortSignal }): Promise<void> {
    if (this.phase !== 'idle') {
      return Promise.reject(
        new StreamingTranscriptionClientError('ALREADY_STARTED'),
      );
    }
    if (input.signal?.aborted === true) {
      return Promise.reject(new StreamingTranscriptionClientError('ABORTED'));
    }
    this.phase = 'starting';
    this.userAbortSignal = input.signal ?? null;
    this.userAbortSignal?.addEventListener('abort', this.onAbort);
    const operationId = this.createOperationId();
    const segmentId = this.createSegmentId();
    this.operationId = operationId;
    this.segmentId = segmentId;
    // operation 身份在换取 ticket 前确定：归并快照从第一条事件起就绑定
    // 本会话，跨 operation 的服务端事件会被 reducer 拒绝。
    this.snapshot = createStreamingTranscriptionSnapshot(operationId);
    this.notifyStatus();
    return new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      void this.beginConnect({
        notebookId: input.notebookId,
        operationId,
        segmentId,
      });
    });
  }

  /**
   * 发送一个 PCM 分片（16 kHz / mono / pcm_s16le）。只接受上游合法字节；
   * 非法阶段/字节抛稳定错误。发送后不保留 PCM 副本。
   */
  sendChunk(pcmBytes: Uint8Array): void {
    this.assertSendable();
    if (this.terminalActionSent === 'finish') {
      throw new StreamingTranscriptionClientError('FINISHED');
    }
    if (this.terminalActionSent === 'cancel') {
      throw new StreamingTranscriptionClientError('CANCELLED');
    }
    if (
      pcmBytes.length === 0 ||
      pcmBytes.length % 2 !== 0 ||
      pcmBytes.length > MAX_PCM_CHUNK_BYTES
    ) {
      throw new StreamingTranscriptionClientError('INVALID_PCM');
    }
    const message: StreamingTranscriptionClientMessage = {
      protocolVersion: streamingTranscriptionProtocolVersion,
      operationId: this.operationId!,
      segmentId: this.segmentId!,
      type: 'chunk',
      sequence: this.nextEnvelopeSequence,
      chunkSequence: this.nextChunkSequence,
      sampleRate: STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
      channels: STREAMING_TRANSCRIPTION_CHANNELS,
      encoding: STREAMING_TRANSCRIPTION_PCM_ENCODING,
      // V07 schema（zod v4 instanceof）把 pcmBytes 推断为 Uint8Array<ArrayBuffer>；
      // 调用方可能持有 ArrayBufferLike 后备视图，运行时等价，仅编译期断言。
      pcmBytes: pcmBytes as Uint8Array<ArrayBuffer>,
    };
    this.nextEnvelopeSequence += 1;
    this.nextChunkSequence += 1;
    this.sendWireMessage(message);
  }

  /** 声明输入结束：此后不再发送任何消息，等待最终结果。 */
  finish(): void {
    this.assertSendable();
    if (this.terminalActionSent === 'finish') {
      throw new StreamingTranscriptionClientError('FINISHED');
    }
    if (this.terminalActionSent === 'cancel') {
      throw new StreamingTranscriptionClientError('CANCELLED');
    }
    this.terminalActionSent = 'finish';
    this.sendWireMessage({
      protocolVersion: streamingTranscriptionProtocolVersion,
      operationId: this.operationId!,
      segmentId: this.segmentId!,
      type: 'finish',
      sequence: this.nextEnvelopeSequence,
    });
    this.nextEnvelopeSequence += 1;
  }

  /** 放弃会话：服务端收敛为 failed + CANCELLED 后本端终态为 cancelled。 */
  cancel(): void {
    this.assertSendable();
    if (this.terminalActionSent === 'cancel') {
      throw new StreamingTranscriptionClientError('CANCELLED');
    }
    if (this.terminalActionSent === 'finish') {
      throw new StreamingTranscriptionClientError('FINISHED');
    }
    this.terminalActionSent = 'cancel';
    this.sendWireMessage({
      protocolVersion: streamingTranscriptionProtocolVersion,
      operationId: this.operationId!,
      segmentId: this.segmentId!,
      type: 'cancel',
      sequence: this.nextEnvelopeSequence,
    });
    this.nextEnvelopeSequence += 1;
  }

  /** 主动断开（UI 卸载/用户离开）：本地收敛为 disconnected，不等待服务端。 */
  disconnect(): void {
    if (this.phase === 'terminal') return;
    // 先标记主动断开再关 socket：fake/真实平台的 close 事件可能在
    // closeSocket 内同步派发，必须由本方法收敛终态，不能抢先为其他原因。
    this.disconnecting = true;
    try {
      this.closeSocket(1000);
      if (this.phase === 'starting') {
        this.enterTerminal({ reason: 'disconnected' });
        this.startReject?.(
          new StreamingTranscriptionClientError('NOT_STARTED'),
        );
        this.startReject = null;
        this.startResolve = null;
        return;
      }
      this.enterTerminal({ reason: 'disconnected' });
    } finally {
      this.disconnecting = false;
    }
  }

  /** 发送前阶段校验：terminal 之后任何动作一律拒绝。 */
  private assertSendable(): void {
    if (this.phase === 'terminal') {
      throw new StreamingTranscriptionClientError('ALREADY_TERMINAL');
    }
    if (this.phase !== 'open') {
      throw new StreamingTranscriptionClientError('NOT_STARTED');
    }
  }

  /** ticket 换取 + 握手（start 的异步部分）。任何失败路径都必须收敛终态并拒绝 start。 */
  private async beginConnect(input: {
    notebookId: string;
    operationId: string;
    segmentId: string;
  }): Promise<void> {
    let wsUrl: string;
    try {
      wsUrl = this.resolveWsUrl({ notebookId: input.notebookId });
    } catch {
      // resolveWsUrl 不受保护：一旦抛错，异步任务会被丢弃、start() 的
      // Promise 永不 settle——必须显式收敛为稳定 CONNECTION_FAILED。
      this.connectFailed();
      return;
    }
    // 凭证投递目标受控：协议/主机/内嵌凭证不合法则拒绝连接，不发起任何
    // 网络请求（一次性 ticket 绝不交给校验失败的地址）。
    if (!validateStreamingWsUrl(wsUrl, this.allowedInsecureWsHosts).ok) {
      this.connectFailed();
      return;
    }
    // ticket 只在握手子协议中出现一次：换取后立即消费，不保存到字段。
    let ticket: string;
    try {
      const grant = await this.ticketClient.requestTicket({
        notebookId: input.notebookId,
        signal: this.userAbortSignal ?? undefined,
      });
      ticket = grant.ticket;
    } catch {
      if (this.phase === 'terminal') return; // abort 已收敛
      this.log({ label: 'ticket_failed', code: 'TICKET_FAILED' });
      this.enterTerminal({
        reason: 'ticket-failed',
        errorCode: 'TICKET_FAILED',
      });
      this.rejectStart(new StreamingTranscriptionClientError('TICKET_FAILED'));
      return;
    }
    if (this.phase === 'terminal') return; // abort 在换取期间触发
    let socket: WebSocket;
    try {
      // 子协议数组：服务端 handleProtocols 只接受 ticket.*（fail-closed）。
      socket = new this.WebSocketCtor(wsUrl, [`ticket.${ticket}`]);
    } catch {
      this.connectFailed();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.phase === 'terminal') return;
      // 首条 start 的写入是握手的一部分：失败说明服务端没有会话，必须
      // 拒绝 start() 并进入终态，绝不能报告连接成功。
      if (
        !this.sendWireMessage({
          protocolVersion: streamingTranscriptionProtocolVersion,
          operationId: input.operationId,
          segmentId: input.segmentId,
          type: 'start',
          sequence: 0,
          sampleRate: STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
          channels: STREAMING_TRANSCRIPTION_CHANNELS,
          encoding: STREAMING_TRANSCRIPTION_PCM_ENCODING,
        })
      ) {
        this.connectFailed();
        this.closeSocket(1000);
        return;
      }
      this.phase = 'open';
      this.notifyStatus();
      const resolve = this.startResolve;
      this.startResolve = null;
      this.startReject = null;
      resolve?.();
    });
    socket.addEventListener('message', (event) => {
      this.handleServerFrame(event);
    });
    socket.addEventListener('close', () => {
      this.handleSocketClose();
    });
    socket.addEventListener('error', () => {
      this.log({ label: 'socket_error' });
      // 网络错误立即收敛（close 事件随后到达时已被终态守卫忽略），保证
      // "网络错误只收敛一次"。
      if (this.phase === 'starting') {
        this.connectFailed();
      } else if (this.phase === 'open') {
        this.enterTerminal({ reason: 'disconnected' });
      }
    });
  }

  /** 处理一条服务端文本帧：传输错误帧 / V04 事件（schema + reducer 双保险）。 */
  private handleServerFrame(event: MessageEvent): void {
    if (this.phase === 'terminal') return;
    if (typeof event.data !== 'string') {
      this.protocolError();
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      this.protocolError();
      return;
    }
    // 传输层稳定错误帧（配额/协议违约等），非 V04 事件。
    const frame = parsed as TransportErrorFrame;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'error' in (parsed as object) &&
      typeof frame.error === 'object' &&
      frame.error !== null
    ) {
      const code =
        typeof frame.error.code === 'string' ? frame.error.code : undefined;
      this.log({ label: 'protocol_rejected', code });
      this.enterTerminal({
        reason: 'protocol-error',
        errorCode: 'PROTOCOL_ERROR',
        ...(code !== undefined ? { serverCode: code } : {}),
      });
      this.closeSocket(1008);
      return;
    }
    const result = streamingTranscriptionServerMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.protocolError();
      return;
    }
    this.applyServerEvent(result.data);
  }

  /** 归并合法事件到 V05 reducer；违约（含跨 operation/序列违规）→ 协议错误。 */
  private applyServerEvent(event: StreamingTranscriptionServerMessage): void {
    try {
      this.snapshot = applyStreamingTranscriptionEvent(this.snapshot!, event);
    } catch (error) {
      if (error instanceof StreamingTranscriptionStateError) {
        this.protocolError();
        return;
      }
      // 非预期异常（纯归并层理论上不会发生）也收敛为稳定协议错误，绝不
      // 把未知错误带出。
      this.protocolError();
      return;
    }
    this.log({
      label: 'event_applied',
      operationId: event.operationId,
      segmentId: event.segmentId,
    });
    this.onSnapshot?.(this.snapshot!);
    if (event.type === 'final' || event.type === 'failed') {
      const result: StreamingTranscriptionTerminalResult =
        event.type === 'final'
          ? { reason: 'final' }
          : event.failureCode === 'CANCELLED' &&
              this.terminalActionSent === 'cancel'
            ? { reason: 'cancelled', failureCode: event.failureCode }
            : { reason: 'failed', failureCode: event.failureCode };
      // 先确立终态再关闭：close 事件可能同步派发（fake 平台），若先关
      // socket 会把终态错误收敛为 disconnected。服务端终态后主动关闭与
      // 服务端自身的 close(1000) 对称。
      this.enterTerminal(result);
      this.closeSocket(1000);
    }
  }

  /** socket 关闭：未收到终态事件前断开一律收敛为 disconnected（或连接失败）。 */
  private handleSocketClose(): void {
    this.log({ label: 'socket_closed' });
    if (this.phase === 'terminal') return;
    if (this.disconnecting) return; // 主动断开由 disconnect() 统一收敛。
    if (this.phase === 'starting') {
      this.enterTerminal({
        reason: 'connection-failed',
        errorCode: 'CONNECTION_FAILED',
      });
      this.startReject?.(
        new StreamingTranscriptionClientError('CONNECTION_FAILED'),
      );
      this.startReject = null;
      this.startResolve = null;
      return;
    }
    this.enterTerminal({ reason: 'disconnected' });
  }

  /** AbortSignal 触发：任意阶段中止会话并收敛为 aborted（不依赖服务端）。 */
  private abortRequested(): void {
    if (this.phase === 'terminal') return;
    // 先确立终态再关闭：close 事件可能同步派发，不能让它抢先收敛。
    this.enterTerminal({ reason: 'aborted', errorCode: 'ABORTED' });
    this.closeSocket(1000);
    if (this.startReject !== null) {
      this.startReject(new StreamingTranscriptionClientError('ABORTED'));
      this.startReject = null;
      this.startResolve = null;
    }
  }

  /** 服务端消息非法/序列违约：稳定日志 + 终态 + 1008 关闭，绝不记录原文。 */
  private protocolError(): void {
    this.log({ label: 'protocol_rejected' });
    this.enterTerminal({
      reason: 'protocol-error',
      errorCode: 'PROTOCOL_ERROR',
    });
    this.closeSocket(1008);
  }

  /** 握手失败统一收敛：稳定日志 + 终态 + 拒绝 start()。 */
  private connectFailed(): void {
    this.log({ label: 'connection_failed', code: 'CONNECTION_FAILED' });
    this.enterTerminal({
      reason: 'connection-failed',
      errorCode: 'CONNECTION_FAILED',
    });
    this.rejectStart(
      new StreamingTranscriptionClientError('CONNECTION_FAILED'),
    );
  }

  /** 拒绝未决的 start() promise（幂等：只 settle 一次）。 */
  private rejectStart(error: StreamingTranscriptionClientError): void {
    const reject = this.startReject;
    this.startReject = null;
    this.startResolve = null;
    reject?.(error);
  }

  /** 序列化为 wire 帧并发送（chunk 的 pcmBytes 转 base64）；返回是否成功写出。 */
  private sendWireMessage(
    message: StreamingTranscriptionClientMessage,
  ): boolean {
    const raw =
      message.type === 'chunk'
        ? JSON.stringify({
            ...message,
            pcmBytes: encodePcmToBase64(message.pcmBytes),
          })
        : JSON.stringify(message);
    this.log({
      label: 'message_sent',
      operationId: message.operationId,
      segmentId: message.segmentId,
    });
    try {
      if (!this.socket || this.socket.readyState !== this.WebSocketCtor.OPEN) {
        throw new Error('socket not open');
      }
      this.socket.send(raw);
      return true;
    } catch {
      // 发送失败（连接已断）：open 阶段本地收敛 disconnected，不把原始
      // 错误带出；starting 阶段（首条 start 写入）由调用方按握手失败收敛。
      if (this.phase === 'open') {
        this.enterTerminal({ reason: 'disconnected' });
      }
      return false;
    }
  }

  private closeSocket(code: number): void {
    const socket = this.socket;
    if (socket === null) return;
    this.socket = null;
    try {
      if (socket.readyState === this.WebSocketCtor.OPEN) socket.close(code);
      else if (socket.readyState === this.WebSocketCtor.CONNECTING) {
        // 浏览器 WebSocket 无 terminate；Fake/Node 实现可选提供。
        (socket as unknown as { terminate?: () => void }).terminate?.();
      }
    } catch {
      // 关闭失败不影响终态收敛。
    }
  }

  /** 终态收敛（至多一次）：清理监听、记录稳定日志、通知 onTerminal。 */
  private enterTerminal(result: StreamingTranscriptionTerminalResult): void {
    if (this.terminalNotified) return;
    this.terminalNotified = true;
    this.phase = 'terminal';
    this.terminalResult = result;
    this.userAbortSignal?.removeEventListener('abort', this.onAbort);
    this.userAbortSignal = null;
    // socket 引用由各终态路径的 closeSocket 清理；这里不动，避免 close
    // 事件在终态确立前派发时读到不一致状态。
    this.log({
      label: 'terminal',
      ...(result.failureCode !== undefined
        ? { code: result.failureCode }
        : result.errorCode !== undefined
          ? { code: result.errorCode }
          : {}),
    });
    this.notifyStatus();
    this.onTerminal?.(result);
  }

  private notifyStatus(): void {
    this.onStatus?.(this.getStatus());
  }
}
