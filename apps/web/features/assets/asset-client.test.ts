import { afterEach, describe, expect, it, vi } from 'vitest';
import { importLinkAsset, loadAssets } from './asset-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function canvasResourceFixture() {
  return {
    schemaVersion: 1,
    resourceId: 'asset-1',
    notebookId: 'notebook-1',
    resourceKind: 'source',
    title: '资料',
    status: 'ready',
    version: { versionId: 'version-1', sequence: null, checksum: null },
    representation: {
      kind: 'document',
      mimeType: 'application/pdf',
      byteSize: 1024,
    },
    renderer: { rendererId: 'source.pdf', rendererVersion: 1 },
    trustTier: 'tier1',
    allowedActions: ['view', 'download'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'upload',
      createdBy: 'user',
      createdAt: '2026-07-26T00:00:00.000Z',
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
  };
}

function assetWithResource(canvasResource: unknown) {
  return {
    descriptor: {
      assetId: 'asset-1',
      scope: 'space',
      kind: 'document',
      displayName: '资料',
      status: 'ready',
      currentVersionId: 'version-1',
    },
    version: null,
    canvasResource,
  };
}

describe('asset browser client', () => {
  it('validates listed asset response items before mapping UI state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          assets: [
            {
              descriptor: {
                assetId: 'asset-1',
                scope: 'space',
                kind: 'document',
                displayName: '资料',
                status: 'ready',
                currentVersionId: 'version-1',
              },
              version: null,
            },
          ],
        }),
      ),
    );

    await expect(
      loadAssets('/assets-fixture', { enableSpaceByDefault: true }),
    ).resolves.toEqual([
      {
        id: 'asset-1',
        versionId: 'version-1',
        label: '资料',
        kind: 'document',
        scope: 'space',
        status: 'ready',
        enabled: true,
        selectable: true,
        resource: null,
      },
    ]);
  });

  it('keeps a canvas resource that passes protocol validation', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({
            assets: [assetWithResource(canvasResourceFixture())],
          }),
        ),
    );

    const [asset] = await loadAssets('/assets-fixture');

    expect(asset?.resource?.allowedActions).toEqual(['view', 'download']);
  });

  it('drops a canvas resource that fails protocol validation', async () => {
    /* 服务端不该发出这种资源，但客户端绝不能因为字段"看起来像"就信任其中的
       allowedActions —— 校验失败必须退化为无动作，而不是保留半个对象。 */
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          assets: [
            assetWithResource({
              ...canvasResourceFixture(),
              allowedActions: ['view', 'view'],
            }),
          ],
        }),
      ),
    );

    const [asset] = await loadAssets('/assets-fixture');

    expect(asset?.resource).toBeNull();
  });

  it('rejects malformed mutation responses at the API client boundary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));

    await expect(
      importLinkAsset({ url: 'https://example.com', endpoint: '/link' }),
    ).rejects.toThrow('导入响应格式不正确。');
  });
});
