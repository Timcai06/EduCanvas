import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: vi.fn(),
}));
vi.mock('@/server/assets/asset-preview', () => ({
  AssetPreviewError: class AssetPreviewError extends Error {
    constructor(
      readonly code: 'asset_not_found' | 'preview_unavailable',
      readonly status: 404 | 422,
    ) {
      super(code);
    }
  },
  readOwnedAssetDownload: vi.fn(),
  readOwnedAssetPreviewFile: vi.fn(),
}));
vi.mock('@/server/canvas/resource-access', () => ({
  CanvasResourceAccessError: class CanvasResourceAccessError extends Error {},
  loadOwnedCanvasResource: vi.fn(),
}));

import {
  AssetPreviewError,
  readOwnedAssetDownload,
  readOwnedAssetPreviewFile,
} from '@/server/assets/asset-preview';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { loadOwnedCanvasResource } from '@/server/canvas/resource-access';
import { GET } from './route';

const assetId = '10000000-0000-4000-8000-000000000001';
const identity = { token: 'token', studentId: 'owner-1' };
const conversation = {
  id: 'conversation-1',
  spaceId: '20000000-0000-4000-8000-000000000002',
};

describe('GET /api/v1/chat/assets/[assetId]/file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(
      conversation as never,
    );
    vi.mocked(readOwnedAssetPreviewFile).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
      fileName: '教材.pdf',
    });
    vi.mocked(readOwnedAssetDownload).mockResolvedValue({
      bytes: new Uint8Array([9, 8, 7]),
      mimeType: 'application/pdf',
      fileName: '教材.pdf',
    });
    vi.mocked(loadOwnedCanvasResource).mockResolvedValue({
      allowedActions: ['view', 'download'],
    } as never);
  });

  it('无 download 参数时走内联预览（inline + nosniff）', async () => {
    const response = await GET(
      new Request(`http://localhost/api/v1/chat/assets/${assetId}/file`),
      { params: Promise.resolve({ assetId }) },
    );

    expect(response.status).toBe(200);
    expect(readOwnedAssetDownload).not.toHaveBeenCalled();
    expect(readOwnedAssetPreviewFile).toHaveBeenCalledWith({
      identity,
      spaceId: conversation.spaceId,
      assetId,
    });
    expect(response.headers.get('content-disposition')).toContain('inline');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('download=1 走原件下载（attachment + 原始文件名）', async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/v1/chat/assets/${assetId}/file?download=1`,
      ),
      { params: Promise.resolve({ assetId }) },
    );

    expect(response.status).toBe(200);
    expect(readOwnedAssetDownload).toHaveBeenCalledWith({
      identity,
      spaceId: conversation.spaceId,
      assetId,
    });
    expect(loadOwnedCanvasResource).toHaveBeenCalledWith({
      identity,
      notebookId: conversation.spaceId,
      resourceKind: 'source',
      resourceId: assetId,
    });
    expect(readOwnedAssetPreviewFile).not.toHaveBeenCalled();
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('filename*=UTF-8');
  });

  it('直接拼接 download=1 仍按 fresh CanvasResource 动作拒绝', async () => {
    vi.mocked(loadOwnedCanvasResource).mockResolvedValue({
      allowedActions: ['view'],
    } as never);

    const response = await GET(
      new Request(
        `http://localhost/api/v1/chat/assets/${assetId}/file?download=1`,
      ),
      { params: Promise.resolve({ assetId }) },
    );

    expect(response.status).toBe(403);
    expect(readOwnedAssetDownload).not.toHaveBeenCalled();
  });

  it('其他 download 值按内联预览处理，不切换到下载路径', async () => {
    await GET(
      new Request(
        `http://localhost/api/v1/chat/assets/${assetId}/file?download=yes`,
      ),
      { params: Promise.resolve({ assetId }) },
    );

    expect(readOwnedAssetDownload).not.toHaveBeenCalled();
  });

  it('未登录返回 401', async () => {
    vi.mocked(readAnonymousIdentity).mockResolvedValue(null);

    const response = await GET(
      new Request(`http://localhost/api/v1/chat/assets/${assetId}/file`),
      { params: Promise.resolve({ assetId }) },
    );

    expect(response.status).toBe(401);
  });

  it('来源不存在统一按 404', async () => {
    vi.mocked(readOwnedAssetPreviewFile).mockRejectedValue(
      new AssetPreviewError('asset_not_found', 404),
    );

    const response = await GET(
      new Request(`http://localhost/api/v1/chat/assets/${assetId}/file`),
      { params: Promise.resolve({ assetId }) },
    );

    expect(response.status).toBe(404);
  });
});
