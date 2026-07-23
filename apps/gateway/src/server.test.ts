import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  gatewayProtocolVersion,
  type GatewayInboundEnvelope,
} from '@educanvas/gateway-core';
import {
  GatewayService,
  InMemoryGatewayOperationStore,
  InMemoryGatewayRouteResolver,
  SequentialGatewayIdFactory,
  Sha256GatewayRequestFingerprint,
  type GatewayEventPayload,
  type GatewayTurnRunnerPort,
} from '@educanvas/gateway-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { createGatewayHttpHandler } from './server';
import { GatewayClientSessionAuth } from './client-auth';
import { GatewayObservability } from './observability';

const now = new Date('2026-07-19T04:00:00.000Z');
const token = 'gateway-test-token-that-is-at-least-32-bytes';
const servers: Server[] = [];

function createService(
  onRun?: (input: Parameters<GatewayTurnRunnerPort['run']>[0]) => void,
) {
  const route = {
    actorUserId: 'user:1',
    agentId: 'agent:1',
    notebookId: 'notebook:1',
    conversationId: 'conversation:1',
    agentProfileId: 'general',
    membershipRole: 'owner' as const,
  };
  const runner: GatewayTurnRunnerPort = {
    async *run(input): AsyncIterable<GatewayEventPayload> {
      onRun?.(input);
      yield { type: 'message.delta', delta: '真实 Runtime 适配器测试输出' };
      yield { type: 'operation.completed', messageId: 'message:1' };
    },
  };
  return new GatewayService(
    new InMemoryGatewayRouteResolver([
      {
        route,
        membership: {
          notebookId: 'notebook:1',
          userId: 'user:1',
          role: 'owner',
          grantedByUserId: 'user:1',
          grantedAt: '2026-07-19T03:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
        },
      },
    ]),
    new InMemoryGatewayOperationStore(new SequentialGatewayIdFactory()),
    runner,
    new Sha256GatewayRequestFingerprint(),
    () => now,
  );
}

function envelope(): GatewayInboundEnvelope {
  return {
    protocol: gatewayProtocolVersion,
    envelopeId: 'envelope:1',
    idempotencyKey: 'message:1',
    occurredAt: now.toISOString(),
    connection: {
      connectionId: 'connection:web:1',
      role: 'client',
      transport: 'web',
      adapterId: 'adapter:web',
    },
    principal: {
      subjectId: 'subject:user-1',
      userId: 'user:1',
      agentId: 'agent:1',
      kind: 'user',
      authenticationMethod: 'fixture',
      authenticatedAt: now.toISOString(),
    },
    routeHint: {
      notebookId: 'notebook:1',
      conversationId: 'conversation:1',
    },
    parts: [{ type: 'text', text: '测试 Gateway' }],
    capabilities: {
      manifestId: 'manifest:web:1',
      issuedAt: now.toISOString(),
      capabilities: [
        { name: 'input.text', risk: 'l0', version: '1', constraints: {} },
        {
          name: 'output.stream',
          risk: 'l0',
          version: '1',
          constraints: {},
        },
      ],
    },
    replyTarget: {
      kind: 'connection',
      connectionId: 'connection:web:1',
    },
  };
}

async function start(
  internalToken: string | null,
  clientTransport?: Parameters<
    typeof createGatewayHttpHandler
  >[0]['clientTransport'],
  onRun?: (input: Parameters<GatewayTurnRunnerPort['run']>[0]) => void,
) {
  const server = createServer(
    createGatewayHttpHandler({
      service: createService(onRun),
      internalToken,
      clientTransport,
      observability: new GatewayObservability(),
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe('Gateway HTTP composition root', () => {
  it('serves health without enabling trusted message ingress', async () => {
    const base = await start(null);
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({
      service: 'educanvas-gateway',
      status: 'ok',
      protocol: 'gateway.v1',
    });
    const disabled = await fetch(`${base}/v1/internal/envelopes`, {
      method: 'POST',
      body: JSON.stringify(envelope()),
    });
    expect(disabled.status).toBe(503);
  });

  it('rejects missing internal authentication', async () => {
    const base = await start(token);
    const response = await fetch(`${base}/v1/internal/envelopes`, {
      method: 'POST',
      body: JSON.stringify(envelope()),
    });
    expect(response.status).toBe(401);
  });

  it('onboards a fixed local user without accepting a user id from the client', async () => {
    const sessionAuth = new GatewayClientSessionAuth(
      'l'.repeat(32),
      60,
      () => now,
    );
    const onboarded: string[] = [];
    const base = await start(null, {
      bootstrapToken: null,
      sessionAuth,
      identities: {
        async ensureRegistered(input) {
          onboarded.push(input.trustedSubjectId);
          return {
            userId: input.trustedSubjectId,
            agentId: 'agent:local',
            kind: 'registered',
          };
        },
        async getActive(userId) {
          return { userId, agentId: 'agent:local', kind: 'registered' };
        },
      },
      directory: {
        async listConversations() {
          return [];
        },
      },
      localOnboarding: {
        userId: 'local:owner',
        async ensureWorkspace(userId) {
          onboarded.push(`workspace:${userId}`);
        },
      },
      approvals: {
        async listPending() {
          return [];
        },
      },
      operations: {
        async resolveApproval() {
          throw new Error('not used');
        },
        async listRecent() {
          return [];
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
    });
    const response = await fetch(`${base}/v1/local/onboard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'attacker:chosen' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      userId: 'local:owner',
      agentId: 'agent:local',
    });
    expect(onboarded).toEqual(['local:owner', 'workspace:local:owner']);

    const adminBootstrap = await fetch(`${base}/v1/client/bootstrap`, {
      method: 'POST',
      body: JSON.stringify({ userId: 'attacker:chosen' }),
    });
    expect(adminBootstrap.status).toBe(503);
  });

  it('delegates approval decisions to the atomic Operation control-plane method', async () => {
    const sessionAuth = new GatewayClientSessionAuth(
      'a'.repeat(32),
      60,
      () => now,
    );
    const decisions: unknown[] = [];
    const base = await start(null, {
      bootstrapToken: null,
      sessionAuth,
      identities: {
        async ensureRegistered() {
          return { userId: 'user:1', agentId: 'agent:1', kind: 'registered' };
        },
        async getActive() {
          return { userId: 'user:1', agentId: 'agent:1', kind: 'registered' };
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
        async resolveApproval(input) {
          decisions.push(input);
          return {
            operationId: 'operation:1',
            continuationId: '00000000-0000-4000-8000-000000000001',
            decision: {
              approvalId: input.approvalId,
              status: input.status,
              decidedByUserId: input.actorUserId,
              decidedAt: now.toISOString(),
            },
          };
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
    });
    const session = sessionAuth.issue('user:1');
    const response = await fetch(
      `${base}/v1/client/approvals/approval:1/decision`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'approved' }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      operationId: 'operation:1',
      continuationId: '00000000-0000-4000-8000-000000000001',
      decision: { status: 'approved' },
    });
    expect(decisions).toEqual([
      {
        approvalId: 'approval:1',
        actorUserId: 'user:1',
        status: 'approved',
      },
    ]);
  });

  it('streams canonical NDJSON events and resumes by actor', async () => {
    const base = await start(token);
    const response = await fetch(`${base}/v1/internal/envelopes`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(envelope()),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(
      'application/x-ndjson',
    );
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; operationId: string });
    expect(events.map((event) => event.type)).toEqual([
      'operation.accepted',
      'message.delta',
      'operation.completed',
    ]);

    const resumed = await fetch(
      `${base}/v1/internal/operations/${events[0]!.operationId}/events?after=0`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          'x-educanvas-user-id': 'user:1',
        },
      },
    );
    expect(resumed.status).toBe(200);
    expect(
      ((await resumed.json()) as { events: { type: string }[] }).events.map(
        (event) => event.type,
      ),
    ).toEqual(['message.delta', 'operation.completed']);

    const crossUser = await fetch(
      `${base}/v1/internal/operations/${events[0]!.operationId}/events`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          'x-educanvas-user-id': 'user:2',
        },
      },
    );
    expect(crossUser.status).toBe(403);

    const metrics = await fetch(`${base}/v1/internal/metrics`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(metrics.status).toBe(200);
    expect(await metrics.json()).toMatchObject({
      operationEventsTotal: 3,
      operationTerminalsTotal: 1,
    });
  });

  it('routes Web and TUI fixtures to the same conversation through Gateway', async () => {
    const sessionAuth = new GatewayClientSessionAuth(
      's'.repeat(32),
      60,
      () => now,
    );
    const runs: Parameters<GatewayTurnRunnerPort['run']>[0][] = [];
    const issuedHandoffs: Array<{
      userId: string;
      conversationId: string;
      tokenDigest: string;
    }> = [];
    const connectionActors: string[] = [];
    const connection = {
      connectionId: 'connection:telegram:1',
      provider: 'telegram' as const,
      status: 'pending' as const,
      conversationId: 'conversation:1',
      createdAt: '2026-07-21T08:00:00.000Z',
      activationExpiresAt: '2026-07-21T08:10:00.000Z',
      revokedAt: null,
    };
    const base = await start(
      token,
      {
        bootstrapToken: token,
        sessionAuth,
        identities: {
          async ensureRegistered() {
            return { userId: 'user:1', agentId: 'agent:1', kind: 'registered' };
          },
          async getActive() {
            return { userId: 'user:1', agentId: 'agent:1', kind: 'registered' };
          },
        },
        directory: {
          async listConversations() {
            return [
              {
                notebookId: 'notebook:1',
                conversationId: 'conversation:1',
                title: '共享会话',
                agentProfileId: 'general',
                membershipRole: 'owner',
              },
            ];
          },
        },
        approvals: {
          async listPending() {
            return [];
          },
        },
        operations: {
          async resolveApproval() {
            throw new Error('not used');
          },
          async listRecent() {
            return [];
          },
        },
        handoffs: {
          async issue(input) {
            issuedHandoffs.push(input);
            return { expiresAt: input.expiresAt.toISOString() };
          },
        },
        connections: {
          async list(userId) {
            connectionActors.push(`list:${userId}`);
            return {
              providers: [
                {
                  provider: 'telegram',
                  label: 'Telegram',
                  availability: 'available',
                  disabledReason: null,
                  experimental: true,
                },
              ],
              connections: [],
            };
          },
          async connect(input) {
            connectionActors.push(`connect:${input.userId}`);
            return {
              connection,
              authorization: {
                kind: 'external_url',
                url: 'https://t.me/EduCanvasTutorBot?start=educanvas_connection',
                expiresAt: connection.activationExpiresAt,
              },
            };
          },
          async revoke(input) {
            connectionActors.push(`revoke:${input.userId}`);
            return {
              connection: {
                ...connection,
                status: 'revoked',
                activationExpiresAt: null,
                revokedAt: '2026-07-21T08:01:00.000Z',
              },
            };
          },
        },
      },
      (input) => runs.push(input),
    );
    const webTurn = await fetch(`${base}/v1/internal/envelopes`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(envelope()),
    });
    expect(webTurn.status).toBe(200);
    await webTurn.text();
    const bootstrap = await fetch(`${base}/v1/client/bootstrap`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'user:1' }),
    });
    expect(bootstrap.status).toBe(200);
    const session = (await bootstrap.json()) as { token: string };
    const directory = await fetch(`${base}/v1/client/conversations`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(directory.status).toBe(200);
    const handoff = await fetch(`${base}/v1/client/handoffs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ conversationId: 'conversation:1' }),
    });
    expect(handoff.status).toBe(201);
    expect(await handoff.json()).toMatchObject({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: expect.any(String),
    });
    expect(issuedHandoffs).toMatchObject([
      {
        userId: 'user:1',
        conversationId: 'conversation:1',
        tokenDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
    const listedConnections = await fetch(`${base}/v1/client/connections`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(listedConnections.status).toBe(200);
    const connected = await fetch(`${base}/v1/client/connections/connect`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'telegram',
        conversationId: 'conversation:1',
      }),
    });
    expect(connected.status).toBe(201);
    const revoked = await fetch(`${base}/v1/client/connections/revoke`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ connectionId: connection.connectionId }),
    });
    expect(revoked.status).toBe(200);
    expect(connectionActors).toEqual([
      'list:user:1',
      'connect:user:1',
      'revoke:user:1',
    ]);
    const turn = await fetch(`${base}/v1/client/turns`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        clientMessageId: 'tui:1',
        notebookId: 'notebook:1',
        conversationId: 'conversation:1',
        parts: [{ type: 'text', text: '你好' }],
      }),
    });
    expect(turn.status).toBe(200);
    expect(await turn.text()).toContain('operation.completed');
    expect(
      runs.map((run) => ({
        transport: run.envelope.connection.transport,
        notebookId: run.route.notebookId,
        conversationId: run.route.conversationId,
      })),
    ).toEqual([
      {
        transport: 'web',
        notebookId: 'notebook:1',
        conversationId: 'conversation:1',
      },
      {
        transport: 'tui',
        notebookId: 'notebook:1',
        conversationId: 'conversation:1',
      },
    ]);
  });
});
