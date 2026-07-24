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
      },
    ]);
  });

  it('rejects malformed mutation responses at the API client boundary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));

    await expect(
      importLinkAsset({ url: 'https://example.com', endpoint: '/link' }),
    ).rejects.toThrow('导入响应格式不正确。');
  });
});
