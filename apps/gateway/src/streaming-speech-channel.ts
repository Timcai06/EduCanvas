import { randomUUID } from 'node:crypto';
import type {
  StreamingSpeechGateway,
  StreamingSpeechSession,
} from '@educanvas/agent-core';
import type { StreamingTranscriptionSessionLease } from './streaming-transcription-quota-manager';
import {
  STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
  type StreamingTranscriptionQuotas,
} from './streaming-transcription-quotas';
import type {
  StreamingSpeechClientMessage,
  StreamingSpeechServerMessage,
} from './streaming-speech-wire';

interface StreamingSpeechPendingAudioFrame {
  readonly sequence: number;
  readonly pcmBytes: Uint8Array;
}

export interface StreamingSpeechChannelOptions {
  readonly gateway: StreamingSpeechGateway;
  readonly sendEvent: (event: StreamingSpeechServerMessage) => void;
  readonly sendAudio: (sequence: number, bytes: Uint8Array) => boolean;
  readonly acquireSession: () => StreamingTranscriptionSessionLease | null;
  readonly onTerminal: () => void;
  readonly createId?: () => string;
  readonly quotas?: StreamingTranscriptionQuotas;
}

export class StreamingSpeechChannel {
  private session: StreamingSpeechSession | null = null;
  private sessionLease: StreamingTranscriptionSessionLease | null = null;
  private terminal = false;
  private nextCommandSequence = 0;
  private nextInputSequence = 0;
  private acceptingText = false;

  private readonly quotas: StreamingTranscriptionQuotas;

  private readonly pendingAudioFrames: StreamingSpeechPendingAudioFrame[] = [];
  private readonly outputCreditWaiters: Array<() => void> = [];
  private nextUnsentAudioFrame = 0;
  private nextOutputSequenceToRelease = 0;
  private pendingOutputBytes = 0;

  private nextExpectedOutputSequence = 0;
  private lastAckedAudioSequence = -1;
  private providerFinished = false;

  constructor(private readonly options: StreamingSpeechChannelOptions) {
    this.quotas = options.quotas ?? STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS;
  }

  receive(message: StreamingSpeechClientMessage): void {
    if (this.terminal || message.sequence !== this.nextCommandSequence) {
      this.fail('INVALID_REQUEST');
      return;
    }
    this.nextCommandSequence += 1;
    if (message.type === 'speech.start') {
      if (this.session !== null) {
        this.fail('INVALID_REQUEST');
        return;
      }
      const lease = this.options.acquireSession();
      if (lease === null) {
        this.fail('BACKPRESSURE_EXCEEDED');
        return;
      }
      this.sessionLease = lease;
      const createId = this.options.createId ?? randomUUID;
      try {
        this.session = this.options.gateway.beginStreaming({
          taskAlias: 'speech.generate',
          modelAlias: 'speech',
          operationId: createId(),
          traceId: createId(),
        });
      } catch {
        this.fail('MODEL_FAILED');
        return;
      }
      this.acceptingText = true;
      this.options.sendEvent({
        type: 'speech.started',
        format: 'pcm_s16le',
        sampleRate: 24_000,
        channels: 1,
      });
      void this.forwardEvents(this.session);
      return;
    }
    const session = this.session;
    if (session === null) {
      this.fail('INVALID_REQUEST');
      return;
    }

    if (message.type === 'speech.submit') {
      if (!this.acceptingText) {
        this.fail('INVALID_REQUEST');
        return;
      }
      try {
        session.pushText({
          sequence: this.nextInputSequence++,
          input: message.text,
        });
      } catch {
        this.fail('MODEL_FAILED');
      }
      return;
    }
    if (message.type === 'speech.finish') {
      this.acceptingText = false;
      try {
        session.finish();
      } catch {
        this.fail('MODEL_FAILED');
      }
      return;
    }
    if (message.type === 'speech.ack') {
      this.handleAck(message.audioSequence);
      return;
    }

    this.acceptingText = false;
    this.cancelSession();
    this.terminal = true;
    this.options.sendEvent({
      type: 'speech.failed',
      failureCode: 'CANCELLED',
    });
    this.releaseSession();
    this.options.onTerminal();
  }

  disconnect(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.wakeOutputCreditWaiters();
    this.cancelSession();
    this.releaseSession();
  }

  outputBackpressureExceeded(): void {
    if (this.terminal) return;
    this.fail('BACKPRESSURE_EXCEEDED');
  }

  private handleAck(audioSequence: number): void {
    if (this.terminal) return;
    if (
      audioSequence <= this.lastAckedAudioSequence ||
      audioSequence > this.nextExpectedOutputSequence - 1 ||
      audioSequence !== this.lastAckedAudioSequence + 1
    ) {
      this.fail('INVALID_REQUEST');
      return;
    }

    this.lastAckedAudioSequence = audioSequence;
    while (
      this.nextOutputSequenceToRelease < this.pendingAudioFrames.length &&
      (() => {
        const frame = this.pendingAudioFrames[this.nextOutputSequenceToRelease];
        return frame !== undefined && frame.sequence <= audioSequence;
      })()
    ) {
      const frame = this.pendingAudioFrames[this.nextOutputSequenceToRelease]!;
      this.pendingOutputBytes -= frame.pcmBytes.byteLength;
      this.nextOutputSequenceToRelease += 1;
    }
    this.compactPendingAudioQueue();
    this.wakeOutputCreditWaiters();
    void this.flushOutput();
    this.finishIfDrained();
  }

  private compactPendingAudioQueue(): void {
    if (this.nextOutputSequenceToRelease <= 0) return;
    this.pendingAudioFrames.splice(0, this.nextOutputSequenceToRelease);
    this.nextUnsentAudioFrame -= this.nextOutputSequenceToRelease;
    this.nextOutputSequenceToRelease = 0;
  }

  private async enqueueOutputFrame(
    sequence: number,
    pcmBytes: Uint8Array,
  ): Promise<void> {
    if (this.terminal) return;
    if (sequence !== this.nextExpectedOutputSequence) {
      this.fail('MODEL_FAILED');
      return;
    }
    if (pcmBytes.byteLength === 0 || pcmBytes.byteLength % 2 !== 0) {
      this.fail('MODEL_FAILED');
      return;
    }
    if (pcmBytes.byteLength > this.quotas.maxOutputBufferedBytes) {
      this.outputBackpressureExceeded();
      return;
    }

    /* DashScope TTS 可以远快于实时播放地产生 PCM。这里的额度代表浏览器尚未按
       Web Audio 时间轴确认消费的窗口；窗口满时必须暂停拉取 Provider，而
       不是把正常的长回答误判为背压失败。Provider adapter 自身仍有独立的
       有界队列，因此等待 ACK 不会变成无界内存。 */
    while (
      !this.terminal &&
      this.pendingOutputBytes + pcmBytes.byteLength >
        this.quotas.maxOutputBufferedBytes
    ) {
      await new Promise<void>((resolve) =>
        this.outputCreditWaiters.push(resolve),
      );
    }
    if (this.terminal) return;

    this.nextExpectedOutputSequence += 1;
    this.pendingAudioFrames.push({ sequence, pcmBytes });
    this.pendingOutputBytes += pcmBytes.byteLength;
    void this.flushOutput();
  }

  private async flushOutput(): Promise<void> {
    try {
      while (
        this.nextUnsentAudioFrame < this.pendingAudioFrames.length &&
        !this.terminal
      ) {
        const frame = this.pendingAudioFrames[this.nextUnsentAudioFrame]!;
        if (!this.options.sendAudio(frame.sequence, frame.pcmBytes)) {
          this.outputBackpressureExceeded();
          return;
        }
        this.nextUnsentAudioFrame += 1;
      }
    } catch {
      this.outputBackpressureExceeded();
    }
  }

  private async forwardEvents(session: StreamingSpeechSession): Promise<void> {
    try {
      for await (const event of session.events) {
        if (this.terminal || session !== this.session) return;
        if (event.type === 'audio') {
          await this.enqueueOutputFrame(event.sequence, event.pcmBytes);
          continue;
        }
        if (event.type === 'finished') {
          this.providerFinished = true;
          this.releaseSession();
          this.finishIfDrained();
          return;
        }
        this.terminal = true;
        this.options.sendEvent({
          type: 'speech.failed',
          failureCode: event.failureCode,
        });
        this.releaseSession();
        this.options.onTerminal();
      }
    } catch {
      this.fail('MODEL_FAILED');
    }
  }

  private fail(
    failureCode: Extract<
      StreamingSpeechServerMessage,
      { type: 'speech.failed' }
    >['failureCode'],
  ): void {
    if (this.terminal) return;
    this.terminal = true;
    this.wakeOutputCreditWaiters();
    this.cancelSession();
    this.options.sendEvent({ type: 'speech.failed', failureCode });
    this.releaseSession();
    this.options.onTerminal();
  }

  private releaseSession(): void {
    this.sessionLease?.release();
    this.sessionLease = null;
  }

  /** Provider 完成不等于浏览器已接收；最后一个 enqueue ACK 后才能关闭 WS。 */
  private finishIfDrained(): void {
    if (
      this.terminal ||
      !this.providerFinished ||
      this.pendingAudioFrames.length > 0
    ) {
      return;
    }
    this.terminal = true;
    this.wakeOutputCreditWaiters();
    this.options.sendEvent({ type: 'speech.finished' });
    this.options.onTerminal();
  }

  private cancelSession(): void {
    try {
      this.session?.cancel();
    } catch {
      /* Provider adapter action errors stay behind the stable channel terminal. */
    }
  }

  private wakeOutputCreditWaiters(): void {
    this.outputCreditWaiters.splice(0).forEach((resolve) => resolve());
  }
}
