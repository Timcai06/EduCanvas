import {
  MAX_PCM_CHUNK_BYTES,
  validateStreamingTranscriptionClientMessageSequence,
  type StreamingTranscriptionClientMessage,
  type StreamingTranscriptionEvent,
  type StreamingTranscriptionSnapshot,
} from '@educanvas/agent-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StreamingTranscriptionClient,
  StreamingTranscriptionClientError,
  validateStreamingWsUrl,
  type StreamingTranscriptionClientLogEntry,
  type StreamingTranscriptionClientOptions,
  type StreamingTranscriptionClientStatus,
  type StreamingTranscriptionTerminalResult,
} from './streaming-transcription-client';
import {
  StreamingTranscriptionTicketError,
  type StreamingTranscriptionTicketClient,
} from './streaming-transcription-ticket-client';

const VERSION = 'educanvas.streaming-transcription.v1' as const;
const TICKET = 'ticket-secret-value-123';

/** 可手动驱动的 Fake WebSocket：记录 URL/子协议/发送帧，可触发 open/close/error/message。 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly protocols: readonly string[];
  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;
  closeCode: number | null = null;
  /** 测试驱动：置 true 后 send() 抛错（模拟连接已断时写入失败）。 */
  sendThrows = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(url: string, protocols?: string | readonly string[]) {
    this.url = url;
    this.protocols =
      typeof protocols === 'string' ? [protocols] : (protocols ?? []);
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, callback: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(callback);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, callback: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((candidate) => candidate !== callback),
    );
  }

  send(data: string): void {
    if (this.sendThrows) throw new Error('fake send failure');
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.closeCode = code;
    this.readyState = FakeWebSocket.CLOSING;
    this.emit('close', { code });
    this.readyState = FakeWebSocket.CLOSED;
  }

  terminate(): void {
    this.emit('close', { code: 1006 });
    this.readyState = FakeWebSocket.CLOSED;
  }

  // —— 测试驱动器 ——
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  receive(raw: string): void {
    this.emit('message', { data: raw });
  }

  /** 握手失败/网络中断：error 后跟 close（浏览器行为）。 */
  fail(): void {
    this.emit('error', {});
    this.emit('close', { code: 1006 });
  }

  private emit(type: string, event: unknown): void {
    for (const callback of this.listeners.get(type) ?? []) callback(event);
  }

  static last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }
}

interface Harness {
  client: StreamingTranscriptionClient;
  ticketClient: StreamingTranscriptionTicketClient;
  logs: StreamingTranscriptionClientLogEntry[];
  snapshots: StreamingTranscriptionSnapshot[];
  statuses: StreamingTranscriptionClientStatus[];
  terminals: StreamingTranscriptionTerminalResult[];
}

function makeHarness(
  overrides: Partial<StreamingTranscriptionClientOptions> = {},
): Harness {
  const logs: StreamingTranscriptionClientLogEntry[] = [];
  const snapshots: StreamingTranscriptionSnapshot[] = [];
  const statuses: StreamingTranscriptionClientStatus[] = [];
  const terminals: StreamingTranscriptionTerminalResult[] = [];
  const ticketClient: StreamingTranscriptionTicketClient = {
    requestTicket: vi.fn().mockResolvedValue({
      ticket: TICKET,
      expiresAt: '2026-08-06T00:00:00.000Z',
    }),
  };
  const client = new StreamingTranscriptionClient({
    ticketClient,
    WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    resolveWsUrl: ({ notebookId }) =>
      `wss://gateway.invalid/v1/client/streaming-transcription?notebookId=${encodeURIComponent(notebookId)}`,
    createOperationId: () => 'op-1',
    createSegmentId: () => 'seg-1',
    log: (entry) => logs.push(entry),
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onStatus: (status) => statuses.push(status),
    onTerminal: (result) => terminals.push(result),
    ...overrides,
  });
  return { client, ticketClient, logs, snapshots, statuses, terminals };
}

/** 推进所有 pending microtask（非固定 sleep；仅用于让 beginConnect 的 await 链落地）。 */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

/** 发起 start 并驱动握手到 open，返回已连接 socket。 */
async function startOpen(harness: Harness, notebookId = 'nb-1') {
  const started = harness.client.start({ notebookId });
  await flushMicrotasks();
  const ws = FakeWebSocket.last();
  ws.open();
  await started;
  return ws;
}

function partialEvent(
  sequence: number,
  text: string,
  segmentId = 'seg-1',
  operationId = 'op-1',
): StreamingTranscriptionEvent {
  return {
    protocolVersion: VERSION,
    operationId,
    segmentId,
    sequence,
    type: 'partial',
    text,
  };
}

function endpointEvent(
  sequence: number,
  segmentId = 'seg-1',
  operationId = 'op-1',
): StreamingTranscriptionEvent {
  return {
    protocolVersion: VERSION,
    operationId,
    segmentId,
    sequence,
    type: 'endpoint',
  };
}

function finalEvent(
  sequence: number,
  text: string,
  segmentId = 'seg-1',
  operationId = 'op-1',
): StreamingTranscriptionEvent {
  return {
    protocolVersion: VERSION,
    operationId,
    segmentId,
    sequence,
    type: 'final',
    text,
  };
}

function failedEvent(
  sequence: number,
  failureCode: StreamingTranscriptionEvent['type'] extends never
    ? never
    : 'CANCELLED' | 'MODEL_FAILED' | 'UNKNOWN',
  segmentId = 'seg-1',
  operationId = 'op-1',
): StreamingTranscriptionEvent {
  return {
    protocolVersion: VERSION,
    operationId,
    segmentId,
    sequence,
    type: 'failed',
    failureCode,
  };
}

function pcm(...bytes: number[]): Uint8Array {
  return Uint8Array.from(bytes);
}

function decodePcmBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** 把 wire 发送帧还原为 V07 client 消息（chunk 的 base64 解码回字节）。 */
function decodeSentFrames(
  ws: FakeWebSocket,
): StreamingTranscriptionClientMessage[] {
  return ws.sent.map((raw) => {
    const message = JSON.parse(raw) as Record<string, unknown>;
    if (message.type === 'chunk') {
      message.pcmBytes = decodePcmBase64(message.pcmBytes as string);
    }
    return message as unknown as StreamingTranscriptionClientMessage;
  });
}

function pcmBytesOf(
  message: StreamingTranscriptionClientMessage,
): Uint8Array | null {
  return message.type === 'chunk' ? message.pcmBytes : null;
}

afterEach(() => {
  FakeWebSocket.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('握手与 ticket', () => {
  it('默认 ID 生成器以正确 Crypto receiver 调用 randomUUID', async () => {
    const fakeCrypto = {
      randomUUID(this: unknown) {
        if (this !== fakeCrypto) throw new TypeError('Illegal invocation');
        return '00000000-0000-4000-8000-000000000001';
      },
    };
    vi.stubGlobal('crypto', fakeCrypto);
    const harness = makeHarness({
      createOperationId: undefined,
      createSegmentId: undefined,
    });

    const ws = await startOpen(harness);
    expect(decodeSentFrames(ws)[0]).toMatchObject({
      operationId: '00000000-0000-4000-8000-000000000001',
      segmentId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('start 用 ticket 子协议建立连接，ticket 不进入 URL，start 消息 sequence 0', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);

    expect(harness.ticketClient.requestTicket).toHaveBeenCalledWith({
      notebookId: 'nb-1',
      signal: undefined,
    });
    expect(ws.url).not.toContain(TICKET);
    expect(ws.url).toContain('notebookId=nb-1');
    expect(ws.protocols).toEqual([`ticket.${TICKET}`]);

    const frames = decodeSentFrames(ws);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: 'start',
      sequence: 0,
      operationId: 'op-1',
      segmentId: 'seg-1',
      protocolVersion: VERSION,
      sampleRate: 16_000,
      channels: 1,
      encoding: 'pcm_s16le',
    });
    expect(harness.client.getStatus().phase).toBe('open');
    expect(harness.statuses.map((status) => status.phase)).toEqual([
      'starting',
      'open',
    ]);
  });

  it('ticket 请求失败：start reject TICKET_FAILED，终态 ticket-failed，不建 socket', async () => {
    const harness = makeHarness({
      ticketClient: {
        requestTicket: vi
          .fn()
          .mockRejectedValue(
            new StreamingTranscriptionTicketError(
              'HTTP_ERROR',
              'STREAMING_TRANSCRIPTION_UNAVAILABLE',
            ),
          ),
      },
    });
    await expect(
      harness.client.start({ notebookId: 'nb-1' }),
    ).rejects.toMatchObject({ code: 'TICKET_FAILED' });
    expect(harness.client.getStatus().phase).toBe('terminal');
    expect(harness.terminals).toEqual([
      { reason: 'ticket-failed', errorCode: 'TICKET_FAILED' },
    ]);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('握手失败（open 前 error/close）：start reject CONNECTION_FAILED', async () => {
    const harness = makeHarness();
    const started = harness.client.start({ notebookId: 'nb-1' });
    await flushMicrotasks();
    FakeWebSocket.last().fail();
    await expect(started).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
    expect(harness.client.getStatus().phase).toBe('terminal');
    expect(harness.terminals).toEqual([
      { reason: 'connection-failed', errorCode: 'CONNECTION_FAILED' },
    ]);
  });

  it('starting 中重复 start 拒绝 ALREADY_STARTED', async () => {
    const harness = makeHarness();
    const first = harness.client.start({ notebookId: 'nb-1' });
    const second = harness.client.start({ notebookId: 'nb-1' });
    await expect(second).rejects.toMatchObject({ code: 'ALREADY_STARTED' });
    await flushMicrotasks();
    FakeWebSocket.last().open();
    await first;
  });

  it('start 前 signal 已 abort：立即拒绝 ABORTED，不请求 ticket', async () => {
    const harness = makeHarness();
    const controller = new AbortController();
    controller.abort();
    await expect(
      harness.client.start({ notebookId: 'nb-1', signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(harness.ticketClient.requestTicket).not.toHaveBeenCalled();
  });

  it('ticket 换取期间 abort：start reject ABORTED，终态 aborted', async () => {
    let resolveTicket!: (grant: { ticket: string; expiresAt: string }) => void;
    const harness = makeHarness({
      ticketClient: {
        requestTicket: vi.fn().mockImplementation(
          () =>
            new Promise<{ ticket: string; expiresAt: string }>((resolve) => {
              resolveTicket = resolve;
            }),
        ),
      },
    });
    const controller = new AbortController();
    const started = harness.client.start({
      notebookId: 'nb-1',
      signal: controller.signal,
    });
    await flushMicrotasks();
    controller.abort();
    await expect(started).rejects.toMatchObject({ code: 'ABORTED' });
    expect(harness.terminals).toEqual([
      { reason: 'aborted', errorCode: 'ABORTED' },
    ]);
    // 迟到的 ticket 解析被忽略（已终态）。
    resolveTicket({ ticket: TICKET, expiresAt: '2026-08-06T00:00:00.000Z' });
    await flushMicrotasks();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('starting 中 disconnect：终态 disconnected，start reject NOT_STARTED', async () => {
    const harness = makeHarness();
    const started = harness.client.start({ notebookId: 'nb-1' });
    await flushMicrotasks();
    harness.client.disconnect();
    await expect(started).rejects.toMatchObject({ code: 'NOT_STARTED' });
    expect(harness.terminals).toEqual([{ reason: 'disconnected' }]);
  });
});

describe('发送状态机', () => {
  it('start→chunk→finish 的发送帧通过 V07 序列验证；chunkSequence 独立连续', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);

    harness.client.sendChunk(pcm(0xde, 0xad, 0xbe, 0xef));
    harness.client.sendChunk(pcm(0x01, 0x02, 0x03, 0x04));
    harness.client.finish();

    const frames = decodeSentFrames(ws);
    expect(frames).toHaveLength(4);
    // envelope sequence 连续；chunk 的 PCM 分片序号独立连续。
    expect(frames.map((frame) => frame.sequence)).toEqual([0, 1, 2, 3]);
    const chunks = frames.filter(
      (
        frame,
      ): frame is Extract<
        StreamingTranscriptionClientMessage,
        { type: 'chunk' }
      > => frame.type === 'chunk',
    );
    expect(chunks.map((chunk) => chunk.chunkSequence)).toEqual([0, 1]);
    expect(validateStreamingTranscriptionClientMessageSequence(frames)).toBe(
      true,
    );
  });

  it('chunk 的 pcmBytes 以严格 base64 上线（wire 契约）', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    harness.client.sendChunk(pcm(0xde, 0xad, 0xbe, 0xef));
    const chunkFrame = JSON.parse(ws.sent[1]!) as Record<string, unknown>;
    expect(chunkFrame.pcmBytes).toBe('3q2+7w==');
    expect(pcmBytesOf(decodeSentFrames(ws)[1]!)).toEqual(
      pcm(0xde, 0xad, 0xbe, 0xef),
    );
  });

  it('未 start 就发送动作一律拒绝 NOT_STARTED', () => {
    const harness = makeHarness();
    expect(() => harness.client.sendChunk(pcm(0, 0))).toThrow(
      expect.objectContaining({ code: 'NOT_STARTED' }),
    );
    expect(() => harness.client.finish()).toThrow(
      expect.objectContaining({ code: 'NOT_STARTED' }),
    );
    expect(() => harness.client.cancel()).toThrow(
      expect.objectContaining({ code: 'NOT_STARTED' }),
    );
  });

  it('重复 finish 与 finish 后发送拒绝 FINISHED', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    harness.client.finish();
    expect(() => harness.client.finish()).toThrow(
      expect.objectContaining({ code: 'FINISHED' }),
    );
    expect(() => harness.client.sendChunk(pcm(0, 0))).toThrow(
      expect.objectContaining({ code: 'FINISHED' }),
    );
    expect(() => harness.client.cancel()).toThrow(
      expect.objectContaining({ code: 'FINISHED' }),
    );
    // 重复 finish 不上线。
    expect(
      decodeSentFrames(ws).filter((frame) => frame.type === 'finish'),
    ).toHaveLength(1);
  });

  it('重复 cancel 与 cancel 后发送拒绝 CANCELLED', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    harness.client.cancel();
    expect(() => harness.client.cancel()).toThrow(
      expect.objectContaining({ code: 'CANCELLED' }),
    );
    expect(() => harness.client.sendChunk(pcm(0, 0))).toThrow(
      expect.objectContaining({ code: 'CANCELLED' }),
    );
    expect(() => harness.client.finish()).toThrow(
      expect.objectContaining({ code: 'CANCELLED' }),
    );
    expect(
      decodeSentFrames(ws).filter((frame) => frame.type === 'cancel'),
    ).toHaveLength(1);
  });

  it('非法 PCM 字节拒绝 INVALID_PCM', async () => {
    const harness = makeHarness();
    await startOpen(harness);
    expect(() => harness.client.sendChunk(new Uint8Array(0))).toThrow(
      expect.objectContaining({ code: 'INVALID_PCM' }),
    );
    expect(() => harness.client.sendChunk(pcm(0x01))).toThrow(
      expect.objectContaining({ code: 'INVALID_PCM' }),
    );
    expect(() =>
      harness.client.sendChunk(new Uint8Array(MAX_PCM_CHUNK_BYTES + 2)),
    ).toThrow(expect.objectContaining({ code: 'INVALID_PCM' }));
  });

  it('终态后任何发送拒绝 ALREADY_TERMINAL', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(finalEvent(0, '你好')));
    expect(harness.client.getStatus().phase).toBe('terminal');
    expect(() => harness.client.sendChunk(pcm(0, 0))).toThrow(
      expect.objectContaining({ code: 'ALREADY_TERMINAL' }),
    );
    expect(() => harness.client.finish()).toThrow(
      expect.objectContaining({ code: 'ALREADY_TERMINAL' }),
    );
    expect(() => harness.client.cancel()).toThrow(
      expect.objectContaining({ code: 'ALREADY_TERMINAL' }),
    );
  });
});

describe('服务端事件归并（V05 reducer 桥接）', () => {
  it('start→chunk→partial→finish→final：快照演变并收敛到 final', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    harness.client.sendChunk(pcm(0, 0));
    harness.client.finish();

    ws.receive(JSON.stringify(partialEvent(0, '你好')));
    expect(harness.snapshots.at(-1)?.combinedText).toBe('你好');

    ws.receive(JSON.stringify(endpointEvent(1)));
    ws.receive(JSON.stringify(finalEvent(2, '你好')));

    expect(harness.snapshots.at(-1)?.combinedText).toBe('你好');
    expect(harness.snapshots.at(-1)?.segments.at(-1)?.status).toBe('final');
    expect(harness.client.getStatus().phase).toBe('terminal');
    expect(harness.terminals).toEqual([{ reason: 'final' }]);
  });

  it('partial 被后续 partial 修正（假设可推翻）', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(partialEvent(0, '你好')));
    ws.receive(JSON.stringify(partialEvent(1, '你好世界')));
    expect(harness.snapshots.at(-1)?.combinedText).toBe('你好世界');
  });

  it('多 segment 归并：跨 segment 文本按出现顺序拼接（V05 词边界）', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(partialEvent(0, 'Bagging', 'seg-1')));
    ws.receive(JSON.stringify(partialEvent(0, 'and boosting', 'seg-2')));
    expect(harness.snapshots.at(-1)?.combinedText).toBe('Bagging and boosting');
    // 两个 segment 各自 sequence 独立连续。
    ws.receive(JSON.stringify(finalEvent(1, 'Bagging', 'seg-1')));
    expect(harness.snapshots.at(-1)?.combinedText).toBe('Bagging and boosting');
    ws.receive(JSON.stringify(finalEvent(1, 'and boosting', 'seg-2')));
    expect(harness.client.getStatus().phase).toBe('terminal');
  });

  it('endpoint 后仍能接收 final', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(partialEvent(0, '你好')));
    ws.receive(JSON.stringify(endpointEvent(1)));
    // endpoint 不是终态：客户端仍在 open。
    expect(harness.client.getStatus().phase).toBe('open');
    ws.receive(JSON.stringify(finalEvent(2, '你好')));
    expect(harness.terminals).toEqual([{ reason: 'final' }]);
  });

  it('cancel → 服务端 failed + CANCELLED 确认 → 终态 cancelled', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    harness.client.cancel();
    ws.receive(JSON.stringify(failedEvent(0, 'CANCELLED')));
    expect(harness.client.getStatus().phase).toBe('terminal');
    expect(harness.terminals).toEqual([
      { reason: 'cancelled', failureCode: 'CANCELLED' },
    ]);
  });

  it('服务端 failed(MODEL_FAILED) → 终态 failed 并携带 failureCode', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(failedEvent(0, 'MODEL_FAILED')));
    expect(harness.terminals).toEqual([
      { reason: 'failed', failureCode: 'MODEL_FAILED' },
    ]);
    expect(harness.snapshots.at(-1)?.combinedText).toBe('');
  });

  it('服务端传输错误帧 → protocol-error + serverCode，不当作 V04 事件归并', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify({ error: { code: 'INVALID_REQUEST' } }));
    expect(harness.terminals).toEqual([
      {
        reason: 'protocol-error',
        errorCode: 'PROTOCOL_ERROR',
        serverCode: 'INVALID_REQUEST',
      },
    ]);
    expect(harness.snapshots).toHaveLength(0);
  });
});

describe('协议违约（服务端不可信输入）', () => {
  it('非 JSON 帧 → protocol-error', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive('not json');
    expect(harness.terminals).toEqual([
      { reason: 'protocol-error', errorCode: 'PROTOCOL_ERROR' },
    ]);
  });

  it('JSON 数组 / 缺字段对象 → schema 拒绝 → protocol-error', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive('[]');
    expect(harness.terminals.at(-1)?.reason).toBe('protocol-error');

    const harness2 = makeHarness();
    const ws2 = await startOpen(harness2);
    ws2.receive(JSON.stringify({ type: 'partial', text: '缺字段' }));
    expect(harness2.terminals.at(-1)?.reason).toBe('protocol-error');
  });

  it('事件序列跳号 → reducer 拒绝 → protocol-error', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(partialEvent(0, 'a')));
    ws.receive(JSON.stringify(partialEvent(2, 'c')));
    expect(harness.terminals.at(-1)).toEqual({
      reason: 'protocol-error',
      errorCode: 'PROTOCOL_ERROR',
    });
  });

  it('同 sequence 不同 payload（非幂等重复）→ protocol-error', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(partialEvent(0, 'a')));
    ws.receive(JSON.stringify(partialEvent(0, 'b')));
    expect(harness.terminals.at(-1)?.reason).toBe('protocol-error');
  });

  it('跨 operation 事件 → reducer 拒绝 → protocol-error', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(partialEvent(0, 'a', 'seg-1', 'op-other')));
    expect(harness.terminals.at(-1)?.reason).toBe('protocol-error');
  });

  it('新 segment 首事件 sequence 不为 0 → protocol-error', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(partialEvent(0, 'a', 'seg-1')));
    ws.receive(JSON.stringify(partialEvent(1, 'b', 'seg-2')));
    expect(harness.terminals.at(-1)?.reason).toBe('protocol-error');
  });

  it('endpoint 后 partial → protocol-error', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(partialEvent(0, 'a')));
    ws.receive(JSON.stringify(endpointEvent(1)));
    ws.receive(JSON.stringify(partialEvent(2, 'b')));
    expect(harness.terminals.at(-1)?.reason).toBe('protocol-error');
  });

  it('终态后的后续事件被忽略：不产生第二个终态，不改变快照', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(finalEvent(0, '你好')));
    expect(harness.terminals).toHaveLength(1);
    const snapshotAfterFinal = harness.snapshots.at(-1);
    ws.receive(JSON.stringify(partialEvent(1, '不应出现')));
    ws.receive(JSON.stringify({ error: { code: 'INVALID_REQUEST' } }));
    expect(harness.terminals).toHaveLength(1);
    expect(harness.snapshots.at(-1)).toBe(snapshotAfterFinal);
  });
});

describe('断开与终态竞争', () => {
  it('open 后发送失败会收敛并主动释放 socket', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    const sentLogsBeforeFailure = harness.logs.filter(
      (entry) => entry.label === 'message_sent',
    ).length;
    ws.sendThrows = true;

    harness.client.sendChunk(pcm(0, 1));

    expect(harness.terminals).toEqual([{ reason: 'disconnected' }]);
    expect(ws.closeCode).toBe(1000);
    expect(
      harness.logs.filter((entry) => entry.label === 'message_sent'),
    ).toHaveLength(sentLogsBeforeFailure);
  });

  it('open 后 socket 中断（无终态事件）→ disconnected', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.close(1006);
    expect(harness.terminals).toEqual([{ reason: 'disconnected' }]);
  });

  it('error + close 双触发只收敛一次', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.fail();
    expect(harness.terminals).toHaveLength(1);
    expect(harness.terminals[0]?.reason).toBe('disconnected');
    // 后续任何关闭事件不再产生终态。
    ws.close(1000);
    expect(harness.terminals).toHaveLength(1);
  });

  it('final 事件与 close 竞争：只有 final 一个终态', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(finalEvent(0, '你好')));
    ws.close(1000);
    expect(harness.terminals).toHaveLength(1);
    expect(harness.terminals[0]?.reason).toBe('final');
  });

  it('cancel 后未收到确认就断开 → disconnected（不虚构 cancelled）', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    harness.client.cancel();
    ws.close(1006);
    expect(harness.terminals).toEqual([{ reason: 'disconnected' }]);
  });

  it('主动 disconnect() → disconnected', async () => {
    const harness = makeHarness();
    await startOpen(harness);
    harness.client.disconnect();
    expect(harness.terminals).toEqual([{ reason: 'disconnected' }]);
    harness.client.disconnect();
    expect(harness.terminals).toHaveLength(1);
  });
});

describe('观察者故障隔离', () => {
  it('日志与 UI 回调抛错不阻断握手、终态或 socket 清理', async () => {
    const throwObserver = () => {
      throw new Error('observer failure');
    };
    const harness = makeHarness({
      log: throwObserver,
      onSnapshot: throwObserver,
      onStatus: throwObserver,
      onTerminal: throwObserver,
    });

    const ws = await startOpen(harness);
    ws.receive(JSON.stringify(partialEvent(0, '不会泄露')));
    ws.receive(JSON.stringify(finalEvent(1, '完成')));

    expect(harness.client.getStatus()).toMatchObject({
      phase: 'terminal',
      terminal: { reason: 'final' },
    });
    expect(ws.closeCode).toBe(1000);
  });
});

describe('AbortSignal', () => {
  it('open 后 signal abort → 终态 aborted', async () => {
    const harness = makeHarness();
    const controller = new AbortController();
    const started = harness.client.start({
      notebookId: 'nb-1',
      signal: controller.signal,
    });
    await flushMicrotasks();
    FakeWebSocket.last().open();
    await started;
    controller.abort();
    expect(harness.terminals).toEqual([
      { reason: 'aborted', errorCode: 'ABORTED' },
    ]);
    expect(harness.client.getStatus().phase).toBe('terminal');
  });
});

describe('实例隔离', () => {
  it('两个客户端实例的发送序列与快照互不影响', async () => {
    const harnessA = makeHarness();
    const harnessB = makeHarness();
    const wsA = await startOpen(harnessA, 'nb-a');
    const wsB = await startOpen(harnessB, 'nb-b');

    harnessA.client.sendChunk(pcm(1, 2));
    harnessA.client.sendChunk(pcm(3, 4));
    harnessB.client.sendChunk(pcm(5, 6));
    harnessA.client.finish();

    const framesA = decodeSentFrames(wsA);
    const framesB = decodeSentFrames(wsB);
    expect(framesA.map((frame) => frame.sequence)).toEqual([0, 1, 2, 3]);
    expect(framesB.map((frame) => frame.sequence)).toEqual([0, 1]);
    expect(validateStreamingTranscriptionClientMessageSequence(framesA)).toBe(
      true,
    );
    expect(validateStreamingTranscriptionClientMessageSequence(framesB)).toBe(
      true,
    );

    // A 收到终态不影响 B。
    wsA.receive(JSON.stringify(finalEvent(2, 'A的文本')));
    expect(harnessA.client.getStatus().phase).toBe('terminal');
    expect(harnessB.client.getStatus().phase).toBe('open');
    wsB.receive(JSON.stringify(partialEvent(0, 'B的文本')));
    expect(harnessB.snapshots.at(-1)?.combinedText).toBe('B的文本');
  });
});

describe('日志脱敏', () => {
  it('全流程日志不含 ticket、bearer、PCM、转录文本与 stack', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    harness.client.sendChunk(pcm(0xde, 0xad, 0xbe, 0xef));
    harness.client.finish();
    ws.receive(JSON.stringify(partialEvent(0, '敏感转录文本内容')));
    ws.receive(JSON.stringify(finalEvent(1, '敏感转录文本内容')));

    const serialized = JSON.stringify(harness.logs);
    expect(serialized).not.toContain(TICKET);
    expect(serialized).not.toContain('3q2+7w=='); // PCM base64
    expect(serialized).not.toContain('敏感转录文本内容');
    expect(serialized).not.toContain('bearer');
    expect(serialized).not.toContain('Error');
    expect(serialized).not.toContain(' at ');
    // 只含受控标签与稳定 id。
    for (const entry of harness.logs) {
      expect(entry.label).toMatch(
        /^(ticket_failed|connection_failed|socket_error|socket_closed|message_sent|event_applied|protocol_rejected|terminal)$/,
      );
      expect(Object.keys(entry).sort()).toEqual(
        [
          'label',
          ...(entry.operationId ? ['operationId'] : []),
          ...(entry.segmentId ? ['segmentId'] : []),
          ...(entry.code ? ['code'] : []),
        ].sort(),
      );
    }
  });

  it('协议违约日志只有稳定标签，不记录原始帧', async () => {
    const harness = makeHarness();
    const ws = await startOpen(harness);
    ws.receive('{"type":"partial","text":"原始帧泄露测试","sequence":99}');
    const serialized = JSON.stringify(harness.logs);
    expect(serialized).not.toContain('原始帧泄露测试');
    expect(serialized).not.toContain('sequence');
    expect(harness.terminals.at(-1)?.reason).toBe('protocol-error');
  });

  it('客户端错误只暴露稳定 code', () => {
    const harness = makeHarness();
    let error: unknown;
    try {
      harness.client.finish();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(StreamingTranscriptionClientError);
    expect((error as StreamingTranscriptionClientError).code).toBe(
      'NOT_STARTED',
    );
    expect((error as Error).message).toBe('NOT_STARTED');
  });
});

describe('凭证投递目标受控（安全边界）', () => {
  it('validateStreamingWsUrl：wss 通过，ws 需白名单，其余拒绝', () => {
    expect(
      validateStreamingWsUrl(
        'wss://gateway.invalid/v1/streaming-transcription?notebookId=nb',
      ),
    ).toEqual({ ok: true });
    expect(
      validateStreamingWsUrl('ws://127.0.0.1:8787/v1/streaming-transcription'),
    ).toEqual({
      ok: false,
      reason: 'insecure-host-not-allowed',
    });
    expect(
      validateStreamingWsUrl('ws://127.0.0.1:8787/v1/streaming-transcription', [
        '127.0.0.1:8787',
      ]),
    ).toEqual({ ok: true });
    expect(
      validateStreamingWsUrl('ws://127.0.0.1:8787/x', ['127.0.0.1:8788']),
    ).toEqual({
      ok: false,
      reason: 'insecure-host-not-allowed',
    });
    expect(
      validateStreamingWsUrl(
        'https://gateway.invalid/v1/streaming-transcription',
      ),
    ).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
    expect(
      validateStreamingWsUrl('wss://user:secret@gateway.invalid/x'),
    ).toEqual({
      ok: false,
      reason: 'embedded-credentials',
    });
    expect(validateStreamingWsUrl('/v1/streaming-transcription')).toEqual({
      ok: false,
      reason: 'invalid-url',
    });
    expect(validateStreamingWsUrl('not a url')).toEqual({
      ok: false,
      reason: 'invalid-url',
    });
  });

  it('resolveWsUrl 抛错：start 拒绝 CONNECTION_FAILED 且不永久挂起', async () => {
    const harness = makeHarness({
      resolveWsUrl: () => {
        throw new Error('bad config');
      },
    });
    await expect(
      harness.client.start({ notebookId: 'nb-1' }),
    ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
    expect(harness.terminals).toEqual([
      { reason: 'connection-failed', errorCode: 'CONNECTION_FAILED' },
    ]);
    // 未发起任何网络请求。
    expect(harness.ticketClient.requestTicket).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('resolveWsUrl 返回非白名单明文 ws://：拒绝连接，不请求 ticket', async () => {
    const harness = makeHarness({
      resolveWsUrl: () => 'ws://evil.example.com/v1/streaming-transcription',
    });
    await expect(
      harness.client.start({ notebookId: 'nb-1' }),
    ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
    expect(harness.ticketClient.requestTicket).not.toHaveBeenCalled();
  });

  it('resolveWsUrl 返回相对路径/非法 URL：拒绝连接', async () => {
    const harness = makeHarness({
      resolveWsUrl: () => '/v1/client/streaming-transcription?notebookId=nb-1',
    });
    await expect(
      harness.client.start({ notebookId: 'nb-1' }),
    ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
  });

  it('resolveWsUrl 返回带内嵌凭证的 URL：拒绝连接', async () => {
    const harness = makeHarness({
      resolveWsUrl: () =>
        'wss://user:secret@gateway.invalid/v1/streaming-transcription',
    });
    await expect(
      harness.client.start({ notebookId: 'nb-1' }),
    ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
  });

  it('显式白名单允许本地明文 ws://（开发环境）', async () => {
    const harness = makeHarness({
      resolveWsUrl: () =>
        'ws://127.0.0.1:8787/v1/client/streaming-transcription?notebookId=nb-1',
      allowedInsecureWsHosts: ['127.0.0.1:8787'],
    });
    const ws = await startOpen(harness);
    expect(ws.url).toContain('127.0.0.1:8787');
    expect(harness.client.getStatus().phase).toBe('open');
  });

  it('首条 start 消息写入失败：拒绝 CONNECTION_FAILED，不报告连接成功', async () => {
    const harness = makeHarness();
    const started = harness.client.start({ notebookId: 'nb-1' });
    await flushMicrotasks();
    const ws = FakeWebSocket.last();
    ws.sendThrows = true;
    ws.open();
    await expect(started).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
    expect(harness.client.getStatus().phase).toBe('terminal');
    expect(harness.terminals).toEqual([
      { reason: 'connection-failed', errorCode: 'CONNECTION_FAILED' },
    ]);
    // start 帧没有上线（服务端没有会话）。
    expect(ws.sent).toHaveLength(0);
  });

  it('WebSocket upgrade 半开超过截止时间：稳定失败而不是永久 starting', async () => {
    vi.useFakeTimers();
    const harness = makeHarness({ connectionTimeoutMs: 25 });
    const started = harness.client.start({ notebookId: 'nb-1' });
    const rejected = expect(started).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
    await flushMicrotasks();
    expect(FakeWebSocket.last().readyState).toBe(FakeWebSocket.CONNECTING);

    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(harness.client.getStatus().phase).toBe('terminal');
    expect(harness.terminals).toEqual([
      { reason: 'connection-failed', errorCode: 'CONNECTION_FAILED' },
    ]);
  });
});
