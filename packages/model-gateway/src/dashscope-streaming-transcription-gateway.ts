import { randomUUID } from 'node:crypto';
import {
  StreamingTranscriptionStateError,
  streamingTranscriptionEventSchema,
  streamingTranscriptionPcmChunkSchema,
  streamingTranscriptionProtocolVersion,
  type StreamingTranscriptionEvent,
  type StreamingTranscriptionGateway,
  type StreamingTranscriptionPcmChunk,
  type StreamingTranscriptionRequest,
  type StreamingTranscriptionSession,
} from '@educanvas/agent-core';
import type { DashScopeSpeechConfiguration } from './dashscope-speech-config';
import {
  dashScopeFailureCode,
  parseDashScopeEnvelope,
  parseDashScopeTranscriptionResult,
} from './dashscope-protocol';
import {
  createDashScopeSocket,
  type DashScopeSocket,
  type DashScopeSocketFactory,
} from './dashscope-websocket';

export interface DashScopeStreamingTranscriptionGatewayOptions {
  configuration: DashScopeSpeechConfiguration;
  socketFactory?: DashScopeSocketFactory;
}

class Session
  implements
    StreamingTranscriptionSession,
    AsyncIterable<StreamingTranscriptionEvent>
{
  readonly events: AsyncIterable<StreamingTranscriptionEvent> = this;
  private readonly socket: DashScopeSocket;
  private readonly taskId = randomUUID();
  private readonly queue: StreamingTranscriptionEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private readonly audioQueue: Uint8Array[] = [];
  private eventSequence = 0;
  private inputSequence = 0;
  private started = false;
  private finishing = false;
  private terminal = false;

  constructor(
    private readonly options: DashScopeStreamingTranscriptionGatewayOptions,
    private readonly request: StreamingTranscriptionRequest,
  ) {
    const opaqueId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
    if (
      !opaqueId.test(request.operationId) ||
      !opaqueId.test(request.segmentId)
    ) {
      throw new StreamingTranscriptionStateError('UNKNOWN');
    }
    this.socket = (options.socketFactory ?? createDashScopeSocket)(
      options.configuration,
    );
    this.socket.on('open', () => this.runTask());
    this.socket.on('message', (data: unknown, isBinary?: boolean) => {
      if (!isBinary) this.handleMessage(data);
    });
    this.socket.on('error', () => this.fail('MODEL_FAILED'));
    this.socket.on('close', () => {
      if (!this.terminal) this.fail('MODEL_FAILED');
    });
    request.signal?.addEventListener('abort', () => this.cancel(), {
      once: true,
    });
    if (request.signal?.aborted) this.cancel();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<StreamingTranscriptionEvent> {
    while (true) {
      while (this.queue.length) yield this.queue.shift()!;
      if (this.terminal) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  pushChunk(chunk: StreamingTranscriptionPcmChunk): void {
    if (this.terminal)
      throw new StreamingTranscriptionStateError('INPUT_AFTER_TERMINAL');
    if (this.finishing)
      throw new StreamingTranscriptionStateError('INPUT_AFTER_FINISH');
    const parsed = streamingTranscriptionPcmChunkSchema.safeParse(chunk);
    if (
      !parsed.success ||
      chunk.operationId !== this.request.operationId ||
      chunk.segmentId !== this.request.segmentId ||
      chunk.sequence !== this.inputSequence
    ) {
      throw new StreamingTranscriptionStateError('INVALID_PCM_CHUNK');
    }
    this.inputSequence += 1;
    const bytes = chunk.pcmBytes.slice();
    if (this.started) this.socket.send(bytes);
    else this.audioQueue.push(bytes);
  }

  finish(): void {
    if (this.terminal)
      throw new StreamingTranscriptionStateError('INPUT_AFTER_TERMINAL');
    if (this.finishing)
      throw new StreamingTranscriptionStateError('INPUT_AFTER_FINISH');
    this.finishing = true;
    if (this.started) this.finishTask();
  }

  cancel(): void {
    if (this.terminal) return;
    this.fail('CANCELLED');
    this.socket.close();
  }

  private runTask(): void {
    this.socket.send(
      JSON.stringify({
        header: {
          action: 'run-task',
          task_id: this.taskId,
          streaming: 'duplex',
        },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: this.options.configuration.asrModel,
          parameters: {
            format: 'pcm',
            sample_rate: 16000,
            punctuation_prediction_enabled: true,
            inverse_text_normalization_enabled: true,
            /* Live 会在 Assistant 播放与用户思考时持续存在。Paraformer v2
               默认会把长静音当作无输入并关闭任务；heartbeat 让供应商在
               静音段返回心跳，而不是把正常会话降级为 MODEL_FAILED。 */
            heartbeat: true,
          },
          input: {},
        },
      }),
    );
  }

  private finishTask(): void {
    this.socket.send(
      JSON.stringify({
        header: {
          action: 'finish-task',
          task_id: this.taskId,
          streaming: 'duplex',
        },
        payload: { input: {} },
      }),
    );
  }

  private handleMessage(raw: unknown): void {
    const body = parseDashScopeEnvelope(raw);
    if (body === null) {
      this.fail('MODEL_FAILED');
      this.socket.close();
      return;
    }
    if (body.header.task_id !== this.taskId) return;
    const event = body.header.event;
    if (event === 'task-started') {
      this.started = true;
      for (const bytes of this.audioQueue.splice(0)) this.socket.send(bytes);
      if (this.finishing) this.finishTask();
      return;
    }
    if (event === 'task-failed') {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[model-gateway] provider_failed', {
          provider: 'dashscope',
          capability: 'streaming_transcription',
          code: dashScopeFailureCode(body),
        });
      }
      this.fail('MODEL_FAILED');
      return;
    }
    if (event === 'task-finished') {
      if (!this.terminal) this.fail('MODEL_FAILED');
      return;
    }
    if (event !== 'result-generated') return;
    const result = parseDashScopeTranscriptionResult(body);
    if (result === null) {
      this.fail('MODEL_FAILED');
      this.socket.close();
      return;
    }
    const sentence = result.payload.output.sentence;
    if (sentence.heartbeat === true) return;
    const text = sentence.text.trim();
    if (!text) return;
    if (sentence.sentence_end === true) {
      /* sentence_end 是本轮领域终稿，不是 DashScope task-finished。先发送
         官方 finish-task 再关闭 socket，避免下一轮立即启动时与供应商侧
         尚未收敛的前一任务竞争。WebSocket close 会在已排队帧之后发送。 */
      if (!this.finishing) {
        this.finishing = true;
        this.finishTask();
      }
      this.emit({ type: 'endpoint' });
      this.emit({ type: 'final', text });
      this.terminal = true;
      this.wake();
      this.socket.close();
    } else {
      this.emit({ type: 'partial', text });
    }
  }

  private emit(
    fields: { type: 'endpoint' } | { type: 'partial' | 'final'; text: string },
  ): void {
    const candidate = {
      protocolVersion: streamingTranscriptionProtocolVersion,
      operationId: this.request.operationId,
      segmentId: this.request.segmentId,
      sequence: this.eventSequence,
      ...fields,
    };
    const parsed = streamingTranscriptionEventSchema.safeParse(candidate);
    if (!parsed.success) {
      this.fail('MODEL_FAILED');
      return;
    }
    this.eventSequence += 1;
    this.queue.push(parsed.data);
    this.wake();
  }

  private fail(failureCode: 'MODEL_FAILED' | 'CANCELLED'): void {
    if (this.terminal) return;
    const event = streamingTranscriptionEventSchema.parse({
      protocolVersion: streamingTranscriptionProtocolVersion,
      operationId: this.request.operationId,
      segmentId: this.request.segmentId,
      sequence: this.eventSequence,
      type: 'failed',
      failureCode,
    });
    this.queue.push(event);
    this.terminal = true;
    this.wake();
  }

  private wake(): void {
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}

export class DashScopeStreamingTranscriptionGateway implements StreamingTranscriptionGateway {
  constructor(
    private readonly options: DashScopeStreamingTranscriptionGatewayOptions,
  ) {}
  beginStreaming(
    request: StreamingTranscriptionRequest,
  ): StreamingTranscriptionSession {
    return new Session(this.options, request);
  }
}
