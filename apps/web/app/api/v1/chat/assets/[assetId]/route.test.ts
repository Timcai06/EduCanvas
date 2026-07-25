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
      readonly code: string,
      readonly status: number,
    ) {
      super(code);
    }
  },
  loadOwnedAssetPreview: vi.fn(),
  readOwnedAssetPreviewFile: vi.fn(),
  tombstoneOwnedAsset: vi.fn(),
}));

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  loadOwnedAssetPreview,
  readOwnedAssetPreviewFile,
  tombstoneOwnedAsset,
} from '@/server/assets/asset-preview';
import { GET as GET_FILE } from './file/route';
import { GET as GET_PREVIEW } from './preview/route';
import { DELETE } from './route';

const assetId = '11111111-1111-4111-8111-111111111111';
const identity = {
  token: 'token',
  studentId: `anon:v1:${'a'.repeat(64)}`,
};
const conversation = { id: 'conversation-1', spaceId: 'space-1' };
const params = (value = assetId) => ({
  params: Promise.resolve({ assetId: value }),
});

describe('owned source preview routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(
      conversation as never,
    );
  });

  it('rejects invalid ids before repository access', async () => {
    const response = await GET_PREVIEW(
      new Request('http://localhost/preview'),
      params('not-uuid'),
    );

    expect(response.status).toBe(404);
    expect(loadOwnedAssetPreview).not.toHaveBeenCalled();
  });

  it('returns only the bounded public preview contract', async () => {
    vi.mocked(loadOwnedAssetPreview).mockResolvedValue({
      kind: 'markdown',
      fileName: 'notes.md',
      mimeType: 'text/markdown',
      content: '# Notes',
    });
    const response = await GET_PREVIEW(
      new Request('http://localhost/preview'),
      params(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preview: {
        kind: 'markdown',
        fileName: 'notes.md',
        mimeType: 'text/markdown',
        content: '# Notes',
      },
    });
  });

  it('serves owned binary inline with private nosniff headers', async () => {
    vi.mocked(readOwnedAssetPreviewFile).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
      fileName: 'lesson.pdf',
    });
    const response = await GET_FILE(
      new Request('http://localhost/file'),
      params(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toContain('inline');
  });

  it('requires same-origin writes before soft delete', async () => {
    const rejected = await DELETE(
      new Request(`https://app.example/assets/${assetId}`, {
        method: 'DELETE',
        headers: { origin: 'https://evil.example' },
      }),
      params(),
    );
    expect(rejected.status).toBe(403);
    expect(tombstoneOwnedAsset).not.toHaveBeenCalled();

    const accepted = await DELETE(
      new Request(`http://localhost/assets/${assetId}`, {
        method: 'DELETE',
        headers: { origin: 'http://localhost' },
      }),
      params(),
    );
    expect(accepted.status).toBe(204);
    expect(tombstoneOwnedAsset).toHaveBeenCalledWith({
      identity,
      spaceId: conversation.spaceId,
      assetId,
    });
  });
});
