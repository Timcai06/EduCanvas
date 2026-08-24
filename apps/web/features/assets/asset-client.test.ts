import { afterEach, describe, expect, it, vi } from 'vitest';
import { importLinkAsset, loadAssets } from './asset-client';
import { ResourceClientError } from '../canvas/resource-error';

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
        processing: null,
        enabled: true,
        selectable: true,
        resource: null,
      },
    ]);
  });

  it('accepts a ready video without invalidating the complete asset list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          assets: [
            {
              descriptor: {
                assetId: 'video-1',
                scope: 'space',
                kind: 'video',
                displayName: '课堂录像.mp4',
                status: 'ready',
                currentVersionId: 'video-version-1',
              },
              version: null,
            },
          ],
        }),
      ),
    );

    const [asset] = await loadAssets('/assets-fixture');

    expect(asset).toMatchObject({
      id: 'video-1',
      kind: 'video',
      selectable: true,
    });
  });

  it('keeps a canvas resource that passes protocol validation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          assets: [assetWithResource(canvasResourceFixture())],
        }),
      ),
    );

    const [asset] = await loadAssets('/assets-fixture');

    expect(asset?.resource?.allowedActions).toEqual(['view', 'download']);
  });

  it('lets the persisted binding win over the local default', async () => {
    /* enabled 决定下一轮真正带上哪些资料。服务端已按成员持久化，
       浏览器再算一次只会漂移——即使本地默认会算成 true 也必须服从 false。 */
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          assets: [{ ...assetWithResource(null), enabled: false }],
        }),
      ),
    );

    const [asset] = await loadAssets('/assets-fixture', {
      enableSpaceByDefault: true,
    });

    expect(asset?.enabled).toBe(false);
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

  it('keeps stable link error code and retryability without exposing unknown server text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'link_access_blocked',
              requestId: 'request-1',
            },
          },
          { status: 422 },
        ),
      ),
    );

    await expect(
      importLinkAsset({ url: 'https://example.com' }),
    ).rejects.toMatchObject({
      code: 'link_access_blocked',
      retryable: false,
      message: '网页拒绝访问或需要登录。请保存为 PDF 后上传。',
    });
  });

  it('maps a network failure to a retryable link error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    await expect(
      importLinkAsset({ url: 'https://example.com' }),
    ).rejects.toMatchObject({
      code: 'link_network_unreachable',
      retryable: true,
    });
  });

  it('uses local stable copy for fake_ip_dns_detected, not server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'fake_ip_dns_detected',
              requestId: 'request-2',
            },
          },
          { status: 422 },
        ),
      ),
    );

    await expect(
      importLinkAsset({ url: 'https://example.com' }),
    ).rejects.toMatchObject({
      code: 'fake_ip_dns_detected',
      retryable: false,
      message: '当前网络无法安全解析该网页。请直接打开原网页，或稍后重试导入。',
    });
  });
});

describe('loadAssets 错误分类（W03 六种语义）', () => {
  it('401/403 → forbidden（权限不足，不可重试）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })),
    );
    await expect(loadAssets('/assets')).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  it('404 → not_found（资源缺失，不可重试）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not found', { status: 404 })),
    );
    await expect(loadAssets('/assets')).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('503 → unavailable（服务不可用，可重试）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })),
    );
    await expect(loadAssets('/assets')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('500 → failed（其它服务端失败）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('boom', { status: 500 })),
    );
    await expect(loadAssets('/assets')).rejects.toMatchObject({
      kind: 'failed',
    });
  });

  it('网络层失败 → offline，且 instanceof ResourceClientError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    const error = await loadAssets('/assets').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ResourceClientError);
    expect((error as ResourceClientError).kind).toBe('offline');
  });

  it('AbortError 原样上抛，不误报为 offline', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));
    await expect(loadAssets('/assets')).rejects.toBe(abortError);
  });
});
