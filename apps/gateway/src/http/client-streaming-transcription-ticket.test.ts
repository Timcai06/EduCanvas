/**
 * V12 ticket 签发端点（`POST /v1/client/streaming-transcription/tickets`）测试。
 *
 * 经 HTTPS 用 session bearer 换取短时单次使用、绑定用户与 Notebook 的
 * WebSocket ticket；Notebook 由服务端重新绑定校验，客户端不得伪造。
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  GatewayService,
  InMemoryGatewayOperationStore,
  InMemoryGatewayRouteResolver,
  SequentialGatewayIdFactory,
  Sha256GatewayRequestFingerprint,
  type GatewayTurnRunnerPort,
} from '@educanvas/gateway-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { GatewayClientSessionAuth } from '../client-auth';
import { createGatewayHttpHandler } from '../server';
import { StreamingTranscriptionTicketStore } from '../streaming-transcription-ticket';

const SECRET = 'streaming-ticket-test-secret-0123456789';
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
});

function service(): GatewayService {
  return new GatewayService(
    new InMemoryGatewayRouteResolver([]),
    new InMemoryGatewayOperationStore(new SequentialGatewayIdFactory()),
    {
      async *run(_envelope) {
        yield* [];
      },
    } satisfies GatewayTurnRunnerPort,
    new Sha256GatewayRequestFingerprint(),
  );
}

interface TestHarness {
  baseUrl: string;
  auth: GatewayClientSessionAuth;
  tickets: StreamingTranscriptionTicketStore;
  logs: Array<Record<string, unknown>>;
}

async function startHarness(
  overrides: {
    checkNotebookAccess?: (input: {
      notebookId: string;
      trustedSubjectId: string;
    }) => Promise<boolean>;
    streamingTickets?: StreamingTranscriptionTicketStore | null;
  } = {},
): Promise<TestHarness> {
  const auth = new GatewayClientSessionAuth(SECRET);
  const tickets = new StreamingTranscriptionTicketStore();
  const checkNotebookAccess =
    overrides.checkNotebookAccess ??
    (async (input: { notebookId: string; trustedSubjectId: string }) =>
      input.notebookId === 'notebook:A' && input.trustedSubjectId === 'user:A');
  const server = createServer(
    createGatewayHttpHandler({
      service: service(),
      internalToken: null,
      clientTransport: {
        bootstrapToken: null,
        sessionAuth: auth,
        identities: {
          async ensureRegistered() {
            return { userId: 'user:A', agentId: 'agent:A', kind: 'registered' };
          },
          async getActive() {
            return { userId: 'user:A', agentId: 'agent:A', kind: 'registered' };
          },
        },
        directory: {
          async listConversations() {
            return [];
          },
        },
        approvals: {
          async listPending() {
            return [];
          },
        },
        operations: {
          async listRecent() {
            return [];
          },
          async resolveApproval() {
            throw new Error('not used');
          },
        },
        handoffs: {
          async issue(input) {
            return { expiresAt: input.expiresAt.toISOString() };
          },
        },
        connections: {
          async list() {
            return { providers: [], connections: [] };
          },
          async connect() {
            throw new Error('not used');
          },
          async revoke() {
            throw new Error('not used');
          },
        },
        streamingTickets:
          overrides.streamingTickets === undefined
            ? tickets
            : overrides.streamingTickets,
        checkNotebookAccess,
      },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    auth,
    tickets,
    logs: [],
  };
}

async function postTickets(
  baseUrl: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(
    `${baseUrl}/v1/client/streaming-transcription/tickets`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() };
}

describe('POST /v1/client/streaming-transcription/tickets', () => {
  it('未认证拒绝（401）', async () => {
    const harness = await startHarness();
    const { status, body } = await postTickets(harness.baseUrl, 'bad-token', {
      notebookId: 'notebook:A',
    });
    expect(status).toBe(401);
    expect(body).toEqual({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('合法请求签发绑定用户与 Notebook 的单次使用 ticket', async () => {
    const harness = await startHarness();
    const token = harness.auth.issue('user:A').token;
    const { status, body } = await postTickets(harness.baseUrl, token, {
      notebookId: 'notebook:A',
    });
    expect(status).toBe(201);
    const grant = body as { ticket?: string; expiresAt?: string };
    expect(typeof grant.ticket).toBe('string');
    expect(grant.ticket!.length).toBeGreaterThan(16);
    expect(new Date(grant.expiresAt!).getTime()).toBeGreaterThan(Date.now());
    // ticket 可兑换且绑定正确主体与 Notebook。
    expect(harness.tickets.redeem(grant.ticket!)).toEqual({
      userId: 'user:A',
      notebookId: 'notebook:A',
    });
  });

  it('无 Notebook 访问权限 → 404', async () => {
    const harness = await startHarness({
      checkNotebookAccess: async () => false,
    });
    const token = harness.auth.issue('user:A').token;
    const { status, body } = await postTickets(harness.baseUrl, token, {
      notebookId: 'notebook:B',
    });
    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: 'NOT_FOUND' } });
  });

  it('checkNotebookAccess 抛错 → 404（fail-closed）', async () => {
    const harness = await startHarness({
      checkNotebookAccess: async () => {
        throw new Error('db down');
      },
    });
    const token = harness.auth.issue('user:A').token;
    const { status } = await postTickets(harness.baseUrl, token, {
      notebookId: 'notebook:A',
    });
    expect(status).toBe(404);
  });

  it('notebookId 非法 → 400', async () => {
    const harness = await startHarness();
    const token = harness.auth.issue('user:A').token;
    const { status, body } = await postTickets(harness.baseUrl, token, {
      notebookId: '../etc/passwd',
    });
    expect(status).toBe(400);
    expect(body).toEqual({ error: { code: 'INVALID_REQUEST' } });
  });

  it('伪造额外字段（userId/role）→ 400（strict schema）', async () => {
    const harness = await startHarness();
    const token = harness.auth.issue('user:A').token;
    const { status } = await postTickets(harness.baseUrl, token, {
      notebookId: 'notebook:A',
      userId: 'user:attacker',
      role: 'owner',
    });
    expect(status).toBe(400);
  });

  it('streamingTickets 未注入 → 503', async () => {
    const harness = await startHarness({ streamingTickets: null });
    const token = harness.auth.issue('user:A').token;
    const { status, body } = await postTickets(harness.baseUrl, token, {
      notebookId: 'notebook:A',
    });
    expect(status).toBe(503);
    expect(body).toEqual({
      error: { code: 'STREAMING_TRANSCRIPTION_UNAVAILABLE' },
    });
  });
});
