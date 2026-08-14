import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { GatewayClientSessionAuth } from '../client-auth';
import { createGatewayHttpHandler } from '../server';
import { GatewayPersistenceError } from '@educanvas/db';

const servers: Server[] = [];
const now = new Date('2026-08-11T08:00:00.000Z');

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

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function service(
  onRun?: (input: Parameters<GatewayTurnRunnerPort['run']>[0]) => void,
) {
  const route = {
    actorUserId: 'user:desktop',
    agentId: 'agent:desktop',
    notebookId: 'notebook:one',
    conversationId: 'conversation:one',
    agentProfileId: 'general',
    membershipRole: 'owner' as const,
  };
  const runner: GatewayTurnRunnerPort = {
    async *run(input): AsyncIterable<GatewayEventPayload> {
      onRun?.(input);
      yield { type: 'message.delta', delta: '共享 Runtime 输出' };
      yield { type: 'operation.completed', messageId: 'message:desktop' };
    },
  };
  return new GatewayService(
    new InMemoryGatewayRouteResolver([
      {
        route,
        membership: {
          notebookId: 'notebook:one',
          userId: 'user:desktop',
          role: 'owner',
          grantedByUserId: 'user:desktop',
          grantedAt: now.toISOString(),
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

async function start(
  onRun?: (input: Parameters<GatewayTurnRunnerPort['run']>[0]) => void,
  options: { denyCreate?: boolean } = {},
) {
  const token = `ecs1_${'t'.repeat(43)}`;
  const active = new Map([[hash(token), 'user:desktop']]);
  const sessionAuth = new GatewayClientSessionAuth(
    'h'.repeat(32),
    60,
    () => now,
  );
  const server = createServer(
    createGatewayHttpHandler({
      service: service(onRun),
      internalToken: null,
      clientTransport: {
        bootstrapToken: null,
        sessionAuth,
        desktopSessions: {
          async findActiveRegisteredUserIdByTokenHash({ tokenHash }) {
            return active.get(tokenHash) ?? null;
          },
          async revokeByTokenHash({ tokenHash }) {
            active.delete(tokenHash);
          },
        },
        identities: {
          async ensureRegistered() {
            return {
              userId: 'user:desktop',
              agentId: 'agent:desktop',
              kind: 'registered',
            };
          },
          async getActive(userId) {
            return { userId, agentId: 'agent:desktop', kind: 'registered' };
          },
        },
        directory: {
          async listConversations(userId) {
            return userId === 'user:desktop'
              ? [
                  {
                    notebookId: 'notebook:one',
                    conversationId: 'conversation:one',
                    title: '桌宠会话',
                    agentProfileId: 'general',
                    membershipRole: 'owner',
                  },
                ]
              : [];
          },
          async listConversationPage({ userId, limit }) {
            const items =
              userId === 'user:desktop'
                ? [
                    {
                      notebookId: 'notebook:one',
                      notebookTitle: '桌面笔记本',
                      conversationId: 'conversation:one',
                      title: '桌宠会话',
                      agentProfileId: 'general',
                      membershipRole: 'owner' as const,
                      lastActivityAt: now.toISOString(),
                    },
                  ]
                : [];
            return { items: items.slice(0, limit), nextCursor: null };
          },
          async createConversation(input) {
            if (options.denyCreate)
              throw new GatewayPersistenceError(
                'forbidden',
                'Conversation creation denied',
              );
            return {
              notebookId: input.notebookId,
              notebookTitle: '桌面笔记本',
              conversationId: 'conversation:new',
              title: input.title,
              agentProfileId: 'general',
              membershipRole: 'owner' as const,
              lastActivityAt: now.toISOString(),
            };
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
      },
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, token, sessionAuth };
}

describe('Gateway desktop client sessions', () => {
  it('accepts an active ecs1 bearer while rejecting a Web-cookie-shaped token', async () => {
    const { base, token } = await start();
    const accepted = await fetch(`${base}/v1/client/conversations`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      schemaVersion: 1,
      conversations: [{ conversationId: 'conversation:one' }],
      nextCursor: null,
    });

    const rejected = await fetch(`${base}/v1/client/conversations`, {
      headers: { authorization: `Bearer ${'w'.repeat(43)}` },
    });
    expect(rejected.status).toBe(401);
  });

  it('creates a server-owned conversation and rejects invalid or unauthorized creation', async () => {
    const { base, token } = await start();
    const created = await fetch(`${base}/v1/client/conversations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        notebookId: 'notebook:one',
        title: '错题复习',
      }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      schemaVersion: 1,
      conversation: {
        conversationId: 'conversation:new',
        title: '错题复习',
        agentProfileId: 'general',
      },
    });

    const invalid = await fetch(`${base}/v1/client/conversations?limit=0`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(invalid.status).toBe(400);

    const deniedServer = await start(undefined, { denyCreate: true });
    const denied = await fetch(`${deniedServer.base}/v1/client/conversations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deniedServer.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        notebookId: 'notebook:one',
        title: '不允许创建',
      }),
    });
    expect(denied.status).toBe(403);
  });

  it('revokes the current desktop session immediately', async () => {
    const { base, token } = await start();
    const revoked = await fetch(`${base}/v1/client/session/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revoked.status).toBe(204);
    expect(
      (
        await fetch(`${base}/v1/client/conversations`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(401);
  });

  it('runs the bound Conversation through the shared Gateway runtime identity', async () => {
    let observed: Parameters<GatewayTurnRunnerPort['run']>[0] | undefined;
    const { base, token } = await start((input) => {
      observed = input;
    });
    const response = await fetch(`${base}/v1/client/turns`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        clientMessageId: 'desktop:message:one',
        notebookId: 'notebook:one',
        conversationId: 'conversation:one',
        parts: [{ type: 'text', text: '继续刚才的话题' }],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('operation.completed');
    expect(observed).toMatchObject({
      envelope: {
        principal: {
          subjectId: 'user:desktop',
          userId: 'user:desktop',
          agentId: 'agent:desktop',
        },
        routeHint: {
          notebookId: 'notebook:one',
          conversationId: 'conversation:one',
        },
      },
      route: {
        actorUserId: 'user:desktop',
        agentId: 'agent:desktop',
        notebookId: 'notebook:one',
        conversationId: 'conversation:one',
        agentProfileId: 'general',
      },
    });
  });

  it('keeps existing signed bootstrap sessions compatible', async () => {
    const { base, sessionAuth } = await start();
    const signed = sessionAuth.issue('user:signed').token;
    expect(
      (
        await fetch(`${base}/v1/client/conversations`, {
          headers: { authorization: `Bearer ${signed}` },
        })
      ).status,
    ).toBe(200);
  });
});
