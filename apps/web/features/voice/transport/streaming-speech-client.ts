import { z } from 'zod';
import type { StreamingTranscriptionTicketClient } from './streaming-transcription-ticket-client';
import { validateStreamingWsUrl } from './streaming-transcription-client';

const serverMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('speech.started'),
      format: z.literal('pcm_s16le'),
      sampleRate: z.literal(24_000),
      channels: z.literal(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('speech.finished'),
    })
    .strict(),
  z
    .object({
      type: z.literal('speech.failed'),
      failureCode: z.enum([
        'MODEL_FAILED',
        'CANCELLED',
        'INVALID_REQUEST',
        'BACKPRESSURE_EXCEEDED',
      ]),
    })
    .strict(),
]);

const FRAME_HEADER_BYTES = 8;
const FRAME_MAGIC = [0x45, 0x44, 0x54, 0x53] as const;

export interface StreamingSpeechAudioFrame {
  readonly sequence: number;
  readonly pcmBytes: Uint8Array;
}

export interface StreamingSpeechClientHandlers {
  readonly onAudio: (frame: StreamingSpeechAudioFrame) => void;
  readonly onFinished: () => void;
  readonly onFailed: (failureCode: string) => void;
}

export interface StreamingSpeechClientOptions extends StreamingSpeechClientHandlers {
  readonly ticketClient: StreamingTranscriptionTicketClient;
  readonly WebSocketCtor: typeof WebSocket;
  readonly resolveWsUrl: (input: { notebookId: string }) => string;
  readonly allowedInsecureWsHosts?: readonly string[];
  readonly connectionTimeoutMs?: number;
}

export interface LiveSpeechSessionClient {
  start(input: { notebookId: string; signal?: AbortSignal }): Promise<void>;
  submit(input: { text: string }): void;
  finish(): void;
  cancel(): void;
}

export class StreamingSpeechClient implements LiveSpeechSessionClient {
  private socket: WebSocket | null = null;
  private commandSequence = 0;
  private expectedAudioSequence = 0;
  private terminal = false;
  private started = false;
  private finishing = false;
  private abortCleanup: (() => void) | null = null;

  constructor(private readonly options: StreamingSpeechClientOptions) {}

  async start({
    notebookId,
    signal,
  }: {
    notebookId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    if (this.socket || this.terminal) throw new Error('SPEECH_ALREADY_STARTED');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const grant = await this.options.ticketClient.requestTicket({
      notebookId,
      signal,
    });
    const url = this.options.resolveWsUrl({ notebookId });
    const validation = validateStreamingWsUrl(
      url,
      this.options.allowedInsecureWsHosts,
    );
    if (!validation.ok) throw new Error('SPEECH_CONNECTION_FAILED');
    const socket = new this.options.WebSocketCtor(url, [
      `ticket.${grant.ticket}`,
    ]);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settleFailure = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanupTimer();
        reject(error);
      };
      const cleanupTimer = () => clearTimeout(timeout);
      const rejectProtocol = () => {
        const wasStarted = this.started;
        this.enterTerminal();
        if (wasStarted) this.options.onFailed('PROTOCOL_ERROR');
        else settleFailure(new Error('SPEECH_PROTOCOL_ERROR'));
      };
      const timeout = setTimeout(() => {
        this.enterTerminal();
        settleFailure(new Error('SPEECH_CONNECTION_FAILED'));
      }, this.options.connectionTimeoutMs ?? 8_000);
      const abort = () => {
        this.enterTerminal();
        settleFailure(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.abortCleanup = () => signal?.removeEventListener('abort', abort);

      socket.onopen = () => {
        if (this.terminal) return;
        this.send({
          type: 'speech.start',
          sequence: this.commandSequence++,
        });
      };
      socket.onmessage = (event) => {
        if (this.terminal) return;
        if (typeof event.data !== 'string') {
          try {
            this.handleAudioFrame(event.data);
          } catch {
            rejectProtocol();
          }
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          rejectProtocol();
          return;
        }
        const result = serverMessageSchema.safeParse(parsed);
        if (!result.success) {
          rejectProtocol();
          return;
        }
        if (!this.started && result.data.type !== 'speech.started') {
          rejectProtocol();
          return;
        }
        if (result.data.type === 'speech.started') {
          if (this.started || settled) {
            rejectProtocol();
            return;
          }
          this.started = true;
          settled = true;
          cleanupTimer();
          resolve();
          return;
        }
        if (result.data.type === 'speech.finished') {
          this.enterTerminal();
          this.options.onFinished();
          return;
        }
        this.enterTerminal();
        this.options.onFailed(result.data.failureCode);
      };
      socket.onerror = () => {
        if (!this.started) settleFailure(new Error('SPEECH_CONNECTION_FAILED'));
      };
      socket.onclose = () => {
        if (this.terminal) return;
        this.enterTerminal(false);
        if (!this.started) {
          settleFailure(new Error('SPEECH_CONNECTION_FAILED'));
        } else {
          this.options.onFailed('CONNECTION_LOST');
        }
      };
    });
  }

  submit(input: { text: string }): void {
    if (!this.started || this.terminal || this.finishing) {
      throw new Error('SPEECH_NOT_OPEN');
    }
    this.send({
      type: 'speech.submit',
      sequence: this.commandSequence++,
      text: input.text,
    });
  }

  finish(): void {
    if (!this.started || this.terminal || this.finishing) return;
    this.finishing = true;
    this.send({
      type: 'speech.finish',
      sequence: this.commandSequence++,
    });
  }

  cancel(): void {
    if (!this.terminal && this.started) {
      try {
        this.send({
          type: 'speech.cancel',
          sequence: this.commandSequence++,
        });
      } catch {
        /* 本地静音优先；连接异常不应阻塞取消终态。 */
      }
    }
    this.enterTerminal();
  }

  private handleAudioFrame(data: unknown): void {
    if (!this.started || !(data instanceof ArrayBuffer)) {
      throw new Error('SPEECH_PROTOCOL_ERROR');
    }
    const bytes = new Uint8Array(data);
    if (bytes.byteLength <= FRAME_HEADER_BYTES) {
      throw new Error('SPEECH_PROTOCOL_ERROR');
    }
    for (let index = 0; index < FRAME_MAGIC.length; index += 1) {
      if (bytes[index] !== FRAME_MAGIC[index]) {
        throw new Error('SPEECH_PROTOCOL_ERROR');
      }
    }
    const sequence = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      FRAME_HEADER_BYTES,
    ).getUint32(4, false);
    const pcmBytes = bytes.slice(FRAME_HEADER_BYTES);
    if (
      sequence !== this.expectedAudioSequence ||
      pcmBytes.byteLength % 2 !== 0
    ) {
      throw new Error('SPEECH_PROTOCOL_ERROR');
    }
    this.expectedAudioSequence += 1;
    this.options.onAudio({ sequence, pcmBytes });
  }

  private send(message: object): void {
    if (
      !this.socket ||
      this.socket.readyState !== this.options.WebSocketCtor.OPEN
    ) {
      throw new Error('SPEECH_CONNECTION_FAILED');
    }
    this.socket.send(JSON.stringify(message));
  }

  private enterTerminal(closeSocket = true): void {
    if (this.terminal) return;
    this.terminal = true;
    this.abortCleanup?.();
    this.abortCleanup = null;
    if (closeSocket) {
      try {
        this.socket?.close(1000, 'speech terminal');
      } catch {
        /* socket 已关闭。 */
      }
    }
    this.socket = null;
  }
}
