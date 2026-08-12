import { randomUUID } from 'node:crypto';
import type {
  StreamingSpeechGateway,
  StreamingSpeechSession,
} from '@educanvas/agent-core';
import type { StreamingTranscriptionSessionLease } from './streaming-transcription-quota-manager';
import type {
  StreamingSpeechClientMessage,
  StreamingSpeechServerMessage,
} from './streaming-speech-wire';

export interface StreamingSpeechChannelOptions {
  readonly gateway: StreamingSpeechGateway;
  readonly sendEvent: (event: StreamingSpeechServerMessage) => void;
  readonly sendAudio: (sequence: number, bytes: Uint8Array) => boolean;
  readonly acquireSession: () => StreamingTranscriptionSessionLease | null;
  readonly onTerminal: () => void;
  readonly createId?: () => string;
}

export class StreamingSpeechChannel {
  private session: StreamingSpeechSession | null = null;
  private sessionLease: StreamingTranscriptionSessionLease | null = null;
  private terminal = false;
  private nextCommandSequence = 0;
  private nextInputSequence = 0;
  private acceptingText = false;

  constructor(private readonly options: StreamingSpeechChannelOptions) {}

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
    } else if (message.type === 'speech.finish') {
      this.acceptingText = false;
      try {
        session.finish();
      } catch {
        this.fail('MODEL_FAILED');
      }
    } else {
      this.acceptingText = false;
      this.cancelSession();
    }
  }

  disconnect(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.cancelSession();
    this.releaseSession();
  }

  outputBackpressureExceeded(): void {
    if (this.terminal) return;
    this.cancelSession();
    this.fail('BACKPRESSURE_EXCEEDED');
  }

  private async forwardEvents(session: StreamingSpeechSession): Promise<void> {
    try {
      for await (const event of session.events) {
        if (this.terminal || session !== this.session) return;
        if (event.type === 'audio') {
          if (!this.options.sendAudio(event.sequence, event.pcmBytes)) {
            this.outputBackpressureExceeded();
            return;
          }
        } else if (event.type === 'finished') {
          this.terminal = true;
          this.options.sendEvent({ type: 'speech.finished' });
          this.releaseSession();
          this.options.onTerminal();
        } else {
          this.terminal = true;
          this.options.sendEvent({
            type: 'speech.failed',
            failureCode: event.failureCode,
          });
          this.releaseSession();
          this.options.onTerminal();
        }
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
    this.cancelSession();
    this.options.sendEvent({ type: 'speech.failed', failureCode });
    this.releaseSession();
    this.options.onTerminal();
  }

  private releaseSession(): void {
    this.sessionLease?.release();
    this.sessionLease = null;
  }

  private cancelSession(): void {
    try {
      this.session?.cancel();
    } catch {
      /* Provider adapter action errors stay behind the stable channel terminal. */
    }
  }
}
