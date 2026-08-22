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
import type { AssetSnapshot } from '@educanvas/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayClientSessionAuth } from '../client-auth';
import { createGatewayHttpHandler } from '../server';
import {
  GatewayAssetUploadError,
  GatewayAssetUploadService,
} from '../asset-upload/asset-upload';

const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const assetId = `asset:${uuid}`;
const versionId = `version:${uuid}`;

function snapshot(status: 'ready' | 'processing'): AssetSnapshot {
  return {
    descriptor: {
      assetId,
      scope: 'space',
      kind: status === 'ready' ? 'image' : 'document',
      origin: 'upload',
      displayName: status === 'ready' ? '截图.png' : '笔记.pdf',
      mimeType: status === 'ready' ? 'image/png' : 'application/pdf',
      status,
      currentVersionId: status === 'ready' ? versionId : null,
    },
    version:
      status === 'ready'
        ? {
            assetId,
            versionId,
            kind: 'image',
            mimeType: 'image/png',
            byteSize: 4,
            contentHash: 'a'.repeat(64),
            status: 'ready',
          }
        : null,
    processing: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  };
}

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

async function start(
  assets: Pick<GatewayAssetUploadService, 'upload' | 'get'> | undefined,
) {
  const sessionAuth = new GatewayClientSessionAuth(
    'asset-routes-session-secret-value-32-bytes',
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
        assets,
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

function pngForm(): FormData {
  const form = new FormData();
  form.append(
    'file',
    new File(
      [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      '截图.png',
      { type: 'image/png' },
    ),
  );
  form.append('scope', 'space');
  return form;
}

describe('Gateway Client asset upload routes (DP10)', () => {
  it('uploads an image and returns the ready snapshot projection', async () => {
    const upload = vi.fn().mockResolvedValue(snapshot('ready'));
    const transport = await start({ upload, get: vi.fn() });

    const response = await fetch(
      `${transport.base}/v1/client/assets?notebookId=${uuid}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${transport.token}` },
        body: pngForm(),
      },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { descriptor: { assetId: string } };
    expect(body.descriptor.assetId).toBe(assetId);
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        trustedSubjectId: 'user:1',
        notebookId: uuid,
        scope: 'space',
      }),
    );
    const fileArg = upload.mock.calls[0]![0].file as File;
    expect(fileArg.name).toBe('截图.png');
  });

  it('routes a PDF upload through to the async pending path', async () => {
    const upload = vi.fn().mockResolvedValue(snapshot('processing'));
    const transport = await start({ upload, get: vi.fn() });

    const form = new FormData();
    form.append(
      'file',
      new File([new TextEncoder().encode('%PDF-1.7 fake')], '笔记.pdf', {
        type: 'application/pdf',
      }),
    );
    form.append('scope', 'space');
    const response = await fetch(
      `${transport.base}/v1/client/assets?notebookId=${uuid}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${transport.token}` },
        body: form,
      },
    );

    expect(response.status).toBe(201);
    expect(
      (await response.json()) as { descriptor: { status: string } },
    ).toMatchObject({
      descriptor: { status: 'processing' },
    });
  });

  it('rejects malformed multipart and missing notebook ids with 400', async () => {
    const upload = vi.fn();
    const transport = await start({ upload, get: vi.fn() });

    const badNotebook = await fetch(`${transport.base}/v1/client/assets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${transport.token}` },
      body: pngForm(),
    });
    expect(badNotebook.status).toBe(400);

    const form = new FormData();
    form.append('scope', 'space');
    const missingFile = await fetch(
      `${transport.base}/v1/client/assets?notebookId=${uuid}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${transport.token}` },
        body: form,
      },
    );
    expect(missingFile.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it('maps service upload errors to their HTTP status and code', async () => {
    const upload = vi
      .fn()
      .mockRejectedValue(new GatewayAssetUploadError(413, 'FILE_TOO_LARGE'));
    const transport = await start({ upload, get: vi.fn() });

    const response = await fetch(
      `${transport.base}/v1/client/assets?notebookId=${uuid}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${transport.token}` },
        body: pngForm(),
      },
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: 'FILE_TOO_LARGE' },
    });
  });

  it('returns 503 when the asset transport is disabled', async () => {
    const transport = await start(undefined);
    const response = await fetch(
      `${transport.base}/v1/client/assets?notebookId=${uuid}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${transport.token}` },
        body: pngForm(),
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'CLIENT_TRANSPORT_DISABLED' },
    });
  });

  it('polls an owned asset snapshot through GET', async () => {
    const get = vi.fn().mockResolvedValue(snapshot('ready'));
    const transport = await start({ upload: vi.fn(), get });

    const response = await fetch(
      `${transport.base}/v1/client/assets/${assetId}?notebookId=${uuid}`,
      { headers: { authorization: `Bearer ${transport.token}` } },
    );
    expect(response.status).toBe(200);
    expect(
      (await response.json()) as { descriptor: { status: string } },
    ).toMatchObject({
      descriptor: { status: 'ready', assetId },
    });
    expect(get).toHaveBeenCalledWith({
      trustedSubjectId: 'user:1',
      notebookId: uuid,
      assetId,
    });
  });

  it('maps an unowned GET to NOT_FOUND', async () => {
    const get = vi
      .fn()
      .mockRejectedValue(new GatewayAssetUploadError(404, 'NOT_FOUND'));
    const transport = await start({ upload: vi.fn(), get });

    const response = await fetch(
      `${transport.base}/v1/client/assets/${assetId}?notebookId=${uuid}`,
      { headers: { authorization: `Bearer ${transport.token}` } },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });
});
