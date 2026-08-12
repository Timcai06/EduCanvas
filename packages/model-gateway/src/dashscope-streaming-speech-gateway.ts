import { randomUUID } from 'node:crypto';
import type {
  StreamingSpeechEvent,
  StreamingSpeechGateway,
  StreamingSpeechRequest,
  StreamingSpeechSession,
  StreamingSpeechSessionRequest,
  StreamingSpeechTextInput,
} from '@educanvas/agent-core';
import type { DashScopeSpeechConfiguration } from './dashscope-speech-config';
import {
  copyDashScopeBinaryFrame,
  parseDashScopeEnvelope,
} from './dashscope-protocol';
import {
  createDashScopeSocket,
  type DashScopeSocket,
  type DashScopeSocketFactory,
} from './dashscope-websocket';

export interface DashScopeStreamingSpeechGatewayOptions {
  configuration: DashScopeSpeechConfiguration;
  socketFactory?: DashScopeSocketFactory;
}

const MAX_QUEUED_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARACTERS_PER_SUBMISSION = 20_000;
const MAX_TEXT_CHARACTERS_PER_SESSION = 200_000;
const SPEECH_TASK_TIMEOUT_MS = 60_000;

class DashScopeSpeechSession implements StreamingSpeechSession {
  readonly events: AsyncIterable<StreamingSpeechEvent>;
  private readonly socket: DashScopeSocket;
  private readonly taskId = randomUUID();
  private readonly queue: StreamingSpeechEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private readonly pendingText: string[] = [];
  private terminal = false;
  private providerStarted = false;
  private finishRequested = false;
  private finishSent = false;
  private nextInputSequence = 0;
  private nextAudioSequence = 0;
  private totalCharacters = 0;
  private queuedAudioBytes = 0;
  private readonly timeout: ReturnType<typeof setTimeout>;
  private readonly abort = () => this.cancel();

  constructor(
    private readonly request: StreamingSpeechSessionRequest,
    private readonly options: DashScopeStreamingSpeechGatewayOptions,
  ) {
    this.events = this.iterateEvents();
    this.socket = (options.socketFactory ?? createDashScopeSocket)(
      options.configuration,
    );
    this.timeout = setTimeout(() => {
      this.fail('MODEL_FAILED');
      this.socket.close();
    }, SPEECH_TASK_TIMEOUT_MS);
    this.timeout.unref?.();
    this.attachSocket();
    request.signal?.addEventListener('abort', this.abort, { once: true });
    if (request.signal?.aborted) this.cancel();
  }

  pushText(input: StreamingSpeechTextInput): void {
    if (this.terminal || this.finishRequested) return;
    const text = input.input.trim();
    const characters = [...text].length;
    if (
      !Number.isInteger(input.sequence) ||
      input.sequence !== this.nextInputSequence ||
      characters === 0 ||
      characters > MAX_TEXT_CHARACTERS_PER_SUBMISSION ||
      this.totalCharacters + characters > MAX_TEXT_CHARACTERS_PER_SESSION
    ) {
      this.fail('MODEL_FAILED');
      this.socket.close();
      return;
    }
    this.nextInputSequence += 1;
    this.totalCharacters += characters;
    this.pendingText.push(text);
    this.flushText();
  }

  finish(): void {
    if (this.terminal || this.finishRequested) return;
    this.finishRequested = true;
    if (this.totalCharacters === 0) {
      this.fail('MODEL_FAILED');
      this.socket.close();
      return;
    }
    this.flushText();
  }

  cancel(): void {
    if (this.terminal) return;
    if (this.providerStarted) {
      try {
        this.socket.send(
          JSON.stringify({
            header: {
              action: 'finish-task',
              task_id: this.taskId,
              streaming: 'duplex',
            },
            payload: { input: { directive: 'cancel' } },
          }),
        );
      } catch {
        /* 本地 CANCELLED 终态优先于不可观察的 Provider 写入结果。 */
      }
    }
    this.fail('CANCELLED');
    this.socket.close();
  }

  private attachSocket(): void {
    this.socket.on('open', () => {
      if (this.terminal) return;
      this.send({
        header: {
          action: 'run-task',
          task_id: this.taskId,
          streaming: 'duplex',
        },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model: this.options.configuration.ttsModel,
          parameters: {
            text_type: 'PlainText',
            voice: this.options.configuration.voice,
            format: 'pcm',
            sample_rate: 24_000,
          },
          input: {},
        },
      });
    });
    this.socket.on('message', (data: unknown, isBinary?: boolean) => {
      if (this.terminal) return;
      if (isBinary) {
        if (!this.providerStarted) {
          this.fail('MODEL_FAILED');
          this.socket.close();
          return;
        }
        const bytes = copyDashScopeBinaryFrame(data);
        if (
          bytes === null ||
          bytes.byteLength % 2 !== 0 ||
          this.queuedAudioBytes + bytes.byteLength > MAX_QUEUED_AUDIO_BYTES
        ) {
          this.fail('MODEL_FAILED');
          this.socket.close();
          return;
        }
        this.queuedAudioBytes += bytes.byteLength;
        this.queue.push({
          type: 'audio',
          sequence: this.nextAudioSequence++,
          pcmBytes: bytes,
        });
        this.wake();
        return;
      }
      const envelope = parseDashScopeEnvelope(data);
      if (envelope === null || envelope.header.task_id !== this.taskId) {
        this.fail('MODEL_FAILED');
        this.socket.close();
        return;
      }
      if (envelope.header.event === 'task-started') {
        if (this.providerStarted) {
          this.fail('MODEL_FAILED');
          this.socket.close();
          return;
        }
        this.providerStarted = true;
        this.flushText();
      } else if (envelope.header.event === 'task-finished') {
        this.succeed();
        this.socket.close();
      } else if (envelope.header.event === 'task-failed') {
        this.fail('MODEL_FAILED');
        this.socket.close();
      }
      // result-generated is provider progress only; raw metadata does not cross
      // the adapter boundary.
    });
    this.socket.on('error', () => this.fail('MODEL_FAILED'));
    this.socket.on('close', () => {
      if (!this.terminal) this.fail('MODEL_FAILED');
    });
  }

  private flushText(): void {
    if (!this.providerStarted || this.terminal) return;
    while (this.pendingText.length > 0 && !this.terminal) {
      const text = this.pendingText.shift()!;
      this.send({
        header: {
          action: 'continue-task',
          task_id: this.taskId,
          streaming: 'duplex',
        },
        payload: { input: { text } },
      });
    }
    if (
      this.finishRequested &&
      !this.finishSent &&
      this.pendingText.length === 0 &&
      !this.terminal
    ) {
      this.finishSent = true;
      this.send({
        header: {
          action: 'finish-task',
          task_id: this.taskId,
          streaming: 'duplex',
        },
        payload: { input: {} },
      });
    }
  }

  private send(message: unknown): void {
    if (this.terminal) return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      this.fail('MODEL_FAILED');
      this.socket.close();
    }
  }

  private succeed(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.queue.push({ type: 'finished' });
    this.cleanup();
    this.wake();
  }

  private fail(failureCode: 'MODEL_FAILED' | 'CANCELLED'): void {
    if (this.terminal) return;
    this.terminal = true;
    this.queue.push({ type: 'failed', failureCode });
    this.cleanup();
    this.wake();
  }

  private cleanup(): void {
    clearTimeout(this.timeout);
    this.request.signal?.removeEventListener('abort', this.abort);
  }

  private wake(): void {
    this.waiters.splice(0).forEach((resolve) => resolve());
  }

  private async *iterateEvents(): AsyncIterable<StreamingSpeechEvent> {
    try {
      while (true) {
        while (this.queue.length > 0) {
          const event = this.queue.shift()!;
          if (event.type === 'audio') {
            this.queuedAudioBytes -= event.pcmBytes.byteLength;
          }
          yield event;
        }
        if (this.terminal) return;
        await new Promise<void>((resolve) => this.waiters.push(resolve));
      }
    } finally {
      if (!this.terminal) this.cancel();
      this.socket.close();
    }
  }
}

export class DashScopeStreamingSpeechGateway implements StreamingSpeechGateway {
  constructor(
    private readonly options: DashScopeStreamingSpeechGatewayOptions,
  ) {}

  beginStreaming(
    request: StreamingSpeechSessionRequest,
  ): StreamingSpeechSession {
    return new DashScopeSpeechSession(request, this.options);
  }

  async *streamSpeech(
    request: StreamingSpeechRequest,
  ): AsyncIterable<StreamingSpeechEvent> {
    const session = this.beginStreaming(request);
    session.pushText({ sequence: 0, input: request.input });
    session.finish();
    for await (const event of session.events) yield event;
  }
}
