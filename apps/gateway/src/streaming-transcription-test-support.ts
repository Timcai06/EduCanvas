/**
 * V12 测试支持 — fake streaming transcription Gateway/Session。
 *
 * 模拟 V08 Session 的可观察语义（事件队列、唯一终态、INPUT_AFTER_* 拒绝、
 * abort → CANCELLED、adapter 创建失败、schema 非法事件注入），但不加载
 * 任何真实 WASM 模型。V12 全部测试只使用本支持文件的 fake。
 *
 * 事件投影只做结构构造，**不做** V04 schema 校验（除非注入非法事件）——
 * 校验是 V08 adapter 的职责，通道测试要验证的是通道对"已校验事件"与
 * "违约事件"两种输入的行为。
 */

import {
  StreamingTranscriptionStateError,
  isStreamingTranscriptionTerminalEvent,
  streamingTranscriptionProtocolVersion,
  type StreamingTranscriptionEvent,
  type StreamingTranscriptionFailureCode,
  type StreamingTranscriptionGateway,
  type StreamingTranscriptionPcmChunk,
  type StreamingTranscriptionRequest,
  type StreamingTranscriptionSession,
} from '@educanvas/agent-core';

export interface FakeTranscriptionSessionConfig {
  /** 每片产生的 partial 文本；返回 null 表示该片不产生 partial。 */
  partialFor?: (chunkSequence: number) => string | null;
  /** 第几片（1-based）之后投影 endpoint；endpoint 后 pushChunk 抛 INPUT_AFTER_ENDPOINT。 */
  endpointAfterChunks?: number;
  /** finish 时的 final 文本。 */
  finalText?: string;
  /** 若 true：构造后立即投影 failed + MODEL_FAILED（模拟 adapter 内部立即失败）。 */
  failImmediately?: boolean;
  /** 若 true：构造后立即投影一个 schema 非法事件（空白 partial）。 */
  emitInvalidEvent?: boolean;
  /** 若 true：构造后连续投影两个结构合法的 final（模拟 adapter 违约双终态）。 */
  emitDoubleTerminal?: boolean;
  /** 若 true：构造后投影 sequence 跳号的事件（0 → 2，模拟违约）。 */
  emitSequenceGap?: boolean;
  /** 若 true：构造后先投影 endpoint 再投影 partial（模拟违约）。 */
  emitPartialAfterEndpoint?: boolean;
  /** 若 true：pushChunk 时投影 failed + MODEL_FAILED（模拟识别器中途失败）。 */
  failOnChunk?: boolean;
  /** 构造后立即投影 N 个合法 partial（模拟 adapter 快速批量产出，供输出背压测试）。 */
  initialPartialEvents?: number;
  /** 若 true：事件流无任何终态直接结束（adapter 违约：未交付 final/failed）。 */
  endWithoutTerminal?: boolean;
  /** 若 true：事件迭代器抛出异常（adapter 违约）。 */
  throwOnIterate?: boolean;
  /**
   * 若 true：投影终态事件后事件迭代器**挂起**不结束（模拟 adapter 违约：
   * 终态已产生但迭代器永远不 return，供 REVISE 验证 recognizer 槽在终态
   * 形成时释放、不依赖迭代器自觉结束）。
   */
  hangAfterTerminal?: boolean;
}

function eventBase(request: StreamingTranscriptionRequest, sequence: number) {
  return {
    protocolVersion: streamingTranscriptionProtocolVersion,
    operationId: request.operationId,
    segmentId: request.segmentId,
    sequence,
  } as const;
}

export class FakeTranscriptionSession implements StreamingTranscriptionSession {
  readonly request: StreamingTranscriptionRequest;
  readonly pushedChunks: StreamingTranscriptionPcmChunk[] = [];
  finishCalls = 0;
  cancelCalls = 0;
  aborted = false;
  /** 最近一次终态事件（final/failed）；null 表示尚未终态。 */
  terminalEvent: StreamingTranscriptionEvent | null = null;

  private readonly pending: StreamingTranscriptionEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private ended = false;
  private terminalLocked = false;
  private endpointSeen = false;
  private eventSequence = 0;
  private chunkCount = 0;

  constructor(
    private readonly config: FakeTranscriptionSessionConfig,
    request: StreamingTranscriptionRequest,
  ) {
    this.request = request;
    if (config.failImmediately) {
      this.failWith('MODEL_FAILED');
    }
    if (config.initialPartialEvents !== undefined) {
      for (let index = 0; index < config.initialPartialEvents; index += 1) {
        this.pushEvent({
          ...eventBase(request, this.eventSequence),
          type: 'partial',
          text: `bulk-partial-${index}`,
        });
      }
    }
    if (config.emitInvalidEvent) {
      // 空白 partial：违反 V04 transcriptionTextSchema 的 trim 约束。
      this.pending.push({
        ...eventBase(request, this.eventSequence),
        type: 'partial',
        text: '   ',
      });
      this.eventSequence += 1;
    }
    if (config.emitDoubleTerminal) {
      // 违约：连续投影两个结构合法的 final（V04 序列验证器应拒绝第二个）。
      this.pushEvent({
        ...eventBase(request, this.eventSequence),
        type: 'final',
        text: 'first-final',
      });
      this.pushEvent({
        ...eventBase(request, this.eventSequence),
        type: 'final',
        text: 'second-final',
      });
    }
    if (config.emitSequenceGap) {
      // 违约：sequence 0 → 2（跳过 1），V04 序列验证器应拒绝第二条。
      this.pushEvent({
        ...eventBase(request, 0),
        type: 'partial',
        text: 'gap-partial-0',
      });
      this.pushEvent({
        ...eventBase(request, 2),
        type: 'partial',
        text: 'gap-partial-2',
      });
      // 模拟 adapter 内部计数推进（不参与校验，仅保持 fake 状态一致）。
      this.eventSequence = 3;
    }
    if (config.emitPartialAfterEndpoint) {
      // 违约：endpoint 后仍产生 partial（V04 序列验证器应拒绝）。
      this.pushEvent({
        ...eventBase(request, 0),
        type: 'endpoint',
      });
      this.pushEvent({
        ...eventBase(request, 1),
        type: 'partial',
        text: 'late-partial',
      });
      this.eventSequence = 2;
    }
    request.signal?.addEventListener(
      'abort',
      () => {
        this.aborted = true;
        if (!this.terminalLocked) this.failWith('CANCELLED');
      },
      { once: true },
    );
    if (config.endWithoutTerminal) {
      // adapter 违约：pending 为空且直接结束（无 final/failed 终态）。
      this.ended = true;
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<StreamingTranscriptionEvent> {
    if (this.config.throwOnIterate) {
      throw new Error('fake adapter iterator failure');
    }
    while (true) {
      while (this.pending.length > 0) {
        yield this.pending.shift()!;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  readonly events: AsyncIterable<StreamingTranscriptionEvent> = this;

  pushChunk(chunk: StreamingTranscriptionPcmChunk): void {
    if (this.terminalLocked) this.throwRejected('INPUT_AFTER_TERMINAL');
    if (this.endpointSeen) this.throwRejected('INPUT_AFTER_ENDPOINT');
    if (this.config.failOnChunk) {
      this.failWith('MODEL_FAILED');
      return;
    }
    this.pushedChunks.push(chunk);
    const index = this.chunkCount;
    this.chunkCount += 1;
    const partial = this.config.partialFor?.(index) ?? `partial-${index}`;
    if (partial !== null) {
      this.pushEvent({
        ...eventBase(this.request, this.eventSequence),
        type: 'partial',
        text: partial,
      });
    }
    if (
      this.config.endpointAfterChunks !== undefined &&
      index + 1 >= this.config.endpointAfterChunks
    ) {
      this.endpointSeen = true;
      this.pushEvent({
        ...eventBase(this.request, this.eventSequence),
        type: 'endpoint',
      });
    }
  }

  finish(): void {
    if (this.terminalLocked) this.throwRejected('INPUT_AFTER_TERMINAL');
    if (this.finishCalls > 0) this.throwRejected('INPUT_AFTER_FINISH');
    this.finishCalls += 1;
    this.pushEvent({
      ...eventBase(this.request, this.eventSequence),
      type: 'final',
      text: this.config.finalText ?? 'final-text',
    });
  }

  cancel(): void {
    if (this.terminalLocked) this.throwRejected('INPUT_AFTER_TERMINAL');
    this.cancelCalls += 1;
    this.failWith('CANCELLED');
  }

  private failWith(code: StreamingTranscriptionFailureCode): void {
    if (this.terminalLocked) return;
    this.pushEvent({
      ...eventBase(this.request, this.eventSequence),
      type: 'failed',
      failureCode: code,
    });
  }

  private pushEvent(event: StreamingTranscriptionEvent): void {
    this.pending.push(event);
    this.eventSequence += 1;
    const waiters = [...this.waiters];
    this.waiters.length = 0;
    for (const resolve of waiters) resolve();
    if (isStreamingTranscriptionTerminalEvent(event)) {
      this.terminalLocked = true;
      this.terminalEvent = event;
      // 终态后迭代器是否结束：默认结束；hangAfterTerminal 模拟 adapter
      // 终态后迭代器永久挂起（pending 为空且 ended 保持 false → await 挂起）。
      if (!this.config.hangAfterTerminal) this.ended = true;
    }
  }

  private throwRejected(code: StreamingTranscriptionFailureCode): never {
    throw new StreamingTranscriptionStateError(code);
  }
}

export interface FakeTranscriptionGatewayConfig {
  session?: FakeTranscriptionSessionConfig;
  /** 若 true：beginStreaming 抛错（模拟 adapter 创建失败）。 */
  createFailure?: boolean;
}

export class FakeTranscriptionGateway implements StreamingTranscriptionGateway {
  readonly sessions: FakeTranscriptionSession[] = [];
  beginCalls = 0;
  readonly requests: StreamingTranscriptionRequest[] = [];

  constructor(private readonly config: FakeTranscriptionGatewayConfig = {}) {}

  beginStreaming(
    request: StreamingTranscriptionRequest,
  ): StreamingTranscriptionSession {
    this.beginCalls += 1;
    this.requests.push(request);
    if (this.config.createFailure) {
      throw new StreamingTranscriptionStateError('MODEL_FAILED');
    }
    const session = new FakeTranscriptionSession(
      this.config.session ?? {},
      request,
    );
    this.sessions.push(session);
    return session;
  }
}

/** 合法 PCM 字节（偶数长度、非空、上限内）：2 个 16-bit 采样。 */
export const VALID_PCM_BYTES = new Uint8Array([0x00, 0x00, 0x01, 0x00]);
