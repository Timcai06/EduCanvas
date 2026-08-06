/**
 * V12 WebSocket transport 端到端测试（真实 node:http + ws 服务器与客户端）。
 *
 * 覆盖 V12-E 验收：未认证/凭证无效/绑定不匹配/Origin 拒绝、伪造身份字段、
 * 合法流、endpoint、重复 start/finish、finish 后 chunk、cancel、断连自动
 * 取消、竞争唯一终态、adapter 创建失败、resolver unavailable、非法/双终态
 * adapter 事件、连接隔离、日志脱敏与不创建 Agent Turn。全部使用 fake
 * resolver/session，不加载真实 WASM 模型。
 *
 * 握手凭证：短时单次使用的 WebSocket ticket（`StreamingTranscriptionTicketStore`），
 * 经 `Authorization: Bearer <ticket>` 或 `Sec-WebSocket-Protocol: ticket.<ticket>`
 * 携带；测试直接向 store 签发（HTTP 签发端点属于 client-routes 测试面）。
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { streamingTranscriptionProtocolVersion } from '@educanvas/agent-core';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FakeTranscriptionGateway,
  VALID_PCM_BYTES,
} from './streaming-transcription-test-support';
import { StreamingTranscriptionTicketStore } from './streaming-transcription-ticket';
import { normalizeWsAllowedOrigin } from './config';
import { StreamingTranscriptionQuotaManager } from './streaming-transcription-quota-manager';
import { STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS } from './streaming-transcription-quotas';
import {
  STREAMING_TRANSCRIPTION_WS_PATH,
  createStreamingTranscriptionUpgradeHandler,
  type StreamingTranscriptionUpgradeDependencies,
  type StreamingTranscriptionLogEntry,
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
      // 连接已关闭或握手失败后 terminate 会抛：忽略，连接已不存在。
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

/** 顺序唯一 ticket 值生成器（避免随机 ticket 重放歧义）。 */
function sequentialTicketFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `test-ticket-${counter}`;
  };
}

async function startTestContext(
  overrides: Partial<StreamingTranscriptionUpgradeDependencies> = {},
  gateway?: FakeTranscriptionGateway,
): Promise<TestContext> {
  const logs: StreamingTranscriptionLogEntry[] = [];
  const tickets = new StreamingTranscriptionTicketStore({
    createRandom: sequentialTicketFactory(),
  });
  // V13：默认配额足够宽，连接上限测试通过 overrides 注入小配额。
  const quotaManager = new StreamingTranscriptionQuotaManager(
    STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
  );
  const deps: StreamingTranscriptionUpgradeDependencies = {
    tickets,
    checkNotebookAccess: async ({ notebookId, trustedSubjectId }) =>
      notebookId === 'notebook:A' && trustedSubjectId === 'user:A',
    // 默认测试策略：无 Origin（非浏览器）与任意 Origin 都允许；Origin
    // 专项测试注入收紧的策略。
    isAllowedOrigin: () => true,
    gateway: gateway ?? new FakeTranscriptionGateway(),
    unavailableReason: null,
    quotaManager,
    quotas: STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS,
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

/** 直接向 ticket store 签发连接凭证（绕过 HTTP 端点，端点属 client-routes 测试面）。 */
function issueTicket(
  ctx: TestContext,
  input: { userId?: string; notebookId?: string } = {},
): string {
  return ctx.tickets.issue({
    userId: input.userId ?? 'user:A',
    notebookId: input.notebookId ?? 'notebook:A',
  }).ticket;
}

function connect(
  ctx: TestContext,
  options: {
    ticket?: string | null;
    notebookId?: string | null;
    subprotocol?: string;
    origin?: string;
  } = {},
): WebSocket {
  const notebookId =
    options.notebookId === undefined ? 'notebook:A' : options.notebookId;
  const query = notebookId === null ? '' : `?notebookId=${notebookId}`;
  const headers: Record<string, string> = {};
  if (options.origin !== undefined) headers.origin = options.origin;
  if (options.ticket !== null && options.ticket !== undefined) {
    headers.authorization = `Bearer ${options.ticket}`;
  }
  const ws = new WebSocket(
    `ws://127.0.0.1:${(ctx.server.address() as AddressInfo).port}${STREAMING_TRANSCRIPTION_WS_PATH}${query}`,
    options.subprotocol ? [options.subprotocol] : undefined,
    { headers },
  );
  // ws 客户端默认不监听 error：握手失败/清理期 terminate 会 emit 'error'，
  // 无监听器将变为 uncaught exception。测试通过 open/unexpected-response/
  // close 断言结果，这里只兜底吞掉 error 事件。
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

interface Collector {
  next(): Promise<unknown>;
  drain(): unknown[];
  count(): number;
}

function collect(ws: WebSocket): Collector {
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
    drain: () => queue.splice(0),
    count: () => queue.length,
  };
}

/** 等待连接被服务端关闭；返回 close code。 */
function waitForClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

/** 断言连接直接失败（未升级、无 HTTP 响应，如子协议被拒）。 */
function expectConnectionFailure(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => reject(new Error('unexpected open')));
    ws.once('error', () => resolve());
    ws.once('close', () => resolve());
  });
}

/** 等待条件成立（带超时兜底，避免测试悬挂）。 */
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

function wireStartWithForgedFields(): string {
  return JSON.stringify({
    type: 'start',
    protocolVersion: PROTO,
    operationId: 'op:1',
    segmentId: 'seg:1',
    sequence: 0,
    sampleRate: 16_000,
    channels: 1,
    encoding: 'pcm_s16le',
    userId: 'user:attacker',
    role: 'owner',
    notebookId: 'notebook:hijack',
  });
}

describe('V12 transport 握手授权', () => {
  it('测试1：无凭证连接拒绝（401 UNAUTHENTICATED）', async () => {
    const ctx = await startTestContext();
    const ws = connect(ctx, { ticket: null });
    await expectHandshakeRejection(ws, 401, 'UNAUTHENTICATED');
  });

  it('未知/伪造 ticket 拒绝（401 UNAUTHENTICATED）', async () => {
    const ctx = await startTestContext();
    const ws = connect(ctx, { ticket: 'forged.ticket.value' });
    await expectHandshakeRejection(ws, 401, 'UNAUTHENTICATED');
  });

  it('ticket 已消费（单次使用）后再次使用拒绝（401）', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const first = connect(ctx, { ticket });
    await open(first);
    first.close();
    await waitForClose(first);
    const replay = connect(ctx, { ticket });
    await expectHandshakeRejection(replay, 401, 'UNAUTHENTICATED');
  });

  it('ticket 过期拒绝（401）', async () => {
    let nowMs = 1_000_000;
    const store = new StreamingTranscriptionTicketStore({
      createRandom: sequentialTicketFactory(),
      now: () => nowMs,
    });
    const ctx = await startTestContext({ tickets: store });
    const ticket = issueTicket(ctx);
    // 推进时钟超过 60 秒 TTL：握手兑换时过期 → 401。
    nowMs += 61_000;
    const ws = connect(ctx, { ticket });
    await expectHandshakeRejection(ws, 401, 'UNAUTHENTICATED');
  });

  it('ticket 与 URL Notebook 不匹配拒绝（401）', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx, { notebookId: 'notebook:A' });
    const ws = connect(ctx, { ticket, notebookId: 'notebook:B' });
    await expectHandshakeRejection(ws, 401, 'UNAUTHENTICATED');
  });

  it('测试3：无 Notebook 访问权限拒绝（404）', async () => {
    const ctx = await startTestContext();
    // ticket 绑定 user:other（无 notebook:A 权限）→ 服务端重新判定拒绝。
    const ticket = issueTicket(ctx, { userId: 'user:other' });
    const ws = connect(ctx, { ticket, notebookId: 'notebook:A' });
    await expectHandshakeRejection(ws, 404, 'NOT_FOUND');
  });

  it('notebookId 非法拒绝（400 INVALID_REQUEST）', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket, notebookId: '../etc/passwd' });
    await expectHandshakeRejection(ws, 400, 'INVALID_REQUEST');
  });

  it('缺 notebookId query → 400 INVALID_REQUEST', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket, notebookId: null });
    await expectHandshakeRejection(ws, 400, 'INVALID_REQUEST');
  });

  it('浏览器路径：ticket.* 子协议认证成功且被 echo', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { subprotocol: `ticket.${ticket}` });
    await open(ws);
    expect(ws.protocol).toBe(`ticket.${ticket}`);
  });

  it('未知子协议拒绝握手（fail-closed）', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    // ws 库对 handleProtocols=false 直接断连（不发 HTTP 响应）。
    const ws = connect(ctx, { ticket, subprotocol: 'chat.v2' });
    await expectConnectionFailure(ws);
  });

  it('ticket.* 子协议空 ticket → 401', async () => {
    const ctx = await startTestContext();
    const ws = connect(ctx, { subprotocol: 'ticket.' });
    await expectHandshakeRejection(ws, 401, 'UNAUTHENTICATED');
  });

  it('ticket.* 子协议 ticket 超 4096 → 401', async () => {
    const ctx = await startTestContext();
    const ws = connect(ctx, { subprotocol: `ticket.${'x'.repeat(4097)}` });
    await expectHandshakeRejection(ws, 401, 'UNAUTHENTICATED');
  });

  it('Origin 不在白名单 → 403 FORBIDDEN', async () => {
    const ctx = await startTestContext({
      isAllowedOrigin: (origin) =>
        origin !== undefined && origin !== null && origin.includes('trusted'),
    });
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket, origin: 'https://evil.example' });
    await expectHandshakeRejection(ws, 403, 'FORBIDDEN');
  });

  it('Origin 在白名单 → 成功建立会话', async () => {
    const ctx = await startTestContext({
      isAllowedOrigin: (origin) => origin === 'https://app.educanvas.test',
    });
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, {
      ticket,
      origin: 'https://app.educanvas.test',
    });
    await open(ws);
  });

  it('Origin 带路径 → 403（规范化拒绝，模拟 composition root 真实策略）', async () => {
    const ctx = await startTestContext({
      // 与 index.ts 一致：Origin 先规范化再与白名单比较。
      isAllowedOrigin: (origin) => {
        if (origin === undefined || origin === null) return true;
        const normalized = normalizeWsAllowedOrigin(origin);
        return (
          normalized !== null &&
          ['http://127.0.0.1:3101', 'http://localhost:3101'].includes(
            normalized,
          )
        );
      },
    });
    const ticket = issueTicket(ctx);
    // 合法 Origin 通过。
    const ok = connect(ctx, { ticket, origin: 'http://localhost:3101' });
    await open(ok);
    // 带路径的 Origin 被规范化拒绝。
    const forgedTicket = issueTicket(ctx);
    const bad = connect(ctx, {
      ticket: forgedTicket,
      origin: 'http://localhost:3101/sneaky',
    });
    await expectHandshakeRejection(bad, 403, 'FORBIDDEN');
  });

  it('checkNotebookAccess 抛错 → 404（fail-closed）', async () => {
    const ctx = await startTestContext({
      checkNotebookAccess: async () => {
        throw new Error('db down');
      },
    });
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await expectHandshakeRejection(ws, 404, 'NOT_FOUND');
  });
});

describe('V12 transport 合法会话', () => {
  it('测试5：start → chunk → partial → finish → final（端到端）', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { finalText: 'final-text' },
    });
    const ctx = await startTestContext({}, gateway);
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    ws.send(wireChunk(1));
    ws.send(wireFinish(2));
    const events = [await inbox.next(), await inbox.next()];
    const types = events.map((event) => (event as { type: string }).type);
    expect(types).toContain('partial');
    expect(types[types.length - 1]).toBe('final');
    expect(gateway.beginCalls).toBe(1);
    expect(gateway.sessions[0]!.pushedChunks).toHaveLength(1);
  });

  it('测试6：endpoint 后产生 final', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { endpointAfterChunks: 1, finalText: 'endpoint-final' },
    });
    const ctx = await startTestContext({}, gateway);
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    ws.send(wireChunk(1));
    ws.send(wireFinish(2));
    const events = [await inbox.next(), await inbox.next(), await inbox.next()];
    const types = events.map((event) => (event as { type: string }).type);
    expect(types).toContain('endpoint');
    expect(types.indexOf('endpoint')).toBeLessThan(types.indexOf('final'));
  });

  it('测试16：两个连接状态隔离', async () => {
    const gateway = new FakeTranscriptionGateway();
    const ctx = await startTestContext({}, gateway);
    const ticketA = issueTicket(ctx);
    const ticketB = issueTicket(ctx);
    const first = connect(ctx, { ticket: ticketA });
    const second = connect(ctx, { ticket: ticketB });
    await open(first);
    await open(second);
    const firstInbox = collect(first);
    const secondInbox = collect(second);
    first.send(wireStart());
    second.send(wireStart());
    first.send(wireChunk(1));
    second.send(wireChunk(1));
    first.send(wireCancel(2));
    await waitFor(() => gateway.sessions.length === 2);
    await waitFor(() => gateway.sessions[0]!.cancelCalls === 1);
    expect(gateway.sessions[1]!.cancelCalls).toBe(0);
    second.send(wireFinish(2));
    // second：chunk 的 partial + finish 的 final，共 2 个事件。
    const secondEvents = [await secondInbox.next(), await secondInbox.next()];
    expect(
      secondEvents.map((event) => (event as { type: string }).type),
    ).toContain('final');
    // first 已取消：partial + failed 终态，共 2 个事件。
    const firstEvents = [await firstInbox.next(), await firstInbox.next()];
    const failed = firstEvents.filter(
      (event) => (event as { type: string }).type === 'failed',
    );
    expect(failed).toHaveLength(1);
  });
});

describe('V12 transport 协议违规', () => {
  it('测试4：客户端伪造身份字段被 schema 拒绝（INVALID_REQUEST + 关闭）', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStartWithForgedFields());
    const frame = (await inbox.next()) as { error?: { code: string } };
    expect(frame.error?.code).toBe('INVALID_REQUEST');
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1008);
  });

  it('测试7：重复 start → INVALID_MESSAGE_SEQUENCE + 关闭', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    ws.send(wireStart());
    const frame = (await inbox.next()) as { error?: { code: string } };
    expect(frame.error?.code).toBe('INVALID_MESSAGE_SEQUENCE');
  });

  it('测试8：重复 finish → 稳定关闭 + 违规审计', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    ws.send(wireFinish(1));
    ws.send(wireFinish(2));
    const closeCode = await waitForClose(ws);
    // REVISE：finish 终态投影后服务端立即以 1000 正常关闭；同一网络批次
    // 内已进入 Channel 的重复 finish 仍走协议路径（1008 + 错误帧），跨批
    // 次到达的帧在连接关闭后不保证再返回协议错误。
    expect([1000, 1008]).toContain(closeCode);
    const frames = inbox.drain() as Array<{ error?: { code: string } }>;
    if (closeCode === 1008) {
      expect(
        frames.some(
          (frame) => frame.error?.code === 'INVALID_MESSAGE_SEQUENCE',
        ),
      ).toBe(true);
    }
  });

  it('测试9：finish 后 chunk → 稳定关闭 + 违规审计', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    ws.send(wireFinish(1));
    ws.send(wireChunk(2));
    const closeCode = await waitForClose(ws);
    // REVISE：finish 终态投影后服务端立即以 1000 正常关闭；同一网络批次
    // 内已进入 Channel 的违规 chunk 仍走协议路径（1008 + 错误帧），跨批
    // 次到达的帧在连接关闭后不保证再返回协议错误（确定性语义见 Codex
    // REVISE 第二轮；协议拒绝由 channel 单测确定性覆盖）。
    expect([1000, 1008]).toContain(closeCode);
    const frames = inbox.drain() as Array<{ error?: { code: string } }>;
    if (closeCode === 1008) {
      expect(
        frames.some(
          (frame) => frame.error?.code === 'INVALID_MESSAGE_SEQUENCE',
        ),
      ).toBe(true);
    }
  });

  it('cancel 后 chunk → 稳定关闭 + 违规审计', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    ws.send(wireCancel(1));
    ws.send(wireChunk(2));
    const closeCode = await waitForClose(ws);
    // REVISE：cancel 终态（failed+CANCELLED）投影后服务端立即以 1000 正常
    // 关闭；同一网络批次内已进入 Channel 的违规 chunk 仍走协议路径（1008 +
    // 错误帧），跨批次到达的帧在连接关闭后不保证再返回协议错误（确定性
    // 语义见 Codex REVISE 第二轮；协议拒绝由 channel 单测确定性覆盖）。
    expect([1000, 1008]).toContain(closeCode);
    const frames = inbox.drain() as Array<{ error?: { code: string } }>;
    if (closeCode === 1008) {
      expect(
        frames.some(
          (frame) => frame.error?.code === 'INVALID_MESSAGE_SEQUENCE',
        ),
      ).toBe(true);
    }
  });

  it('非 JSON 文本帧 → INVALID_REQUEST', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send('{broken json');
    const frame = (await inbox.next()) as { error?: { code: string } };
    expect(frame.error?.code).toBe('INVALID_REQUEST');
  });

  it('二进制帧 → INVALID_REQUEST + 1008，且立即取消未终态 Session', async () => {
    const gateway = new FakeTranscriptionGateway();
    const ctx = await startTestContext({}, gateway);
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    await waitFor(() => gateway.sessions.length === 1);
    ws.send(Buffer.from([0x00, 0x01, 0x02]));
    const frame = (await inbox.next()) as { error?: { code: string } };
    expect(frame.error?.code).toBe('INVALID_REQUEST');
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1008);
    // 协议违规立即 abort：Session 取消（CANCELLED 收敛），不等 close handshake。
    await waitFor(() => gateway.sessions[0]!.aborted === true);
    expect(gateway.sessions[0]!.terminalEvent?.type).toBe('failed');
  });

  it('超过 maxPayload 的帧 → 1009', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    // 130 KiB > MAX_STREAMING_TRANSCRIPTION_FRAME_BYTES（128 KiB）。
    ws.send('x'.repeat(130 * 1024));
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1009);
  });
});

describe('V12 transport 取消与生命周期', () => {
  it('测试10：cancel → failed + CANCELLED', async () => {
    const ctx = await startTestContext();
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    ws.send(wireCancel(1));
    const event = (await inbox.next()) as {
      type: string;
      failureCode?: string;
    };
    expect(event.type).toBe('failed');
    expect(event.failureCode).toBe('CANCELLED');
  });

  it('测试11：disconnect 自动取消未终态 Session', async () => {
    const gateway = new FakeTranscriptionGateway();
    const ctx = await startTestContext({}, gateway);
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    ws.send(wireStart());
    await waitFor(() => gateway.sessions.length === 1);
    ws.close();
    await waitFor(() => gateway.sessions[0]!.aborted === true);
    expect(gateway.sessions[0]!.terminalEvent?.type).toBe('failed');
  });

  it('测试12：adapter 立即失败与 cancel 竞争只有一个终态', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { failImmediately: true },
    });
    const ctx = await startTestContext({}, gateway);
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    ws.send(wireCancel(1));
    const failed = (await inbox.next()) as {
      type: string;
      failureCode?: string;
    };
    expect(failed.type).toBe('failed');
    expect(failed.failureCode).toBe('MODEL_FAILED');
    // 事件流只交付一个终态。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      inbox.drain().filter((e) => (e as { type: string }).type === 'failed'),
    ).toHaveLength(0);
  });

  it('测试13：adapter 创建失败 → failed + MODEL_FAILED', async () => {
    const gateway = new FakeTranscriptionGateway({ createFailure: true });
    const ctx = await startTestContext({}, gateway);
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    const event = (await inbox.next()) as {
      type: string;
      failureCode?: string;
    };
    expect(event.type).toBe('failed');
    expect(event.failureCode).toBe('MODEL_FAILED');
    expect(gateway.beginCalls).toBe(1);
  });

  it('测试15：adapter 事件 schema 非法 → 连接关闭（1011）且不投影', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { emitInvalidEvent: true },
    });
    const ctx = await startTestContext({}, gateway);
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1011);
    expect(inbox.count()).toBe(0);
  });

  it('adapter 双终态（两个结构合法 final）→ 只投影一个 + 违约审计 + 关闭', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { emitDoubleTerminal: true },
    });
    const ctx = await startTestContext({}, gateway);
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    const first = (await inbox.next()) as { type: string };
    expect(first.type).toBe('final');
    const closeCode = await waitForClose(ws);
    // REVISE：首个 final 验证并投影后服务端立即以 1000 正常关闭；第二个
    // final 违约仍被审计（abort + 1011 尝试），但连接可能已 CLOSING（正常
    // 关闭抢先），关闭码以先发者为准——违约审计独立于关闭码（Codex REVISE
    // 第二轮："Adapter 后续违约审计可以独立处理"）。只投影一个 final 的
    // 唯一终态纪律由下方 inbox 断言与 channel 单测确定性覆盖。
    expect([1000, 1011]).toContain(closeCode);
    // 第二个 final 被 V04 序列验证器拒绝，未投影。
    expect(inbox.count()).toBe(0);
  });

  it('adapter sequence 跳号 → 违约事件不投影 + 关闭（1011）', async () => {
    const gateway = new FakeTranscriptionGateway({
      session: { emitSequenceGap: true },
    });
    const ctx = await startTestContext({}, gateway);
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    // 第一条 partial(0) 合法投影；随后序列验证器拒绝第二条并关闭。
    const first = (await inbox.next()) as { type: string };
    expect(first.type).toBe('partial');
    const closeCode = await waitForClose(ws);
    expect(closeCode).toBe(1011);
    expect(inbox.count()).toBe(0);
  });
});

describe('V12 transport 不可用与安全', () => {
  it('测试14：resolver unavailable → 503 且不创建 recognizer', async () => {
    const gateway = new FakeTranscriptionGateway();
    const ctx = await startTestContext(
      { gateway: null, unavailableReason: 'model_file_missing' },
      gateway,
    );
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await expectHandshakeRejection(
      ws,
      503,
      'STREAMING_TRANSCRIPTION_UNAVAILABLE',
    );
    expect(gateway.beginCalls).toBe(0);
    expect(
      ctx.logs.some(
        (entry) =>
          entry.label === 'streaming_unavailable' &&
          entry.reason === 'model_file_missing',
      ),
    ).toBe(true);
  });

  it('clientTransport 未启用（tickets null）→ 503 CLIENT_TRANSPORT_DISABLED', async () => {
    const ctx = await startTestContext({ tickets: null });
    const ws = connect(ctx, { ticket: null });
    await expectHandshakeRejection(ws, 503, 'CLIENT_TRANSPORT_DISABLED');
  });

  it('测试17：日志不含敏感字段（含 ticket）', async () => {
    const gateway = new FakeTranscriptionGateway();
    const ctx = await startTestContext({}, gateway);
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    ws.send(wireFinish(1));
    const finalEvent = (await inbox.next()) as { type: string };
    expect(finalEvent.type).toBe('final');
    ws.close();
    await waitFor(() => ctx.logs.length >= 3, 2_000);
    const allowedLabels = new Set([
      'connection_opened',
      'connection_closed',
      'session_started',
      'session_ended',
      'streaming_unavailable',
    ]);
    for (const entry of ctx.logs) {
      expect(allowedLabels.has(entry.label)).toBe(true);
      for (const key of Object.keys(entry)) {
        expect([
          'label',
          'code',
          'reason',
          'notebookId',
          'operationId',
          'segmentId',
        ]).toContain(key);
      }
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toMatch(/token|ticket|bearer|secret|pcm|base64/i);
    }
  });

  it('测试18：端到端不创建 Agent Turn（只创建 Session）', async () => {
    const gateway = new FakeTranscriptionGateway();
    const ctx = await startTestContext({}, gateway);
    const ticket = issueTicket(ctx);
    const ws = connect(ctx, { ticket });
    await open(ws);
    const inbox = collect(ws);
    ws.send(wireStart());
    ws.send(wireChunk(1));
    ws.send(wireFinish(2));
    // chunk 的 partial + finish 的 final，共 2 个事件。
    await inbox.next();
    await inbox.next();
    // 通道只创建了转录 Session：没有 Turn、没有 operation、没有 Agent 调用。
    expect(gateway.beginCalls).toBe(1);
    expect(gateway.sessions).toHaveLength(1);
    expect(gateway.sessions[0]!.request.traceId).toBe('trace:test');
  });
});
