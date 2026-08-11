import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: vi.fn(),
}));
vi.mock('@/server/assets/asset-derived-resources', () => ({
  AssetResourceError: class AssetResourceError extends Error {
    constructor(
      readonly code: 'resource_not_found' | 'resource_unavailable',
      readonly status: 404 | 503,
    ) {
      super(code);
    }
  },
  readOwnedAssetResource: vi.fn(),
}));

import {
  AssetResourceError,
  readOwnedAssetResource,
} from '@/server/assets/asset-derived-resources';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { GET } from './route';

const assetId = '10000000-0000-4000-8000-000000000001';
const identity = { token: 'token', studentId: 'owner-1' };
const conversation = {
  id: 'conversation-1',
  spaceId: '20000000-0000-4000-8000-000000000002',
};

function request(resource: string[]): Request {
  return new Request(
    `http://localhost/api/v1/chat/assets/${assetId}/resources/${resource.join('/')}`,
  );
}

describe('GET /api/v1/chat/assets/[assetId]/resources/[...resource]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(
      conversation as never,
    );
    vi.mocked(readOwnedAssetResource).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
    });
  });

  it('身份与会话通过后按 manifest 路径返回资源', async () => {
    const response = await GET(request(['images', '001.jpg']), {
      params: Promise.resolve({ assetId, resource: ['images', '001.jpg'] }),
    });

    expect(response.status).toBe(200);
    expect(readOwnedAssetResource).toHaveBeenCalledWith({
      identity,
      spaceId: conversation.spaceId,
      assetId,
      resourcePath: 'images/001.jpg',
    });
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from([1, 2, 3]),
    );
  });

  it('未登录返回 401', async () => {
    vi.mocked(readAnonymousIdentity).mockResolvedValue(null);

    const response = await GET(request(['index.md']), {
      params: Promise.resolve({ assetId, resource: ['index.md'] }),
    });

    expect(response.status).toBe(401);
  });

  it('无会话返回 401', async () => {
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(null);

    const response = await GET(request(['index.md']), {
      params: Promise.resolve({ assetId, resource: ['index.md'] }),
    });

    expect(response.status).toBe(401);
  });

  it('assetId 非 UUID 或 resource 为空按 404，不触碰业务逻辑', async () => {
    const badAsset = await GET(request(['index.md']), {
      params: Promise.resolve({
        assetId: 'not-a-uuid',
        resource: ['index.md'],
      }),
    });
    const emptyResource = await GET(request([]), {
      params: Promise.resolve({ assetId, resource: [] }),
    });

    expect(badAsset.status).toBe(404);
    expect(emptyResource.status).toBe(404);
    expect(readAnonymousIdentity).not.toHaveBeenCalled();
  });

  it('资源不存在（404）映射为统一错误体', async () => {
    vi.mocked(readOwnedAssetResource).mockRejectedValue(
      new AssetResourceError('resource_not_found', 404),
    );

    const response = await GET(request(['index.md']), {
      params: Promise.resolve({ assetId, resource: ['index.md'] }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'resource_not_found' },
    });
  });

  it('布局异常（503）映射为统一错误体', async () => {
    vi.mocked(readOwnedAssetResource).mockRejectedValue(
      new AssetResourceError('resource_unavailable', 503),
    );

    const response = await GET(request(['index.md']), {
      params: Promise.resolve({ assetId, resource: ['index.md'] }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'resource_unavailable' },
    });
  });

  it('未知错误兜底 503，不泄露内部细节', async () => {
    vi.mocked(readOwnedAssetResource).mockRejectedValue(
      new Error('内部路径细节'),
    );

    const response = await GET(request(['index.md']), {
      params: Promise.resolve({ assetId, resource: ['index.md'] }),
    });

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain('内部路径细节');
  });
});
