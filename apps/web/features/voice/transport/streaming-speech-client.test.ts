import { describe, expect, it, vi } from 'vitest';
import { StreamingSpeechClient } from './streaming-speech-client';

class FakeSpeechSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeSpeechSocket;

  readonly sent: string[] = [];
  readonly protocols: readonly string[];
  readyState = FakeSpeechSocket.CONNECTING;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(
    readonly url: string,
    protocols: string | string[] = [],
  ) {
    this.protocols = typeof protocols === 'string' ? [protocols] : protocols;
    FakeSpeechSocket.last = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeSpeechSocket.CLOSED;
  }

  open(): void {
    this.readyState = FakeSpeechSocket.OPEN;
    this.onopen?.();
  }

  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
}

function audioFrame(sequence: number, pcm: readonly number[]): ArrayBuffer {
  const bytes = Uint8Array.from([
    0x45,
    0x44,
    0x54,
    0x53,
    (sequence >>> 24) & 0xff,
    (sequence >>> 16) & 0xff,
    (sequence >>> 8) & 0xff,
    sequence & 0xff,
    ...pcm,
  ]);
  return bytes.buffer;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

describe('StreamingSpeechClient', () => {
  it('使用 scoped ticket 建立会话并按序提交多个文本段', async () => {
    const audio: unknown[] = [];
    const finished = vi.fn();
    const client = new StreamingSpeechClient({
      ticketClient: {
        requestTicket: vi.fn().mockResolvedValue({
          ticket: 'single-use-ticket',
          expiresAt: '2026-08-12T00:00:00.000Z',
        }),
      },
      WebSocketCtor: FakeSpeechSocket as unknown as typeof WebSocket,
      resolveWsUrl: ({ notebookId }) =>
        `wss://gateway.invalid/v1/client/streaming-speech?notebookId=${notebookId}`,
      onAudio: (frame) => audio.push(frame),
      onFinished: finished,
      onFailed: vi.fn(),
    });
    const starting = client.start({ notebookId: 'nb-1' });
    await flush();
    const socket = FakeSpeechSocket.last;
    expect(socket.protocols).toEqual(['ticket.single-use-ticket']);
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: 'speech.start',
      sequence: 0,
    });
    socket.receive(
      JSON.stringify({
        type: 'speech.started',
        format: 'pcm_s16le',
        sampleRate: 24_000,
        channels: 1,
      }),
    );
    await starting;
    client.submit({ text: '第一句。' });
    client.submit({ text: '第二句。' });
    client.finish();
    expect(socket.sent.slice(1).map((value) => JSON.parse(value))).toEqual([
      { type: 'speech.submit', sequence: 1, text: '第一句。' },
      { type: 'speech.submit', sequence: 2, text: '第二句。' },
      { type: 'speech.finish', sequence: 3 },
    ]);
    socket.receive(audioFrame(0, [1, 2]));
    socket.receive(audioFrame(1, [3, 4]));
    expect(audio).toEqual([
      { sequence: 0, pcmBytes: Uint8Array.from([1, 2]) },
      { sequence: 1, pcmBytes: Uint8Array.from([3, 4]) },
    ]);
    socket.receive(JSON.stringify({ type: 'speech.finished' }));
    expect(finished).toHaveBeenCalledOnce();
  });

  it('拒绝跳号或奇数 PCM，并且终态后不再投影音频', async () => {
    const failed = vi.fn();
    const audio = vi.fn();
    const client = new StreamingSpeechClient({
      ticketClient: {
        requestTicket: vi.fn().mockResolvedValue({
          ticket: 'ticket',
          expiresAt: '2026-08-12T00:00:00.000Z',
        }),
      },
      WebSocketCtor: FakeSpeechSocket as unknown as typeof WebSocket,
      resolveWsUrl: () => 'wss://gateway.invalid/v1/client/streaming-speech',
      onAudio: audio,
      onFinished: vi.fn(),
      onFailed: failed,
    });
    const starting = client.start({ notebookId: 'nb-1' });
    await flush();
    const socket = FakeSpeechSocket.last;
    socket.open();
    socket.receive(
      JSON.stringify({
        type: 'speech.started',
        format: 'pcm_s16le',
        sampleRate: 24_000,
        channels: 1,
      }),
    );
    await starting;
    socket.receive(audioFrame(1, [1, 2]));
    socket.receive(audioFrame(0, [3, 4]));
    expect(audio).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith('PROTOCOL_ERROR');
    expect(socket.readyState).toBe(FakeSpeechSocket.CLOSED);
  });
});
