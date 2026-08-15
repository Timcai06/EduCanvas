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
import { createGatewayHttpHandler } from '../server';

type ImagePreviewReader = (input: {
  conversationId: string;
  trustedSubjectId: string;
  assetId: string;
  assetVersionId: string;
}) => Promise<{ mimeType: string; bytes: Buffer }>;

const servers: Server[] = [];

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
  );
}

async function start(read: ImagePreviewReader) {
  const sessionAuth = new GatewayClientSessionAuth(
    'image-preview-session-secret-value-32-bytes',
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
        directory: {},
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
          async issue() {
            return { expiresAt: new Date().toISOString() };
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
        imagePreviews: { read },
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

describe('Gateway Client image preview', () => {
  it('reads a bounded preview only through the bearer subject and conversation', async () => {
    const read = vi.fn<ImagePreviewReader>().mockResolvedValue({
      mimeType: 'image/png',
      bytes: Buffer.from([137, 80, 78, 71]),
    });
    const transport = await start(read);

    const response = await fetch(
      `${transport.base}/v1/client/conversations/conversation%3Aone/assets/asset%3Aone/versions/version%3Aone/image-preview`,
      { headers: { authorization: `Bearer ${transport.token}` } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from([137, 80, 78, 71]),
    );
    expect(read).toHaveBeenCalledWith({
      conversationId: 'conversation:one',
      trustedSubjectId: 'user:1',
      assetId: 'asset:one',
      assetVersionId: 'version:one',
    });
  });
});
