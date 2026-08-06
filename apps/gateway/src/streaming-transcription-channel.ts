/**
 * V12/V13 流式转录通道核心 — transport-neutral 生命周期、配额与安全边界。
 *
 * ## 职责（单一职责：一个连接一个会话的受控生命周期）
 *
 * - 持有并管理 `StreamingTranscriptionSession`（V08 adapter 会话）；
 * - 对每个 client 消息做 V07 跨消息序列校验（start 一次、finish/cancel
 *   唯一终态、finish/cancel 后拒绝、sequence 连续）——V13 起使用
 *   `StreamingTranscriptionClientMessageSequenceTracker` 增量验证，单条
 *   O(1)、不保存历史数组（消除 V12 逐事件重扫历史的 O(n²)）；
 * - 把合法 chunk 投影为 V04 PCM 分片转发给 Session，并累计 PCM 字节 /
 *   chunk 数，超限立即稳定失败（V13 配额）；
 * - 把 Session 事件流（partial/endpoint/final/failed）投影给 transport，
 *   事件序列用 `StreamingTranscriptionEventSequenceTracker` 增量验证；
 * - 连接级 duration / idle deadline（V13 配额，计时器只负责 deadline，
 *   正常路径由终态/断开主动清理）；
 * - `enqueue` 提供有界输入队列（背压）：队列满 → 稳定失败，不无限缓冲；
 * - disconnect / quota 违约 / 协议违约时通过 abort signal 取消未终态
 *   Session；会话事件流结束后释放全部监听器、计时器与引用。
 *
 * 本模块**不**：创建 Teaching Turn、调用 Agent Loop、把 final 文本提交给
 * Agent、信任客户端身份字段（身份/Notebook 由 transport 握手阶段由服务端
 * 确定并注入，本模块的输入只有 V07 envelope 消息）、读取 Provider 配置。
 *
 * ## 与 V07/V08 的分工
 *
 * - V07 批量验证器（`validateStreamingTranscriptionClientMessageSequence`）
 *   仍是协议语义的权威单源；本模块复用 V13 增量 tracker（等价性由
 *   agent-core 测试证明），不复制判定逻辑。历史不保存数组，内存 O(1)。
 * - V08 Session 内部还有第二道校验（V04 schema + V06 输入状态机）：
 *   endpoint 是 Session 内部状态，客户端不可见，因此 endpoint 后的 chunk
 *   会通过 V07 验证器但在 `pushChunk` 时被 Session 拒绝（抛
 *   `StreamingTranscriptionStateError`）。通道捕获后只记录稳定日志，**不**
 *   投影第二个终态——唯一终态由 Session 的事件流交付（V08 保证
 *   final/failed 先到先得）。
 *
 * ## 唯一终态
 *
 * finish / cancel / disconnect / quota 违约 / adapter failure 的所有竞争
 * 路径都收敛到 Session 内部的终态锁（V08 `terminalLocked`）：cancel 消息
 * → `cancel()`、disconnect → abort signal、adapter 内部失败 → 自身投影
 * failed、配额违约 → abort + 错误帧 + close。通道在收到终态事件后立即
 * 进入 terminal，拒绝此后任何消息。
 *
 * ## 安全错误面
 *
 * 日志只包含受控标签与稳定 code / operationId / segmentId；不记录 PCM、
 * 转录文本、token、模型路径或自由错误对象。adapter 事件流违约（schema
 * 非法事件、迭代器异常）与配额超限只触发稳定日志 + 稳定错误码 + 关闭，
 * 不投影自由错误。
 */

import { randomUUID } from 'node:crypto';
import {
  StreamingTranscriptionClientMessageSequenceTracker,
  StreamingTranscriptionEventSequenceTracker,
  StreamingTranscriptionStateError,
  isStreamingTranscriptionTerminalEvent,
  streamingTranscriptionProtocolVersion,
  streamingTranscriptionServerMessageSchema,
  toStreamingTranscriptionPcmChunk,
  type StreamingTranscriptionClientMessage,
  type StreamingTranscriptionGateway,
  type StreamingTranscriptionRequest,
  type StreamingTranscriptionServerMessage,
  type StreamingTranscriptionSession,
} from '@educanvas/agent-core';
import {
  STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
  type StreamingTranscriptionQuotaErrorCode,
  type StreamingTranscriptionQuotas,
} from './streaming-transcription-quotas';
import type { StreamingTranscriptionSessionLease } from './streaming-transcription-quota-manager';

export type StreamingTranscriptionChannelLogLabel =
  | 'session_started'
  | 'session_ended'
  | 'input_rejected'
  | 'protocol_rejected'
  | 'invalid_adapter_event'
  | 'quota_exceeded';

export interface StreamingTranscriptionChannelLogEntry {
  readonly label: StreamingTranscriptionChannelLogLabel;
  readonly operationId?: string;
  readonly segmentId?: string;
  readonly code?: string;
}

export interface StreamingTranscriptionChannelOptions {
  /** 握手阶段由服务端解析并校验通过的 Gateway；通道建立前保证非 null。 */
  readonly gateway: StreamingTranscriptionGateway;
  /** 投影合法 Server 事件（V04 schema 已校验）；transport 负责序列化发送。 */
  readonly sendEvent: (event: StreamingTranscriptionServerMessage) => void;
  /** 序列违规时发送 `INVALID_MESSAGE_SEQUENCE` 传输错误帧。 */
  readonly sendProtocolError: () => void;
  /** 关闭连接：1008=协议/配额违约，1011=adapter 违约。 */
  readonly close: (code: 1008 | 1011) => void;
  /** V13 配额违约时发送稳定错误码帧（close 前）。 */
  readonly sendQuotaError?: (
    code: StreamingTranscriptionQuotaErrorCode,
  ) => void;
  /**
   * V13 REVISE：终态收敛回调（只触发一次）。transport 据此在正常终态时
   * 主动释放连接租约并正常关闭（close 1000），异常终态先 abort 再按
   * closeCode 关闭——客户端收到终态后不关连接也不能永久占槽。
   */
  readonly onTerminal?: (reason: StreamingTranscriptionTerminalReason) => void;
  /**
   * V13 REVISE：Session/recognizer 槽申请（transport 注入，闭包持
   * manager）。在创建 recognizer 前调用；返回 null 表示全局 recognizer
   * 配额满（不创建 recognizer，稳定失败）。槽位在 Session 终态形成时
   * 释放（与连接关闭解耦）。未注入（单测）视为无上限。
   */
  readonly acquireSession?: () => StreamingTranscriptionSessionLease | null;
  /** 脱敏日志 sink；缺省静默。 */
  readonly log?: (entry: StreamingTranscriptionChannelLogEntry) => void;
  /** traceId 生成；缺省 randomUUID（测试注入固定值）。 */
  readonly createTraceId?: () => string;
  /** V13 连接级配额；缺省 STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS。 */
  readonly quotas?: StreamingTranscriptionQuotas;
  /** V13 时钟注入（fake clock 测试）。 */
  readonly now?: () => number;
  /** V13 计时器注入（fake clock 测试）。 */
  readonly scheduleTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** V13 微任务调度注入（输入队列 drain 时序测试）。 */
  readonly scheduleMicrotask?: (callback: () => void) => void;
}

export type StreamingTranscriptionChannelPhase =
  'awaiting-start' | 'streaming' | 'terminal';

/**
 * 终态原因（V13 REVISE）：transport 据此决定租约释放与关闭码。
 * - `terminal-event`：Session 交付了 final/failed 且已投影给客户端（含
 *   beginStreaming 失败投影的 MODEL_FAILED）；
 * - `adapter-violation`：schema 非法事件、序列违约、事件迭代器异常或事件
 *   流无终态结束；
 * - `quota-exceeded`：配额违约（错误帧 + close(1008) 已由通道发出）。
 */
export type StreamingTranscriptionTerminalReason =
  'terminal-event' | 'adapter-violation' | 'quota-exceeded';

/**
 * 每个连接一个通道实例。输入动作与事件消费分离；实例方法都不抛异常，
 * 全部失败路径收敛为稳定日志 + 回调（终态由 Session 事件流交付）。
 */
export class StreamingTranscriptionChannel {
  private readonly options: StreamingTranscriptionChannelOptions;
  private readonly quotas: StreamingTranscriptionQuotas;
  private phase: StreamingTranscriptionChannelPhase = 'awaiting-start';
  private session: StreamingTranscriptionSession | null = null;
  private abortController: AbortController | null = null;
  private operationId: string | null = null;
  private segmentId: string | null = null;
  // V13 O(1) 增量验证状态：不保存历史数组（消除 O(n²)）。
  private readonly messageTracker =
    new StreamingTranscriptionClientMessageSequenceTracker();
  private readonly eventTracker =
    new StreamingTranscriptionEventSequenceTracker();
  // V13 输入背压：有界队列 + 微任务 drain；正常同步路径队列恒为空。
  private readonly inputQueue: StreamingTranscriptionClientMessage[] = [];
  private drainScheduled = false;
  // V13 累计输入配额。
  private chunksReceived = 0;
  private pcmBytesReceived = 0;
  // V13 REVISE：Session/recognizer 槽租约（终态形成时释放，与连接关闭解耦）。
  private sessionLease: StreamingTranscriptionSessionLease | null = null;
  // V13 连接级 deadline。
  private durationTimer: unknown = null;
  private idleTimer: unknown = null;

  constructor(options: StreamingTranscriptionChannelOptions) {
    this.options = options;
    this.quotas = options.quotas ?? STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS;
    // deadline 从连接建立（握手完成、通道构造）起算：覆盖"从不发 start"
    // 的空转连接，防止其无限占槽。
    this.durationTimer = this.scheduleTimer(
      () => this.quotaExceeded('SESSION_DURATION_EXCEEDED'),
      this.quotas.maxSessionDurationMs,
    );
    this.idleTimer = this.scheduleTimer(
      () => this.quotaExceeded('SESSION_IDLE_TIMEOUT'),
      this.quotas.maxSessionIdleMs,
    );
  }

  /** 处理一条已通过 wire 解码与 schema 校验的 client 消息（同步）。 */
  handle(message: StreamingTranscriptionClientMessage): void {
    if (this.phase === 'terminal') {
      this.rejectProtocol();
      return;
    }
    if (!this.messageTracker.accept(message)) {
      this.rejectProtocol();
      return;
    }
    this.resetIdleTimer();
    switch (message.type) {
      case 'start':
        this.startSession(message);
        break;
      case 'chunk':
        this.forwardChunk(message);
        break;
      case 'finish':
        this.finishSession();
        break;
      case 'cancel':
        this.cancelSession();
        break;
    }
  }

  /**
   * 入队一条 client 消息（transport 用）。队列有界：满则稳定背压失败，
   * 绝不无限缓冲。正常路径下消息在同一事件循环批次内被 drain 处理。
   */
  enqueue(message: StreamingTranscriptionClientMessage): void {
    if (this.phase === 'terminal') {
      this.rejectProtocol();
      return;
    }
    if (this.inputQueue.length >= this.quotas.maxQueuedInputMessages) {
      this.quotaExceeded('INPUT_BACKPRESSURE_EXCEEDED');
      return;
    }
    this.inputQueue.push(message);
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    const schedule = this.options.scheduleMicrotask ?? queueMicrotask;
    schedule(() => {
      this.drainScheduled = false;
      this.drainInput();
    });
  }

  /** transport 报告输出背压超限（ws.bufferedAmount 超配额）。 */
  outputBackpressureExceeded(): void {
    this.quotaExceeded('OUTPUT_BACKPRESSURE_EXCEEDED');
  }

  /** 连接关闭时调用：取消未终态 Session 并停止配额计时器。 */
  disconnect(): void {
    if (this.phase === 'streaming' && this.abortController !== null) {
      this.abortController.abort();
    }
    // 连接断开即生命周期结束：主动清理 deadline（不依赖定时轮询清扫）。
    this.clearTimers();
    this.inputQueue.length = 0;
  }

  private drainInput(): void {
    while (this.inputQueue.length > 0 && this.phase !== 'terminal') {
      const message = this.inputQueue.shift()!;
      this.handle(message);
    }
    if (this.phase === 'terminal') this.inputQueue.length = 0;
  }

  /** 终态是否已通知 transport（onTerminal 只触发一次）。 */
  private terminalNotified = false;

  private startSession(
    message: Extract<StreamingTranscriptionClientMessage, { type: 'start' }>,
  ): void {
    // start 身份即会话身份：成败路径都要记录（创建失败也要投影 failed 事件）。
    this.operationId = message.operationId;
    this.segmentId = message.segmentId;
    const controller = new AbortController();
    this.abortController = controller;
    const request: StreamingTranscriptionRequest = {
      operationId: message.operationId,
      segmentId: message.segmentId,
      traceId: this.options.createTraceId?.() ?? randomUUID(),
      signal: controller.signal,
    };
    // V13 REVISE：创建 recognizer 前申请 Session/recognizer 槽（全局并
    // 发上限）。超限（acquireSession 返回 null）→ 不创建 recognizer，稳定
    // 失败（错误帧 + close）。未注入 acquireSession（单测）视为无上限。
    let sessionLease: StreamingTranscriptionSessionLease;
    if (this.options.acquireSession === undefined) {
      sessionLease = { released: false, release: () => undefined };
    } else {
      const acquired = this.options.acquireSession();
      if (acquired === null) {
        this.quotaExceeded('SESSION_LIMIT_EXCEEDED');
        return;
      }
      sessionLease = acquired;
    }
    this.sessionLease = sessionLease;
    let session: StreamingTranscriptionSession;
    try {
      session = this.options.gateway.beginStreaming(request);
    } catch {
      // adapter 创建失败（如 V08 构造时 recognizer 加载失败 → MODEL_FAILED）：
      // 用 start 身份投影唯一 failed 终态（事件 sequence 从 0 开始）。
      this.options.sendEvent({
        protocolVersion: streamingTranscriptionProtocolVersion,
        operationId: message.operationId,
        segmentId: message.segmentId,
        sequence: 0,
        type: 'failed',
        failureCode: 'MODEL_FAILED',
      });
      this.enterTerminal();
      this.notifyTerminal('terminal-event');
      return;
    }
    this.session = session;
    this.phase = 'streaming';
    this.log({ label: 'session_started' });
    void this.drainEvents(session);
  }

  private forwardChunk(
    message: Extract<StreamingTranscriptionClientMessage, { type: 'chunk' }>,
  ): void {
    if (this.phase !== 'streaming' || this.session === null) {
      this.rejectProtocol();
      return;
    }
    // 累计输入配额：先计数后转发；恰好等于上限合法，超过才稳定失败。
    this.chunksReceived += 1;
    if (this.chunksReceived > this.quotas.maxChunksPerConnection) {
      this.quotaExceeded('INPUT_CHUNK_LIMIT_EXCEEDED');
      return;
    }
    this.pcmBytesReceived += message.pcmBytes.length;
    if (this.pcmBytesReceived > this.quotas.maxPcmBytesPerConnection) {
      this.quotaExceeded('INPUT_BYTE_LIMIT_EXCEEDED');
      return;
    }
    try {
      this.session.pushChunk(toStreamingTranscriptionPcmChunk(message));
    } catch (error) {
      // Session 内部状态机拒绝（INPUT_AFTER_* / INVALID_PCM_CHUNK）：
      // 终态由 Session 事件流交付，这里只记录稳定日志。
      this.log({
        label: 'input_rejected',
        code:
          error instanceof StreamingTranscriptionStateError
            ? error.code
            : 'UNKNOWN',
      });
    }
  }

  private finishSession(): void {
    if (this.phase !== 'streaming' || this.session === null) return;
    try {
      this.session.finish();
    } catch (error) {
      this.log({
        label: 'input_rejected',
        code:
          error instanceof StreamingTranscriptionStateError
            ? error.code
            : 'UNKNOWN',
      });
    }
  }

  private cancelSession(): void {
    if (this.phase !== 'streaming' || this.session === null) return;
    try {
      this.session.cancel();
    } catch (error) {
      this.log({
        label: 'input_rejected',
        code:
          error instanceof StreamingTranscriptionStateError
            ? error.code
            : 'UNKNOWN',
      });
    }
  }

  /** 消费 Session 事件流并投影；终态事件后立即锁住通道。 */
  private async drainEvents(
    session: StreamingTranscriptionSession,
  ): Promise<void> {
    try {
      for await (const event of session.events) {
        // adapter 输出双保险：V04 schema 校验（V08 已内部校验，此处防违约）。
        if (
          !streamingTranscriptionServerMessageSchema.safeParse(event).success
        ) {
          this.invalidAdapterEvent(1011);
          return;
        }
        // V04 跨消息序列验证（唯一终态/endpoint 纪律），O(1) 增量。
        // 必须先验证再检查终态：双终态等违约事件不能被 sendEvent 触发的
        // 终态短路（V12 行为：违约事件 → 关闭 1011）。
        if (!this.eventTracker.accept(event)) {
          this.invalidAdapterEvent(1011);
          return;
        }
        // sendEvent 回调（如 transport 输出背压）可能已触发终态：不再投影。
        if (this.phase === 'terminal') return;
        this.options.sendEvent(event);
        if (isStreamingTranscriptionTerminalEvent(event)) {
          // 终态事件已验证并成功投影：立即锁定并启动确定性资源释放
          // （recognizer 槽 + 主动 1000 关闭），**不依赖**事件迭代器自觉
          // 结束——adapter 终态后挂起也不能让连接/租约永久保留（REVISE）。
          // 终态后到达的后续违约（双终态等）走 abort + 1011，但连接可能
          // 已 CLOSING（正常关闭抢先）；违约仍被审计（invalid_adapter_event
          // 日志），只是不再决定关闭码。
          this.enterTerminal();
          this.notifyTerminal('terminal-event');
        }
      }
    } catch {
      // adapter 事件流违约：稳定日志 + abort + 关闭，不投影自由错误。
      this.invalidAdapterEvent(1011);
      return;
    }
    if (this.phase !== 'terminal') {
      // 事件流无终态直接结束：Session 违约（未交付 final/failed），不能
      // 静默当成功终态——abort 底层 recognizer + 1011 关闭（REVISE）。
      this.invalidAdapterEvent(1011);
      return;
    }
  }

  /** V13 配额违约：abort + 稳定错误码帧 + close + 锁终态。 */
  private quotaExceeded(code: StreamingTranscriptionQuotaErrorCode): void {
    this.log({ label: 'quota_exceeded', code });
    // 与协议违规同构：立即 abort 未终态 Session（V08 → failed/CANCELLED
    // 唯一失败终态）；错误帧表达连接级违约；Session 已终态时只发错误帧。
    this.abortController?.abort();
    this.options.sendQuotaError?.(code);
    this.options.close(1008);
    this.enterTerminal();
    this.notifyTerminal('quota-exceeded');
  }

  /**
   * adapter 违约：abort 未终态 Session + 关闭 + 锁终态（事件流已结束）。
   * 必须先 abort：否则底层 recognizer/Session 会继续运行，且 enterTerminal
   * 清空 controller 后 ws close 的 disconnect() 因 phase 已 terminal 也不会
   * 再 abort（REVISE：异常后必须释放 recognizer）。
   */
  private invalidAdapterEvent(closeCode: 1008 | 1011): void {
    this.log({ label: 'invalid_adapter_event' });
    this.abortController?.abort();
    this.options.close(closeCode);
    this.enterTerminal();
    this.notifyTerminal('adapter-violation');
  }

  private rejectProtocol(): void {
    this.log({ label: 'protocol_rejected' });
    // 协议违规立即取消未终态 Session：不等 WS close handshake 完成，
    // 防止恶意客户端拖延关闭时继续占用识别器（V08 abort → CANCELLED）。
    this.abortController?.abort();
    // 连接已判死：停止 deadline，防止 terminal 后计时器空转触发噪音日志。
    this.clearTimers();
    this.inputQueue.length = 0;
    this.options.sendProtocolError();
    this.options.close(1008);
  }

  private enterTerminal(): void {
    if (this.phase === 'terminal') return;
    this.phase = 'terminal';
    // 释放全部资源：deadline 计时器、输入队列、Session、abort 控制器，
    // 以及 Session/recognizer 槽租约（幂等；终态形成即释放，不等连接
    // 关闭/迭代器结束——adapter 终态后挂起也不能占 recognizer 槽）。
    this.clearTimers();
    this.inputQueue.length = 0;
    this.session = null;
    this.abortController = null;
    this.sessionLease?.release();
    this.sessionLease = null;
    this.log({ label: 'session_ended' });
  }

  /**
   * 终态收敛回调（只触发一次）：transport 借此在正常终态时主动释放租约
   * 并正常关闭（1000），异常终态先 abort 再按 closeCode 关闭——客户端收到
   * 终态后不关连接也不能永久占槽。terminal-event 的调用点延迟到事件流
   * 确认干净结束（drainEvents 末尾），避免违约被 close(1000) 抢先。
   */
  private notifyTerminal(reason: StreamingTranscriptionTerminalReason): void {
    if (this.terminalNotified) return;
    this.terminalNotified = true;
    this.options.onTerminal?.(reason);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) {
      this.clearTimer(this.idleTimer);
      this.idleTimer = null;
    }
    // idle 从最后一条合法 client 消息起算（配置保证 idle < duration）。
    this.idleTimer = this.scheduleTimer(
      () => this.quotaExceeded('SESSION_IDLE_TIMEOUT'),
      this.quotas.maxSessionIdleMs,
    );
  }

  private clearTimers(): void {
    if (this.durationTimer !== null) {
      this.clearTimer(this.durationTimer);
      this.durationTimer = null;
    }
    if (this.idleTimer !== null) {
      this.clearTimer(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleTimer(callback: () => void, ms: number): unknown {
    return this.options.scheduleTimer
      ? this.options.scheduleTimer(callback, ms)
      : setTimeout(callback, ms);
  }

  private clearTimer(handle: unknown): void {
    if (this.options.clearTimer) {
      this.options.clearTimer(handle);
      return;
    }
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }

  private log(
    entry: Omit<
      StreamingTranscriptionChannelLogEntry,
      'operationId' | 'segmentId'
    >,
  ): void {
    try {
      const record: StreamingTranscriptionChannelLogEntry = {
        ...entry,
        // 会话未启动时 operationId/segmentId 未知，不写入日志键。
        ...(this.operationId !== null ? { operationId: this.operationId } : {}),
        ...(this.segmentId !== null ? { segmentId: this.segmentId } : {}),
      };
      this.options.log?.(record);
    } catch {
      // 日志故障不影响业务终态与清理。
    }
  }
}
