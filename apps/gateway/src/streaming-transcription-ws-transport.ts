/**
 * V12 WebSocket transport — 受鉴权双向流式转录通道的传输适配层。
 *
 * ## 握手（服务端权威身份与 Notebook 绑定）
 *
 * 本层在 HTTP Upgrade 握手阶段完成全部授权，之后连接内的 V07 envelope 消息
 * 不再参与授权：
 *
 * 1. 路径必须是 `/v1/client/streaming-transcription`，且必须携带 `notebookId`
 *    query 参数（opaque id 校验）；
 * 2. 身份来自**短时单次使用的 WebSocket ticket**（`StreamingTranscriptionTicketStore`，
 *    由 `/v1/client/streaming-transcription/tickets` 经 HTTPS 签发，绑定
 *    userId + notebookId，60 秒过期、消费后立即失效）。传输通道：浏览器用
 *    `Sec-WebSocket-Protocol: ticket.<ticket>` 子协议（WebSocket API 无法设
 *    自定义 header），非浏览器客户端可用 `Authorization: Bearer <ticket>`。
 *    **长时 session bearer 不进入握手**，避免其进入代理/网关/诊断日志；
 * 3. 浏览器 Origin 严格校验：`isAllowedOrigin` 策略由 composition root 注入，
 *    Origin 缺失（非浏览器）按策略决定，拒绝时返回 403；
 * 4. ticket 兑换出的 notebookId 必须与 URL query 一致；Notebook 访问由
 *    `checkNotebookAccess`（`requireNotebookAccess` 包装）以当前成员资格
 *    重新判定（ticket 签发后成员被撤销也不会穿透）；
 * 5. resolver unavailable（V09 fail-closed 闸门返回 null）时返回稳定
 *    503，**不创建 recognizer**；
 * 6. 认证/授权失败返回 401/403/404/400，且不携带 ticket、PCM、路径等细节。
 *
 * ## 连接后（通道委托）
 *
 * 文本帧 → `decodeStreamingTranscriptionWireMessage`（base64 PCM 解码 +
 * V07 schema）→ `StreamingTranscriptionChannel.enqueue`（V13 有界输入
 * 队列，突发帧超限稳定背压失败）；server 事件以 JSON 文本帧写回，
 * `bufferedAmount` 超配额即触发输出背压稳定失败（V13）。二进制帧、超限
 * 帧、非法帧 → 稳定 `INVALID_REQUEST` + close(1008)，并立即 abort 未终态
 * Session（不等 WS close handshake，防止恶意客户端拖延关闭时继续占用
 * 识别器）。
 *
 * ## 配额与租约（V13）
 *
 * - 握手成功（ticket + Notebook 访问 + resolver 可用）后、升级前，原子
 *   申请用户 / 用户+Notebook / 全局连接槽（`StreamingTranscriptionQuotaManager`）；
 *   任一维度超限 → 429 `CONNECTION_LIMIT_EXCEEDED`，不创建 recognizer；
 * - ticket 签发不占槽；槽位随 ws close/error 幂等释放（finish、cancel、
 *   disconnect、idle/duration 超时、协议错误、adapter 违约全部收敛到同
 *   一释放路径），释放后新连接可立即申请；
 * - 连接级 deadline（duration/idle）与输入/输出背压数值来自
 *   `StreamingTranscriptionQuotas`（单一配额源，fail-closed 配置）。
 *
 * ## 安全面
 *
 * 日志只含受控标签与稳定 code/reason；不记录 PCM、转录文本、ticket、
 * 模型路径或原始帧。`handleProtocols` 只接受 `ticket.*` 子协议（fail-closed），
 * `maxPayload` 限制单帧上限。配额超限只暴露稳定错误码，不暴露内部容量。
 */

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { gatewayOpaqueIdSchema } from '@educanvas/gateway-core';
import type {
  StreamingTranscriptionGateway,
  StreamingTranscriptionServerMessage,
} from '@educanvas/agent-core';
import { WebSocket, WebSocketServer } from 'ws';
import { readBearerToken } from './client-auth';
import {
  StreamingTranscriptionChannel,
  type StreamingTranscriptionChannelLogEntry,
} from './streaming-transcription-channel';
import type { StreamingTranscriptionQuotaManager } from './streaming-transcription-quota-manager';
import type {
  StreamingTranscriptionQuotaErrorCode,
  StreamingTranscriptionQuotas,
} from './streaming-transcription-quotas';
import type { StreamingTranscriptionTicketStore } from './streaming-transcription-ticket';
import { decodeStreamingTranscriptionWireMessage } from './streaming-transcription-wire';

/** 本通道的 WebSocket 端点路径。 */
export const STREAMING_TRANSCRIPTION_WS_PATH =
  '/v1/client/streaming-transcription' as const;

/** 浏览器握手子协议前缀：`Sec-WebSocket-Protocol: ticket.<ticket>`。 */
export const TICKET_SUBPROTOCOL_PREFIX = 'ticket.' as const;

/** 单帧上限（含 base64 PCM）：chunk 最大约 43 KiB，128 KiB 留足协议余量。 */
export const MAX_STREAMING_TRANSCRIPTION_FRAME_BYTES = 128 * 1024;

const HTTP_STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

export interface StreamingTranscriptionUpgradeDependencies {
  /** WebSocket ticket store；null 表示 client transport 未启用（503）。 */
  tickets: StreamingTranscriptionTicketStore | null;
  /** Notebook 访问校验（服务端重新绑定）；false 统一映射 404。 */
  checkNotebookAccess: (input: {
    notebookId: string;
    trustedSubjectId: string;
  }) => Promise<boolean>;
  /** Origin 校验策略；origin 缺失（非浏览器）也交给策略决定。 */
  isAllowedOrigin: (origin: string | null | undefined) => boolean;
  /** V09 resolver 结果：null 表示不可用，握手阶段直接 503 不创建 recognizer。 */
  gateway: StreamingTranscriptionGateway | null;
  /** resolver 的稳定 reason，仅用于审计日志。 */
  unavailableReason: string | null;
  /** V13 连接槽租约协调器：在创建 recognizer 前申请用户/Notebook/全局槽位。 */
  quotaManager: StreamingTranscriptionQuotaManager;
  /** V13 连接级配额（通道 deadline/输入队列/输出背压共用）。 */
  quotas: StreamingTranscriptionQuotas;
  /** V13 输出背压读取注入（测试用）；缺省读取 ws.bufferedAmount。 */
  readBufferedAmount?: (ws: WebSocket) => number;
  /** 脱敏日志 sink；缺省静默。 */
  log?: (entry: StreamingTranscriptionLogEntry) => void;
  /** traceId 生成；缺省 randomUUID。 */
  createTraceId?: () => string;
}

/** transport 层日志：只含受控标签与稳定 code/reason。 */
export interface StreamingTranscriptionLogEntry {
  readonly label: string;
  readonly code?: string;
  readonly reason?: string;
  readonly notebookId?: string;
}

/** 握手拒绝：写 JSON 错误响应后销毁 socket，绝不升级。 */
function rejectUpgrade(socket: Duplex, status: number, code: string): void {
  const body = JSON.stringify({ error: { code } });
  const statusText = HTTP_STATUS_TEXT[status] ?? 'Error';
  socket.write(
    `HTTP/1.1 ${status} ${statusText}\r\n` +
      'content-type: application/json\r\n' +
      `content-length: ${Buffer.byteLength(body)}\r\n` +
      'connection: close\r\n' +
      'x-content-type-options: nosniff\r\n' +
      '\r\n' +
      body,
  );
  socket.destroy();
}

/** 从握手头解析 ticket：Authorization 优先，回退 ticket.* 子协议。 */
function readStreamingTicket(
  headers: IncomingMessage['headers'],
): string | null {
  const authorization = readBearerToken(headers.authorization);
  if (authorization !== null) return authorization;
  const header = headers['sec-websocket-protocol'];
  if (header === undefined) return null;
  const protocols = (Array.isArray(header) ? header : [header])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  for (const protocol of protocols) {
    if (!protocol.startsWith(TICKET_SUBPROTOCOL_PREFIX)) continue;
    const ticket = protocol.slice(TICKET_SUBPROTOCOL_PREFIX.length);
    if (ticket.length > 0 && ticket.length <= 4_096) return ticket;
  }
  return null;
}

function parseNotebookId(url: URL): string | null {
  const parsed = gatewayOpaqueIdSchema.safeParse(
    url.searchParams.get('notebookId'),
  );
  return parsed.success ? parsed.data : null;
}

function makeProtocolErrorClose(ws: WebSocket): void {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ error: { code: 'INVALID_MESSAGE_SEQUENCE' } }));
    }
  } catch {
    // 连接已不可写：close 失败路径由 terminate 兜底。
  }
}

function sendAndClose(
  ws: WebSocket,
  errorCode: 'INVALID_REQUEST' | 'INVALID_MESSAGE_SEQUENCE',
  closeCode: 1008 | 1011,
): void {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ error: { code: errorCode } }));
    }
  } catch {
    // 写失败不递归记录。
  }
  closeWebSocket(ws, closeCode);
}

function sendQuotaErrorFrame(
  ws: WebSocket,
  code: StreamingTranscriptionQuotaErrorCode,
): void {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ error: { code } }));
    }
  } catch {
    // 写失败不递归记录；关闭路径由 closeWebSocket 兜底。
  }
}

function closeWebSocket(ws: WebSocket, code: 1000 | 1008 | 1011): void {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.close(code);
    else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
  } catch {
    ws.terminate();
  }
}

function attachChannel(
  ws: WebSocket,
  deps: StreamingTranscriptionUpgradeDependencies,
  socketLease: { release(): void },
): void {
  const channel = new StreamingTranscriptionChannel({
    gateway: deps.gateway as StreamingTranscriptionGateway,
    quotas: deps.quotas,
    createTraceId: deps.createTraceId,
    log: (entry: StreamingTranscriptionChannelLogEntry) => {
      deps.log?.({
        label: entry.label,
        code: entry.code,
        ...(entry.operationId !== undefined
          ? { operationId: entry.operationId }
          : {}),
        ...(entry.segmentId !== undefined
          ? { segmentId: entry.segmentId }
          : {}),
      });
    },
    sendEvent: (event: StreamingTranscriptionServerMessage) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // V13 输出背压（REVISE）：先序列化再判断，`当前缓冲 + 本帧字节`
      // 超限即拒绝发送——只检查当前 bufferedAmount 会被最后一帧突破，
      // 且若无后续事件永远不会被检测到。读取函数可注入（测试确定性）；
      // 生产默认读 ws.bufferedAmount。
      const payload = JSON.stringify(event);
      const buffered = deps.readBufferedAmount
        ? deps.readBufferedAmount(ws)
        : ws.bufferedAmount;
      if (
        buffered + Buffer.byteLength(payload) >
        deps.quotas.maxOutputBufferedBytes
      ) {
        channel.outputBackpressureExceeded();
        return;
      }
      try {
        ws.send(payload);
      } catch {
        // 发送失败（连接正在关闭）：事件流终态由通道内部收敛。
      }
    },
    sendProtocolError: () => {
      makeProtocolErrorClose(ws);
    },
    sendQuotaError: (code) => {
      sendQuotaErrorFrame(ws, code);
    },
    // V13 REVISE：终态收敛回调（只触发一次）。正常终态（final/failed 已
    // 投影）由服务端**立即**以 1000 正常关闭（无毫秒静默窗口，见
    // NORMAL_CLOSE 语义注释）。socket 租约**不**在此释放——连接在 close
    // handshake 完成前仍真实存在，必须继续计入连接配额（否则客户端拖延
    // close 可开出不计数连接）；socket 槽只在 ws close/error/terminate
    // 释放。adapter 违约 / 配额违约的关闭码已由通道发出（1011/1008）。
    onTerminal: (reason) => {
      if (reason === 'terminal-event') closeWebSocket(ws, 1000);
    },
    // V13 REVISE：Session/recognizer 槽申请（全局并发上限）；槽位由
    // Channel 在终态形成时释放，与连接关闭解耦。
    acquireSession: () => deps.quotaManager.acquireSession(),
    close: (code) => closeWebSocket(ws, code),
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // 协议违规：立即取消未终态 Session，不等 WS close handshake。
      channel.disconnect();
      sendAndClose(ws, 'INVALID_REQUEST', 1008);
      return;
    }
    const raw = Array.isArray(data) ? Buffer.concat(data) : data;
    const decoded = decodeStreamingTranscriptionWireMessage(raw.toString());
    if (!decoded.ok) {
      channel.disconnect();
      sendAndClose(ws, 'INVALID_REQUEST', 1008);
      return;
    }
    // V13 有界输入队列：同一批次突发帧不会无限积压（超限稳定背压失败）。
    channel.enqueue(decoded.message);
  });
  ws.on('close', () => {
    channel.disconnect();
    // V13：连接实际关闭即释放 socket 槽（幂等；finish/cancel/disconnect/
    // 超时/协议错误/adapter 违约/服务端主动 1000 关闭全部收敛到此路径）。
    // recognizer 槽由 Channel 在终态形成时独立释放。
    socketLease.release();
  });
  ws.on('error', () => {
    channel.disconnect();
    socketLease.release();
    ws.terminate();
  });
}

/**
 * 创建 HTTP Upgrade 处理器，挂在现有 `server.on('upgrade', ...)` 上，
 * 不另起端口/服务，与 Gateway 进程生命周期一致。
 */
export function createStreamingTranscriptionUpgradeHandler(
  deps: StreamingTranscriptionUpgradeDependencies,
): (request: IncomingMessage, socket: Duplex, head: Buffer) => void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_STREAMING_TRANSCRIPTION_FRAME_BYTES,
    // fail-closed：只接受 ticket.* 子协议，未知子协议拒绝握手。
    handleProtocols: (protocols) => {
      for (const protocol of protocols) {
        if (protocol.startsWith(TICKET_SUBPROTOCOL_PREFIX)) return protocol;
      }
      return false;
    },
  });
  return (request, socket, head) => {
    void handleUpgrade(deps, wss, request, socket, head);
  };
}

async function handleUpgrade(
  deps: StreamingTranscriptionUpgradeDependencies,
  wss: WebSocketServer,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(request.url ?? '/', 'http://gateway.internal');
  } catch {
    rejectUpgrade(socket, 400, 'INVALID_REQUEST');
    return;
  }
  if (url.pathname !== STREAMING_TRANSCRIPTION_WS_PATH) {
    // 非本通道的 upgrade：本 handler 只处理流式路径，不独占 server 的
    // upgrade 事件。销毁 socket 前记录固定稳定标签（不记录客户端路径，
    // 避免把任意用户输入写进日志）；若未来新增其他 upgrade 端点，应各自
    // 按路径分派而不是在此集中处理。
    deps.log?.({ label: 'unhandled_upgrade' });
    socket.destroy();
    return;
  }
  if (deps.tickets === null) {
    // client transport 未启用：稳定 503（与 /v1/client/* 一致）。
    rejectUpgrade(socket, 503, 'CLIENT_TRANSPORT_DISABLED');
    return;
  }
  const notebookId = parseNotebookId(url);
  if (notebookId === null) {
    rejectUpgrade(socket, 400, 'INVALID_REQUEST');
    return;
  }
  if (!deps.isAllowedOrigin(request.headers.origin)) {
    rejectUpgrade(socket, 403, 'FORBIDDEN');
    return;
  }
  const ticket = readStreamingTicket(request.headers);
  if (ticket === null) {
    rejectUpgrade(socket, 401, 'UNAUTHENTICATED');
    return;
  }
  const bound = deps.tickets.redeem(ticket);
  if (bound === null) {
    // 过期/已消费/未知 ticket 统一 401，不泄露内部状态。
    rejectUpgrade(socket, 401, 'UNAUTHENTICATED');
    return;
  }
  if (bound.notebookId !== notebookId) {
    // ticket 与握手 URL 绑定的 Notebook 不一致：视为凭证无效。
    rejectUpgrade(socket, 401, 'UNAUTHENTICATED');
    return;
  }
  let allowed = false;
  try {
    allowed = await deps.checkNotebookAccess({
      notebookId,
      trustedSubjectId: bound.userId,
    });
  } catch {
    allowed = false;
  }
  if (!allowed) {
    // 与 canvas-resource 一致：Notebook 不存在/无成员资格统一 404。
    rejectUpgrade(socket, 404, 'NOT_FOUND');
    return;
  }
  if (deps.gateway === null) {
    // V09 fail-closed：resolver 不可用时不创建 recognizer，稳定 503。
    rejectUpgrade(socket, 503, 'STREAMING_TRANSCRIPTION_UNAVAILABLE');
    deps.log?.({
      label: 'streaming_unavailable',
      reason: deps.unavailableReason ?? 'unknown',
    });
    return;
  }
  // V13 REVISE：握手成功后原子申请 WebSocket 连接槽（用户/用户+Notebook/
  // 全局连接数）。ticket 签发不占槽；此处任一维度超限 → 429 拒绝。socket
  // 槽只在实际 close/error/terminate 释放（连接存在期间始终计入）；
  // recognizer 槽由 Channel 在 start 时另行申请、终态形成时释放。
  const socketLease = deps.quotaManager.acquireSocket({
    userId: bound.userId,
    notebookId,
  });
  if (socketLease === null) {
    rejectUpgrade(socket, 429, 'CONNECTION_LIMIT_EXCEEDED');
    deps.log?.({ label: 'connection_limit_exceeded', notebookId });
    return;
  }
  // 防 upgrade 中途 TCP 中断泄漏租约：若 socket 在 `handleUpgrade` 完成前
  // 关闭/出错（客户端 RST、代理中断），ws 库不会创建 WebSocket 实例，也就
  // 没有 ws close/error 可挂释放监听，槽位会永久占用（本设计无轮询清扫）。
  // 先检查已销毁的 socket（close 事件已过去、once 监听不会触发），再挂
  // 一次性兜底监听；upgrade 回调成功创建 ws 后由 ws 自身 close/error 释放。
  if (socket.destroyed) {
    socketLease.release();
    return;
  }
  let wsCreated = false;
  const releaseOnUpgradeAbort = (): void => {
    if (!wsCreated) socketLease.release();
  };
  socket.once('close', releaseOnUpgradeAbort);
  socket.once('error', releaseOnUpgradeAbort);
  wss.handleUpgrade(request, socket, head, (ws) => {
    wsCreated = true;
    deps.log?.({ label: 'connection_opened', notebookId });
    attachChannel(ws, deps, socketLease);
    ws.on('close', () => {
      deps.log?.({ label: 'connection_closed', notebookId });
    });
  });
}
