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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayClientSessionAuth } from '../client-auth';
import { GatewayCanvasResourceError } from '../canvas-resource-service';
import { createGatewayHttpHandler } from '../server';

const now = new Date('2026-08-04T00:00:00.000Z');
const servers: Server[] = [];

const resource = {
  schemaVersion: 1 as const,
  resourceId: 'source:1',
  notebookId: 'notebook:1',
  resourceKind: 'source' as const,
  title: '课堂笔记',
  status: 'ready' as const,
  version: {
    versionId: 'version:1',
    sequence: null,
    checksum: 'a'.repeat(64),
  },
  representation: {
    kind: 'text' as const,
    mimeType: 'text/plain',
    byteSize: 8,
  },
  renderer: { rendererId: 'source.text', rendererVersion: 1 },
  trustTier: 'tier1' as const,
  allowedActions: ['view' as const],
  canProduceCandidateLearningEvents: false,
  provenance: {
    origin: 'upload' as const,
    createdBy: 'user' as const,
    createdAt: now.toISOString(),
    sourceResourceIds: [],
    operationId: null,
    generator: null,
  },
  runtime: { kind: 'none' as const },
};

function service(): GatewayService {
  const runner: GatewayTurnRunnerPort = {
    async *run() {
      yield { type: 'operation.cancelled' };
    },
  };
  return new GatewayService(
    new InMemoryGatewayRouteResolver([]),
    new InMemoryGatewayOperationStore(new SequentialGatewayIdFactory()),
    runner,
    new Sha256GatewayRequestFingerprint(),
    () => now,
  );
}

async function start(canvasResources: {
  list: (input: {
    trustedSubjectId: string;
    notebookId: string;
  }) => Promise<readonly (typeof resource)[]>;
  get: (input: {
    trustedSubjectId: string;
    notebookId: string;
    resourceKind: 'source' | 'artifact';
    resourceId: string;
  }) => Promise<typeof resource>;
}) {
  const sessionAuth = new GatewayClientSessionAuth(
    'canvas-resource-access-secret-value',
    60,
    () => now,
  );
  const server = createServer(
    createGatewayHttpHandler({
      service: service(),
      internalToken: null,
      clientTransport: {
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
        canvasResources,
      },
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    token: sessionAuth.issue('user:1').token,
  };
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

describe('Gateway Client Canvas resource access', () => {
  it('derives the subject from the bearer session and forwards only Notebook selection', async () => {
    const list = vi.fn(async () => [resource]);
    const transport = await start({
      list,
      get: vi.fn(async () => resource),
    });
    const response = await fetch(
      `${transport.base}/v1/client/canvas-resources?notebookId=notebook%3A1`,
      { headers: { authorization: `Bearer ${transport.token}` } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ resources: [resource] });
    expect(list).toHaveBeenCalledWith({
      trustedSubjectId: 'user:1',
      notebookId: 'notebook:1',
    });
  });

  it('returns the same 404 shape for a cross-Notebook resource', async () => {
    const transport = await start({
      list: vi.fn(async () => []),
      get: vi.fn(async () => {
        throw new GatewayCanvasResourceError('resource_not_found', 404);
      }),
    });
    const response = await fetch(
      `${transport.base}/v1/client/canvas-resources/source/source:1?notebookId=notebook%3Aother`,
      { headers: { authorization: `Bearer ${transport.token}` } },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'resource_not_found' },
    });
  });
});
