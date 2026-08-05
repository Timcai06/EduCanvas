/**
 * sherpa 流式转录会话实现（V08，内部模块，不从 index.ts 导出）。
 *
 * 与公共 Adapter（`sherpa-streaming-transcription-gateway.ts`）分离，
 * 保持公共入口只暴露 Gateway 与受控 options；本文件承载单个会话的
 * recognizer 生命周期、PCM 喂入、事件投影、取消、超时与安全错误归一化。
 *
 * ## 事件投影纪律
 *
 * - recognizer 输出视为不可信：partial / final 文本必须通过 V04
 *   `streamingTranscriptionEventSchema`（空白、超长、非字符串拒绝）；
 * - 事件 sequence 从 0 独立连续递增，与 PCM chunk 的 sequence 分域；
 * - 唯一终态：final / failed 先到先得，endpoint 不是终态；cancel / abort /
 *   超时 / recognizer 异常只会投影一个 failed 终态；
 * - finish 只关闭输入侧；最终事件形成前的 cancel / abort 仍可抢占 flush，
 *   及时收敛为 CANCELLED；终态形成后的 abort 不覆盖既有结果。
 *
 * ## 安全错误面
 *
 * 事件与抛给调用方的错误只暴露稳定 failureCode；日志只记录稳定标签。
 * recognizer 释放（free）最多一次，抛错不覆盖已形成的终态。
 */

import {
  STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
  StreamingTranscriptionStateError,
  applyStreamingTranscriptionCancel,
  applyStreamingTranscriptionChunk,
  applyStreamingTranscriptionEndpoint,
  applyStreamingTranscriptionFinish,
  createStreamingSegmentationSnapshot,
  isStreamingTranscriptionTerminalEvent,
  streamingTranscriptionEventSchema,
  streamingTranscriptionPcmChunkSchema,
  streamingTranscriptionProtocolVersion,
  type StreamingSegmentationSnapshot,
  type StreamingTranscriptionEvent,
  type StreamingTranscriptionFailureCode,
  type StreamingTranscriptionPcmChunk,
  type StreamingTranscriptionRequest,
  type StreamingTranscriptionSession,
} from '@educanvas/agent-core';
import type { SherpaStreamingRecognizer } from './sherpa-streaming-recognizer';
import type {
  SherpaStreamingTranscriptionGatewayOptions,
  SherpaStreamingTranscriptionLogEntry,
} from './sherpa-streaming-transcription-gateway';

/**
 * finish 后轮询最终文本的间隔（毫秒）。真实 sherpa WASM 是同步推理，
 * inputFinished 后通常立即就绪；轮询只是为"尚未就绪"的识别器留出推进
 * 窗口，固定值避免引入额外配置面。
 */
const FINAL_POLL_INTERVAL_MS = 25;

/** 把 V04 pcm_s16le 分片确定性转换为 recognizer 需要的 Float32（-1..1）。 */
function pcmS16LeToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32_768;
  }
  return samples;
}

/**
 * opaque id 约束与 V04 contracts 的内部 schema 一致（1–256 字符、允许的
 * 字符集）。V04 未导出其内部 id schema，此处按 V07 envelope 同样的方式
 * 复制约束：构造时校验 request 身份，保证此后所有事件 candidate 的
 * operationId/segmentId 必然通过 schema（终态投影 parse 永不因身份失败）。
 */
const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function assertOpaqueId(value: string): void {
  if (value.length < 1 || value.length > 256 || !opaqueIdPattern.test(value)) {
    throw new StreamingTranscriptionStateError('UNKNOWN');
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 单个流式转录会话：输入动作与事件消费分离，保持唯一终态纪律。 */
export class SherpaStreamingTranscriptionSession implements StreamingTranscriptionSession {
  private readonly recognizer: SherpaStreamingRecognizer;
  private readonly request: StreamingTranscriptionRequest;
  private readonly options: SherpaStreamingTranscriptionGatewayOptions;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly deadline: number;

  /** V06 输入侧状态机快照：只记录字节数与序号，不持有 PCM。 */
  private snapshot: StreamingSegmentationSnapshot;

  /** 事件队列与等待唤醒；终态投影后 `streamEnded` 结束事件流。 */
  private readonly pendingEvents: StreamingTranscriptionEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private streamEnded = false;

  /** 事件 sequence 从 0 连续递增，与输入 chunk sequence 分域。 */
  private eventSequence = 0;

  /** 唯一终态锁：final/failed 先到先得，其余终态路径一律忽略。 */
  private terminalLocked = false;
  /** 已投影 endpoint 事件；endpoint 后不再产生 partial。 */
  private endpointEventSeen = false;

  private timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  private freed = false;
  private readonly onAbort: () => void;

  constructor(
    options: SherpaStreamingTranscriptionGatewayOptions,
    request: StreamingTranscriptionRequest,
  ) {
    // request 身份是此后所有事件 candidate 的固定字段，先于一切校验。
    assertOpaqueId(request.operationId);
    assertOpaqueId(request.segmentId);
    this.options = options;
    this.request = request;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    try {
      // 工厂异常（如 V09 真实实现加载模型失败）不向调用方泄漏原始错误：
      // 同步抛稳定码，且此时尚未创建超时定时器与监听器，无泄漏面。
      this.recognizer = options.recognizerFactory.create();
    } catch {
      throw new StreamingTranscriptionStateError('MODEL_FAILED');
    }
    this.snapshot = createStreamingSegmentationSnapshot(
      request.operationId,
      request.segmentId,
    );
    this.deadline = this.now() + options.timeoutMs;
    this.timeoutHandle = setTimeout(() => {
      // 会话级兜底：到期未终态 → MODEL_FAILED（唯一终态由锁保证）。
      this.failWith('MODEL_FAILED');
    }, options.timeoutMs);

    this.onAbort = () => {
      if (this.terminalLocked) return;
      // V06 的 finished 表示输入侧已经关闭，不是转录事件终态。上层取消
      // 必须仍能抢占正在等待的 flush，否则用户取消会被拖到模型超时。
      if (this.snapshot.phase === 'finished') {
        this.failWith('CANCELLED');
        return;
      }
      this.cancel();
    };
    this.log({ label: 'session_started' });
    if (request.signal?.aborted === true) this.onAbort();
    else
      request.signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<StreamingTranscriptionEvent> {
    while (true) {
      while (this.pendingEvents.length > 0) {
        // 队列只在生成器内部消费，shift 是安全的。
        yield this.pendingEvents.shift()!;
      }
      if (this.streamEnded) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  /** 消费转录事件（partial/endpoint/final/failed）；每次迭代共享会话状态。 */
  readonly events: AsyncIterable<StreamingTranscriptionEvent> = this;

  pushChunk(chunk: StreamingTranscriptionPcmChunk): void {
    if (this.terminalLocked) {
      this.throwRejected('INPUT_AFTER_TERMINAL');
    }
    let parsed: StreamingTranscriptionPcmChunk;
    try {
      // V04 Schema：单分片格式（采样率/声道/编码/字节上限/偶数长度）。
      parsed = streamingTranscriptionPcmChunkSchema.parse(chunk);
    } catch {
      this.throwRejected('INVALID_PCM_CHUNK');
    }
    // V06 状态机：会话归属、sequence 连续、endpoint/finish/终态拒绝。
    this.snapshot = applyStreamingTranscriptionChunk(this.snapshot, parsed);
    try {
      const samples = pcmS16LeToFloat32(parsed.pcmBytes);
      if (
        !this.recognizer.acceptWaveform(
          STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
          samples,
        )
      ) {
        throw new Error('recognizer_rejected_waveform');
      }
      this.recognizer.decode();
      // recognizer 的文本/端点查询同样是不可信调用，必须留在归一化边界内。
      this.emitPartial();
      this.emitEndpointIfDetected();
    } catch {
      // recognizer 异常归一化为稳定码，不向调用方泄漏原始错误。
      this.failWith('MODEL_FAILED');
      return;
    }
  }

  finish(): void {
    if (this.terminalLocked) this.throwRejected('INPUT_AFTER_TERMINAL');
    // V06：生成 1.5 秒零值尾部描述；重复 finish → INPUT_AFTER_FINISH。
    this.snapshot = applyStreamingTranscriptionFinish(this.snapshot);
    void this.flushFinal();
  }

  cancel(): void {
    if (this.terminalLocked) this.throwRejected('INPUT_AFTER_TERMINAL');
    // V06：进入 cancelled 终态且不生成尾部静音；重复 cancel → 稳定码。
    this.snapshot = applyStreamingTranscriptionCancel(this.snapshot);
    this.failWith('CANCELLED');
  }

  /** 拒绝非法输入动作：记录稳定日志后抛稳定错误（消息即稳定码）。 */
  private throwRejected(code: StreamingTranscriptionFailureCode): never {
    this.log({ label: 'input_rejected', failureCode: code });
    throw new StreamingTranscriptionStateError(code);
  }

  /** 投影 partial 事件；空白/超长/非法文本不进入领域事件流。 */
  private emitPartial(): void {
    if (this.terminalLocked || this.endpointEventSeen) return;
    const text = this.recognizer.getPartialText();
    const candidate: StreamingTranscriptionEvent = {
      protocolVersion: streamingTranscriptionProtocolVersion,
      operationId: this.request.operationId,
      segmentId: this.request.segmentId,
      sequence: this.eventSequence,
      type: 'partial',
      text,
    };
    // recognizer 输出不可信：schema 拒绝空白、超长与非字符串。
    if (!streamingTranscriptionEventSchema.safeParse(candidate).success) return;
    this.pushEvent(candidate);
  }

  /** 投影 endpoint 事件（模型侧端点）；endpoint 不是终态。 */
  private emitEndpointIfDetected(): void {
    if (this.terminalLocked || this.endpointEventSeen) return;
    if (!this.recognizer.isEndpoint()) return;
    // 输入侧进入 endpointed：此后 pushChunk 抛 INPUT_AFTER_ENDPOINT。
    this.snapshot = applyStreamingTranscriptionEndpoint(this.snapshot);
    const candidate: StreamingTranscriptionEvent = {
      protocolVersion: streamingTranscriptionProtocolVersion,
      operationId: this.request.operationId,
      segmentId: this.request.segmentId,
      sequence: this.eventSequence,
      type: 'endpoint',
    };
    // endpoint 无自由字段，结构固定；按纪律仍走 schema 校验。
    this.pushEvent(streamingTranscriptionEventSchema.parse(candidate));
    // endpoint 已投影：此后不再产生 partial（V04 序列纪律）。
    this.endpointEventSeen = true;
  }

  /** 投影 final 事件；非法最终文本无法形成成功终态 → MODEL_FAILED。 */
  private emitFinal(text: string): void {
    if (this.terminalLocked) return;
    const candidate: StreamingTranscriptionEvent = {
      protocolVersion: streamingTranscriptionProtocolVersion,
      operationId: this.request.operationId,
      segmentId: this.request.segmentId,
      sequence: this.eventSequence,
      type: 'final',
      text,
    };
    if (!streamingTranscriptionEventSchema.safeParse(candidate).success) {
      this.failWith('MODEL_FAILED');
      return;
    }
    this.pushEvent(candidate);
  }

  /** 投影失败终态；先到先得，已终态时忽略（唯一终态纪律）。 */
  private failWith(code: StreamingTranscriptionFailureCode): void {
    if (this.terminalLocked) return;
    const candidate: StreamingTranscriptionEvent = {
      protocolVersion: streamingTranscriptionProtocolVersion,
      operationId: this.request.operationId,
      segmentId: this.request.segmentId,
      sequence: this.eventSequence,
      type: 'failed',
      failureCode: code,
    };
    this.pushEvent(streamingTranscriptionEventSchema.parse(candidate));
  }

  /** 入队事件；终态事件触发清理（清超时、解除 abort 监听、释放 recognizer）。 */
  private pushEvent(event: StreamingTranscriptionEvent): void {
    this.pendingEvents.push(event);
    this.eventSequence += 1;
    // 先拷贝再清空：waiters 与 this.waiters 是同一数组引用，
    // 直接 length=0 会让下面的遍历拿到空数组，通知永不派发。
    const waiters = [...this.waiters];
    this.waiters.length = 0;
    for (const resolve of waiters) resolve();
    if (isStreamingTranscriptionTerminalEvent(event)) {
      this.terminalLocked = true;
      this.cleanup();
    }
  }

  /** finish 后的尾部 flush：喂 1.5 秒零值 → inputFinished → 等最终文本。 */
  private async flushFinal(): Promise<void> {
    try {
      for (const tail of this.snapshot.tailChunks) {
        // V06 只给描述，真实零值 buffer 在这里按字节数生成（isZero 恒真）。
        if (
          !this.recognizer.acceptWaveform(
            STREAMING_TRANSCRIPTION_SAMPLE_RATE_HZ,
            new Float32Array(tail.byteLength / 2),
          )
        ) {
          throw new Error('recognizer_rejected_tail');
        }
      }
      this.recognizer.inputFinished();
      while (!this.terminalLocked && this.now() < this.deadline) {
        this.recognizer.decode();
        const finalText = this.recognizer.getFinalText();
        if (finalText !== null) {
          this.emitFinal(finalText);
          return;
        }
        await this.sleep(FINAL_POLL_INTERVAL_MS);
      }
      if (!this.terminalLocked) this.failWith('MODEL_FAILED');
    } catch {
      // flush 阶段 recognizer 异常同样归一化；终态已形成则忽略。
      if (!this.terminalLocked) this.failWith('MODEL_FAILED');
    }
  }

  /** 唯一终态清理：最多执行一次，free 抛错不能覆盖已形成的终态。 */
  private cleanup(): void {
    if (this.timeoutHandle !== undefined) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    this.request.signal?.removeEventListener('abort', this.onAbort);
    this.freeRecognizerOnce();
    this.streamEnded = true;
    this.log({ label: 'session_ended' });
  }

  /** recognizer 释放；标志位保证最多调用一次。 */
  private freeRecognizerOnce(): void {
    if (this.freed) return;
    this.freed = true;
    try {
      this.recognizer.free();
    } catch {
      // free 失败不泄漏为领域错误：终态已由 cleanup 时的状态决定。
    }
  }

  private log(
    entry: Omit<
      SherpaStreamingTranscriptionLogEntry,
      'operationId' | 'segmentId'
    >,
  ): void {
    try {
      // 可观测性回调不是业务终态的一部分；调用方日志故障不能破坏清理、
      // 取消或已形成的 final/failed 事件。
      this.options.log?.({
        ...entry,
        operationId: this.request.operationId,
        segmentId: this.request.segmentId,
      });
    } catch {
      // 日志失败按 best-effort 处理，且不递归记录原始异常。
    }
  }
}
