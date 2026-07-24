import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  GatewayPersistenceError,
  type GatewayPendingApprovalSnapshot,
} from '@educanvas/db';
import {
  GatewayService,
  InMemoryGatewayOperationStore,
  InMemoryGatewayRouteResolver,
  SequentialGatewayIdFactory,
  Sha256GatewayRequestFingerprint,
  type GatewayTurnRunnerPort,
} from '@educanvas/gateway-runtime';
import { afterEach, expect, it } from 'vitest';
import { GatewayClientSessionAuth } from '../client-auth';
import { createGatewayHttpHandler } from '../server';

const now = new Date('2026-07-24T06:00:00.000Z');
const servers: Server[] = [];

function createService(): GatewayService {
  const runner: GatewayTurnRunnerPort = {
    async *run() {
      yield {
        type: 'operation.failed',
        code: 'RUNTIME_FAILED',
        retryable: false,
      };
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

it('returns 403 when current membership denies an approval decision', async () => {
  const sessionAuth = new GatewayClientSessionAuth(
    'operation-access-test-secret-value',
    60,
    () => now,
  );
  const server = createServer(
    createGatewayHttpHandler({
      service: createService(),
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
          async listPending(): Promise<
            readonly GatewayPendingApprovalSnapshot[]
          > {
            return [];
          },
        },
        operations: {
          async listRecent() {
            return [];
          },
          async resolveApproval() {
            throw new GatewayPersistenceError(
              'forbidden',
              'Approval is unavailable after membership revocation',
            );
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
  const address = server.address() as AddressInfo;
  const session = sessionAuth.issue('user:1');

  const response = await fetch(
    `http://127.0.0.1:${address.port}/v1/client/approvals/access:approval/decision`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'approved' }),
    },
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: { code: 'FORBIDDEN' } });
});
