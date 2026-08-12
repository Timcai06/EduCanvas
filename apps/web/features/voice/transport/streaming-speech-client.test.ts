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
  return Uint8Array.from([
    0x45,
    0x44,
    0x54,
    0x53,
    (sequence >>> 24) & 0xff,
    (sequence >>> 16) & 0xff,
    (sequence >>> 8) & 0xff,
    sequence & 0xff,
    ...pcm,
  ]).buffer;
}

async function startClient(
  onAudio: ConstructorParameters<typeof StreamingSpeechClient>[0]['onAudio'],
  onFailed = vi.fn(),
) {
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
    onAudio,
    onFinished: vi.fn(),
    onFailed,
  });
  const starting = client.start({ notebookId: 'notebook:1' });
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
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
  return { client, socket, onFailed };
}

describe('StreamingSpeechClient', () => {
  it('共享命令序列，且只有消费者确认后才发送逐帧 ACK', async () => {
    const consumed: Array<() => void> = [];
    const audio = vi.fn((_frame, onConsumed: () => void) =>
      consumed.push(onConsumed),
    );
    const { client, socket } = await startClient(audio);
    expect(socket.protocols).toEqual(['ticket.single-use-ticket']);
    client.submit({ text: '第一句。' });
    client.finish();
    socket.receive(audioFrame(0, [1, 2]));
    expect(audio).toHaveBeenCalledWith(
      { sequence: 0, pcmBytes: Uint8Array.from([1, 2]) },
      expect.any(Function),
    );
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { type: 'speech.start', sequence: 0 },
      { type: 'speech.submit', sequence: 1, text: '第一句。' },
      { type: 'speech.finish', sequence: 2 },
    ]);
    consumed[0]!();
    consumed[0]!();
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'speech.ack',
      sequence: 3,
      audioSequence: 0,
    });
  });

  it.each([
    ['跳号', audioFrame(1, [1, 2])],
    ['重复', null],
    ['空 PCM', audioFrame(0, [])],
    ['奇数 PCM', audioFrame(0, [1])],
  ])('%s PCM fail closed', async (label, frame) => {
    const failed = vi.fn();
    const { socket } = await startClient(
      (_frame, consumed) => consumed(),
      failed,
    );
    if (label === '重复') {
      socket.receive(audioFrame(0, [1, 2]));
      socket.receive(audioFrame(0, [3, 4]));
    } else {
      socket.receive(frame!);
    }
    expect(failed).toHaveBeenCalledWith('PROTOCOL_ERROR');
    expect(socket.readyState).toBe(FakeSpeechSocket.CLOSED);
  });
});
