/**
 * V13 transport 配额端到端测试（真实 node:http + ws）。
 *
 * 覆盖：连接数上限（单用户/Notebook/全局）的 429 拒绝与 recognizer 零
 * 创建、释放后重连、输出背压、adapter 失败不泄漏槽位、能力关闭不分配
 * 槽位、日志脱敏。全部使用 fake gateway/session，不加载真实 WASM。
 */

import { createServer, type Server } from 'node:http';
import { createConnection } from 'node:net';
import type { AddressInfo } from 'node:net';
import { streamingTranscriptionProtocolVersion } from '@educanvas/agent-core';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeWsAllowedOrigin } from './config';
import { StreamingTranscriptionQuotaManager } from './streaming-transcription-quota-manager';
import {
  STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
  type StreamingTranscriptionQuotas,
} from './streaming-transcription-quotas';
import {
  FakeTranscriptionGateway,
  VALID_PCM_BYTES,
} from './streaming-transcription-test-support';
import { StreamingTranscriptionTicketStore } from './streaming-transcription-ticket';
import {
  STREAMING_TRANSCRIPTION_WS_PATH,
  createStreamingTranscriptionUpgradeHandler,
  type StreamingTranscriptionLogEntry,
  type StreamingTranscriptionUpgradeDependencies,
} from './streaming-transcription-ws-transport';

const PROTO = streamingTranscriptionProtocolVersion;

const activeServers: Server[] = [];
const activeClients: WebSocket[] = [];

afterEach(async () => {
  for (const client of activeClients) {
    try {
      if (client.readyState === WebSocket.OPEN) client.close();
      else client.terminate();
    } catch {
      // 连接已不存在：忽略。
    }
  }
  activeClients.length = 0;
  await Promise.all(
    activeServers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
  activeServers.length = 0;
});

interface TestContext {
  server: Server;
  deps: StreamingTranscriptionUpgradeDependencies;
  baseUrl: string;
  tickets: StreamingTranscriptionTicketStore;
  quotaManager: StreamingTranscriptionQuotaManager;
  logs: StreamingTranscriptionLogEntry[];
}

let ticketCounter = 0;

async function startTestContext(
  overrides: Partial<StreamingTranscriptionUpgradeDependencies> = {},
  quotas: Partial<StreamingTranscriptionQuotas> = {},
): Promise<TestContext> {
  const logs: StreamingTranscriptionLogEntry[] = [];
  const tickets = new StreamingTranscriptionTicketStore({
    createRandom: () => {
      ticketCounter += 1;
      return `v13-ticket-${ticketCounter}`;
    },
  });
  const effectiveQuotas = {
    ...STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
    ...quotas,
  };
  const quotaManager = new StreamingTranscriptionQuotaManager(effectiveQuotas);
  const deps: StreamingTranscriptionUpgradeDependencies = {
    tickets,
    checkNotebookAccess: async ({ notebookId, trustedSubjectId }) =>
      notebookId === 'notebook:A' && trustedSubjectId === 'user:A',
    isAllowedOrigin: () => true,
    gateway: new FakeTranscriptionGateway(),
    unavailableReason: null,
    quotaManager,
    quotas: effectiveQuotas,
    log: (entry) => logs.push(entry),
    createTraceId: () => 'trace:test',
    ...overrides,
  };
  const server = createServer((_req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
  });
  server.on('upgrade', createStreamingTranscriptionUpgradeHandler(deps));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const { port } = server.address() as AddressInfo;
  return {
    server,
    deps,
    logs,
    tickets,
    quotaManager,
    baseUrl: `ws://127.0.0.1:${port}${STREAMING_TRANSCRIPTION_WS_PATH}?notebookId=notebook:A`,
  };
}

function issueTicket(ctx: TestContext, notebookId = 'notebook:A'): string {
  return ctx.tickets.issue({
    userId: 'user:A',
    notebookId,
  }).ticket;
}

function connect(
  ctx: TestContext,
  options: { ticket?: string; notebookId?: string } = {},
): WebSocket {
  const notebookId = options.notebookId ?? 'notebook:A';
  const ws = new WebSocket(
    `ws://127.0.0.1:${(ctx.server.address() as AddressInfo).port}${STREAMING_TRANSCRIPTION_WS_PATH}?notebookId=${notebookId}`,
    {
      headers: {
        authorization: `Bearer ${options.ticket ?? issueTicket(ctx, notebookId)}`,
      },
    },
  );
  ws.on('error', () => undefined);
  activeClients.push(ws);
  return ws;
}

function open(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function expectHandshakeRejection(
  ws: WebSocket,
  expectedStatus: number,
  expectedCode: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => {
        try {
          expect(res.statusCode).toBe(expectedStatus);
          expect(JSON.parse(body).error.code).toBe(expectedCode);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    ws.once('open', () => reject(new Error('unexpected open')));
  });
}

function collect(ws: WebSocket): { next(): Promise<unknown> } {
  const queue: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString()) as unknown;
    if (waiters.length > 0) waiters.shift()!(message);
    else queue.push(message);
  });
  return {
    next: () =>
      queue.length > 0
        ? Promise.resolve(queue.shift())
        : new Promise((resolve) => waiters.push(resolve)),
  };
}

function waitForClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

/** 轮询等待条件成立（断言辅助，避免时序脆弱）。 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor 超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function wireStart(sequence = 0): string {
  return JSON.stringify({
    type: 'start',
    protocolVersion: PROTO,
    operationId: 'op:1',
    segmentId: 'seg:1',
    sequence,
    sampleRate: 16_000,
    channels: 1,
    encoding: 'pcm_s16le',
  });
}

function wireChunk(sequence: number, chunkSequence = 0): string {
  return JSON.stringify({
    type: 'chunk',
    protocolVersion: PROTO,
    operationId: 'op:1',
    segmentId: 'seg:1',
    sequence,
    chunkSequence,
    sampleRate: 16_000,
    channels: 1,
    encoding: 'pcm_s16le',
    pcmBytes: Buffer.from(VALID_PCM_BYTES).toString('base64'),
  });
}

function wireFinish(sequence: number): string {
  return JSON.stringify({
    type: 'finish',
    protocolVersion: PROTO,
    operationId: 'op:1',
    segmentId: 'seg:1',
    sequence,
  });
}

function wireCancel(sequence: number): string {
  return JSON.stringify({
    type: 'cancel',
    protocolVersion: PROTO,
    operationId: 'op:1',
    segmentId: 'seg:1',
    sequence,
  });
}

/** 构造 masked text 帧（客户端 → 服务端必须 mask；固定 4 字节 mask key）。 */
function maskedTextFrame(payload: string): Buffer {
  const data = Buffer.from(payload);
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const masked = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index += 1) {
    masked[index] = data[index]! ^ mask[index % 4]!;
  }
  const header =
    data.length < 126
      ? Buffer.from([0x81, 0x80 | data.length])
      : (() => {
          const ext = Buffer.alloc(2);
          ext.writeUInt16BE(data.length);
          return Buffer.concat([Buffer.from([0x81, 0x80 | 126]), ext]);
        })();
  return Buffer.concat([header, mask, masked]);
}

/**
 * 原始 socket 的 WS 帧读取器（服务端帧未 mask）。跨调用共享缓冲：
 * 同一 TCP 段内的多帧（如 final + close）不会被丢弃。返回
 * `{ opcode, payload }`（payload 不含 WS 头）。
 */
function createRawFrameReader(
  socket: import('node:net').Socket,
): () => Promise<{
  opcode: number;
  payload: Buffer;
}> {
  let buffered = Buffer.alloc(0);
  return function nextFrame(): Promise<{ opcode: number; payload: Buffer }> {
    return new Promise((resolve, reject) => {
      const tryExtract = (): boolean => {
        if (buffered.length < 2) return false;
        const len = buffered[1]! & 0x7f;
        let headerSize = 2;
        let payloadLen = len;
        if (len === 126) {
          if (buffered.length < 4) return false;
          payloadLen = buffered.readUInt16BE(2);
          headerSize = 4;
        } else if (len === 127) {
          if (buffered.length < 10) return false;
          payloadLen = Number(buffered.readBigUInt64BE(2));
          headerSize = 10;
        }
        if (buffered.length < headerSize + payloadLen) return false;
        const frame = buffered.subarray(0, headerSize + payloadLen);
        buffered = buffered.subarray(headerSize + payloadLen);
        resolve({
          opcode: frame[0]! & 0x0f,
          payload: frame.subarray(headerSize),
        });
        return true;
      };
      if (tryExtract()) return;
      const onData = (chunk: Buffer): void => {
        buffered = Buffer.concat([buffered, chunk]);
        if (tryExtract()) socket.off('data', onData);
      };
      socket.on('data', onData);
      socket.once('error', reject);
    });
  };
}

describe('V13 transport 连接配额（E2E）', () => {
  it('上限前连接正常，recognizer 随 start 创建', async () => {
    const ctx = await startTestContext(
      {},
      { maxConnectionsPerUser: 2, maxConnectionsPerNotebook: 2 },
    );
    const gateway = ctx.deps.gateway as FakeTranscriptionGateway;
    const first = connect(ctx);
    const second = connect(ctx);
    await Promise.all([open(first), open(second)]);
    expect(ctx.quotaManager.stats().socketGlobalActive).toBe(2);
    first.send(wireStart(0));
    second.send(wireStart(0));
    await waitFor(() => gateway.beginCalls === 2);
    expect(gateway.sessions).toHaveLength(2);
  });

  it('达到单用户连接上限时 429 拒绝，recognizer 创建次数不增加', async () => {
    const ctx = await startTestContext(
      {},
      { maxConnectionsPerUser: 2, maxConnectionsPerNotebook: 2 },
    );
    const gateway = ctx.deps.gateway as FakeTranscriptionGateway;
    const first = connect(ctx);
    const second = connect(ctx);
    await Promise.all([open(first), open(second)]);
    // 用户 user:A 已达 2 条：第三个连接握手被 429 拒绝。
    const third = connect(ctx);
    await expectHandshakeRejection(third, 429, 'CONNECTION_LIMIT_EXCEEDED');
    expect(ctx.quotaManager.stats().socketGlobalActive).toBe(2);
    first.send(wireStart(0));
    second.send(wireStart(0));
    await waitFor(() => gateway.beginCalls === 2);
    // 第三个连接被拒后 recognizer 创建次数不增加。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gateway.beginCalls).toBe(2);
    expect(
      ctx.logs.some((entry) => entry.label === 'connection_limit_exceeded'),
    ).toBe(true);
  });

  it('达到用户+Notebook 组合上限时 429 拒绝', async () => {
    const ctx = await startTestContext({}, { maxConnectionsPerNotebook: 1 });
    const first = connect(ctx);
    await open(first);
    const second = connect(ctx); // 同一用户同一 Notebook 第 2 条
    await expectHandshakeRejection(second, 429, 'CONNECTION_LIMIT_EXCEEDED');
    expect(
      ctx.quotaManager
        .stats()
        .socketNotebookActive.get('user:A\u0000notebook:A'),
    ).toBe(1);
  });

  it('达到全局连接上限时 429 拒绝不同用户', async () => {
    const ctx = await startTestContext(
      {
        checkNotebookAccess: async ({ notebookId }) =>
          notebookId === 'notebook:A',
        gateway: new FakeTranscriptionGateway(),
      },
      // REVISE：全局连接上限是 maxConnectionsGlobal（socket 槽）；全局
      // recognizer 上限 maxActiveSessionsGlobal 是独立的 Session 槽。
      { maxConnectionsGlobal: 1 },
    );
    // 注意：本用例所有连接都是 user:A，全局连接上限 1 意味着第二条就被拒。
    const first = connect(ctx);
    await open(first);
    const second = connect(ctx);
    await expectHandshakeRejection(second, 429, 'CONNECTION_LIMIT_EXCEEDED');
    expect(ctx.quotaManager.stats().socketGlobalActive).toBe(1);
  });

  it('连接释放后可立即重新建立', async () => {
    const ctx = await startTestContext({}, { maxConnectionsPerUser: 1 });
    const first = connect(ctx);
    await open(first);
    const closed = waitForClose(first);
    first.close(1000);
    await closed;
    // 槽位已释放：新连接立即成功。
    const second = connect(ctx);
    await open(second);
    expect(ctx.quotaManager.stats().socketGlobalActive).toBe(1);
  });

  it('adapter 创建失败不泄漏槽位：连接关闭后计数归零', async () => {
    const gateway = new FakeTranscriptionGateway({ createFailure: true });
    const ctx = await startTestContext(
      { gateway },
      { maxConnectionsPerUser: 1 },
    );
    const ws = connect(ctx);
    await open(ws);
    ws.send(wireStart(0));
    const failed = await collect(ws).next();
    expect((failed as { type: string }).type).toBe('failed');
    ws.close();
    await waitForClose(ws);
    // 服务端 close 处理异步：轮询等待槽位归零（正常释放路径，非轮询清扫）。
    await waitFor(() => ctx.quotaManager.stats().socketGlobalActive === 0);
    expect(ctx.quotaManager.stats().socketUserActive.size).toBe(0);
  });

  it('adapter 事件流异常不泄漏槽位：1011 关闭后计数归零', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { emitInvalidEvent: true },
    });
    const ctx = await startTestContext(
      { gateway },
      { maxConnectionsPerUser: 1 },
    );
    const ws = connect(ctx);
    await open(ws);
    ws.send(wireStart(0));
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1011);
    // 服务端 close 处理异步：轮询等待槽位归零（正常释放路径，非轮询清扫）。
    await waitFor(() => ctx.quotaManager.stats().socketGlobalActive === 0);
  });

  it('能力关闭（resolver 不可用）时不分配槽位、不注册 recognizer', async () => {
    const ctx = await startTestContext(
      {
        gateway: null,
        unavailableReason: 'streaming_disabled',
      },
      {},
    );
    const ws = connect(ctx);
    await expectHandshakeRejection(
      ws,
      503,
      'STREAMING_TRANSCRIPTION_UNAVAILABLE',
    );
    expect(ctx.quotaManager.stats().socketGlobalActive).toBe(0);
  });

  it('输出背压：待发送字节超配额 → 稳定错误码 + 1008，不再积压', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { initialPartialEvents: 100 },
    });
    // 注入确定性的 bufferedAmount 读取：任何一次 sendEvent 都触发背压。
    const ctx = await startTestContext(
      { gateway, readBufferedAmount: () => 2 },
      { maxOutputBufferedBytes: 1 },
    );
    const ws = connect(ctx);
    await open(ws);
    const incoming = collect(ws);
    const closed = waitForClose(ws);
    ws.send(wireStart(0));
    const closeCode = await closed;
    expect(closeCode).toBe(1008);
    // 首帧是输出背压错误帧（事件不再投影，会话由 abort 收敛）。
    const firstFrame = await incoming.next();
    expect((firstFrame as { error?: { code?: string } }).error?.code).toBe(
      'OUTPUT_BACKPRESSURE_EXCEEDED',
    );
    expect(
      ctx.logs.some(
        (entry) =>
          entry.label === 'quota_exceeded' &&
          entry.code === 'OUTPUT_BACKPRESSURE_EXCEEDED',
      ),
    ).toBe(true);
  });

  it('握手升级中途 TCP 中断不泄漏连接槽', async () => {
    // 全局上限 1：若中途中断的握手泄漏槽位，后续正常连接会被 429 拒绝。
    const ctx = await startTestContext({}, { maxActiveSessionsGlobal: 1 });
    const ticket = issueTicket(ctx);
    // 原始 TCP 发送合法 upgrade 请求后立即 RST：服务端可能在 acquire 前
    // 或后收到中断，两种情况都必须最终不占槽（socket 兜底释放路径）。
    const sock = createConnection({
      host: '127.0.0.1',
      port: (ctx.server.address() as AddressInfo).port,
    });
    const headers = [
      `GET ${STREAMING_TRANSCRIPTION_WS_PATH}?notebookId=notebook:A HTTP/1.1`,
      'Host: 127.0.0.1',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      `Authorization: Bearer ${ticket}`,
      '',
      '',
    ].join('\r\n');
    sock.write(headers);
    sock.destroy();
    // 泄漏判定：若中途中断的握手泄漏 socket 槽，全局连接上限 1 会拒绝
    // 重连（429 → open 失败）。等待槽位归零后重连验证（无固定 sleep）。
    await waitFor(() => ctx.quotaManager.stats().socketGlobalActive === 0);
    const ws = connect(ctx);
    await open(ws);
    expect(ctx.quotaManager.stats().socketGlobalActive).toBe(1);
  });

  it('日志与错误不含 PCM、转录文本、ticket、路径或 Secret', async () => {
    // adapter 违约路径（1011 关闭）触发日志，验证脱敏面。
    const gateway = new FakeTranscriptionGateway({
      session: { emitInvalidEvent: true },
    });
    const ctx = await startTestContext({ gateway }, {});
    const ws = connect(ctx);
    await open(ws);
    ws.send(wireStart(0));
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1011);
    const serialized = JSON.stringify(ctx.logs);
    // operationId/segmentId 是任务允许记录的稳定 ID；敏感项是 PCM、
    // 转录文本、ticket、Secret、stack 与批量 partial 文本。
    expect(serialized).not.toMatch(
      /pcm|base64|ticket|secret|token|stack|bulk-partial|trace:test/i,
    );
    for (const entry of ctx.logs) {
      expect(entry.label).toMatch(/^[a-z_]+$/);
      if (entry.code !== undefined) {
        expect(entry.code).toMatch(/^[A-Z_]+$/);
      }
      if (entry.notebookId !== undefined) {
        expect(entry.notebookId).toBe('notebook:A');
      }
    }
  });
});

describe('V13 REVISE 终态释放与违约取消（E2E）', () => {
  it('final 后客户端不主动关闭：服务端主动 1000 关闭并将计数归零', async () => {
    const ctx = await startTestContext({}, { maxConnectionsPerUser: 1 });
    const ws = connect(ctx);
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart(0));
    ws.send(wireFinish(1));
    const first = await inbox.next();
    expect((first as { type: string }).type).toBe('final');
    // 客户端不关闭连接：服务端必须在终态交付后主动回收。
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1000);
    await waitFor(() => ctx.quotaManager.stats().socketGlobalActive === 0);
    // 槽位已释放：新连接立即成功。
    const ws2 = connect(ctx);
    await open(ws2);
  });

  it('cancel → failed 后同样归零（客户端不关闭）', async () => {
    const ctx = await startTestContext({}, { maxConnectionsPerUser: 1 });
    const ws = connect(ctx);
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart(0));
    ws.send(wireCancel(1));
    const first = await inbox.next();
    expect((first as { type: string; failureCode?: string }).failureCode).toBe(
      'CANCELLED',
    );
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1000);
    await waitFor(() => ctx.quotaManager.stats().socketGlobalActive === 0);
  });

  it('terminal、close 竞争只释放一次', async () => {
    const ctx = await startTestContext({}, { maxConnectionsPerUser: 1 });
    const ws = connect(ctx);
    await open(ws);
    ws.send(wireStart(0));
    ws.send(wireFinish(1));
    // 服务端终态交付后主动关闭（onTerminal 已释放租约）。
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1000);
    // 客户端再补一次 close：幂等释放，计数保持 0 且可重连。
    ws.close();
    await waitFor(() => ctx.quotaManager.stats().socketGlobalActive === 0);
    const ws2 = connect(ctx);
    await open(ws2);
    expect(ctx.quotaManager.stats().socketGlobalActive).toBe(1);
  });

  it('非法 adapter 事件 → abort recognizer + 1011 + 释放', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { emitInvalidEvent: true },
    });
    const ctx = await startTestContext({ gateway }, {});
    const ws = connect(ctx);
    await open(ws);
    ws.send(wireStart(0));
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1011);
    // REVISE：违约必须 abort 底层 Session，不能只关连接。
    expect(gateway.sessions[0]!.aborted).toBe(true);
    await waitFor(() => ctx.quotaManager.stats().socketGlobalActive === 0);
  });

  it('事件流无终态结束 → abort + 1011 + 释放', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { endWithoutTerminal: true },
    });
    const ctx = await startTestContext({ gateway }, {});
    const ws = connect(ctx);
    await open(ws);
    ws.send(wireStart(0));
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1011);
    expect(gateway.sessions[0]!.aborted).toBe(true);
    await waitFor(() => ctx.quotaManager.stats().socketGlobalActive === 0);
  });

  it('当前缓冲未超限但加下一帧后超限 → 拒绝发送并输出背压失败', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { initialPartialEvents: 100 },
    });
    // 注入 bufferedAmount=80（未超限），上限 100：事件帧 ~130 字节，
    // 80+130 > 100 → 第一帧即被拒，业务事件绝不投影。
    const ctx = await startTestContext(
      { gateway, readBufferedAmount: () => 80 },
      { maxOutputBufferedBytes: 100 },
    );
    const ws = connect(ctx);
    await open(ws);
    const inbox = collect(ws);
    const closed = waitForClose(ws);
    ws.send(wireStart(0));
    const closeCode = await closed;
    expect(closeCode).toBe(1008);
    const firstFrame = await inbox.next();
    expect((firstFrame as { error?: { code?: string } }).error?.code).toBe(
      'OUTPUT_BACKPRESSURE_EXCEEDED',
    );
    expect(
      ctx.logs.some(
        (entry) =>
          entry.label === 'quota_exceeded' &&
          entry.code === 'OUTPUT_BACKPRESSURE_EXCEEDED',
      ),
    ).toBe(true);
  });
});

describe('V13 REVISE 第二轮：双租约生命周期（E2E）', () => {
  it('终态后 close 完成前连接仍计入 socket 配额：拖延不能建立超额连接', async () => {
    const ctx = await startTestContext({}, { maxConnectionsPerUser: 1 });
    // 原始 TCP + 手写 WS 帧模拟"收到终态与 close 帧但拖延不回 close 帧"
    // 的客户端（node ws 会自动回复 close 帧，无法模拟拖延）。
    const ticket = issueTicket(ctx);
    const port = (ctx.server.address() as AddressInfo).port;
    const raw = createConnection({ host: '127.0.0.1', port });
    const upgradeRequest = [
      `GET ${STREAMING_TRANSCRIPTION_WS_PATH}?notebookId=notebook:A HTTP/1.1`,
      'Host: 127.0.0.1',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      `Authorization: Bearer ${ticket}`,
      '',
      '',
    ].join('\r\n');
    await new Promise<void>((resolve, reject) => {
      let response = '';
      const onData = (chunk: Buffer): void => {
        response += chunk.toString('latin1');
        if (response.includes('\r\n\r\n')) {
          expect(response.startsWith('HTTP/1.1 101')).toBe(true);
          raw.off('data', onData);
          resolve();
        }
      };
      raw.on('data', onData);
      raw.once('error', reject);
      raw.write(upgradeRequest);
    });
    raw.write(maskedTextFrame(wireStart(0)));
    raw.write(maskedTextFrame(wireFinish(1)));
    // 读服务端帧：应先收到 final 事件，随后服务端发起 close(1000)。
    const nextFrame = createRawFrameReader(raw);
    const projected: string[] = [];
    let closeSeen = false;
    const deadline = Date.now() + 2_000;
    while (!closeSeen && Date.now() < deadline) {
      const { opcode, payload } = await nextFrame();
      if (opcode === 0x8)
        closeSeen = true; // close 帧（1000）
      else if (opcode === 0x1) projected.push(payload.toString());
    }
    expect(closeSeen).toBe(true);
    expect(
      projected.some(
        (text) => (JSON.parse(text) as { type: string }).type === 'final',
      ),
    ).toBe(true);
    // 客户端拖延不回 close 帧：连接真实存在，socket 槽必须仍计入。
    expect(ctx.quotaManager.stats().socketGlobalActive).toBe(1);
    // recognizer 槽已释放（终态形成即释放，与连接关闭解耦）。
    await waitFor(() => ctx.quotaManager.stats().sessionGlobalActive === 0);
    // 拖延 close 不能建立超额连接：同用户新连接被 429 拒绝。
    const second = connect(ctx);
    await expectHandshakeRejection(second, 429, 'CONNECTION_LIMIT_EXCEEDED');
    // 客户端最终销毁连接：socket 槽随实际 close 释放。
    raw.destroy();
    await waitFor(() => ctx.quotaManager.stats().socketGlobalActive === 0);
    const third = connect(ctx);
    await open(third);
  });

  it('final 后事件迭代器挂起也不占用 recognizer 槽，且不阻塞主动关闭', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { hangAfterTerminal: true },
    });
    const ctx = await startTestContext({ gateway }, {});
    const ws = connect(ctx);
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart(0));
    ws.send(wireFinish(1));
    const first = await inbox.next();
    expect((first as { type: string }).type).toBe('final');
    // recognizer 槽在终态投影时释放，不等迭代器结束（迭代器永久挂起）。
    await waitFor(() => ctx.quotaManager.stats().sessionGlobalActive === 0);
    // 服务端已发起 1000 主动关闭（连接回收不依赖迭代器"自觉结束"）。
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1000);
    await waitFor(() => ctx.quotaManager.stats().socketGlobalActive === 0);
  });

  it('close/error/terminal 竞争：两类 lease 各只释放一次', async () => {
    const ctx = await startTestContext({}, { maxConnectionsPerUser: 1 });
    const ws = connect(ctx);
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart(0));
    ws.send(wireFinish(1));
    const first = await inbox.next();
    expect((first as { type: string }).type).toBe('final');
    // 终态 → recognizer 槽释放一次。
    await waitFor(() => ctx.quotaManager.stats().sessionGlobalActive === 0);
    // 服务端 1000 关闭 + 客户端补 close/terminate：socket 槽幂等只释放一次。
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1000);
    try {
      ws.close();
      ws.terminate();
    } catch {
      // 连接已关闭后 close/terminate 可能抛：忽略，幂等语义由服务端保证。
    }
    await waitFor(() => ctx.quotaManager.stats().socketGlobalActive === 0);
    expect(ctx.quotaManager.stats().sessionGlobalActive).toBe(0);
    // 释放后可重连。
    const ws2 = connect(ctx);
    await open(ws2);
  });
});
