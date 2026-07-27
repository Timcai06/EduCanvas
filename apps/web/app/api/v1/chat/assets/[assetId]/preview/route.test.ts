import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetPreviewError } from '@/server/assets/asset-preview';

vi.mock('server-only', () => ({}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: vi.fn(),
}));
vi.mock('@/server/assets/asset-preview', async () => {
  const actual = await vi.importActual<
    typeof import('@/server/assets/asset-preview')
  >('@/server/assets/asset-preview');
  return {
    ...actual,
    loadOwnedAssetPreviewDetail: vi.fn(),
  };
});

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { loadOwnedAssetPreviewDetail } from '@/server/assets/asset-preview';
import { GET } from './route';

const assetId = '10000000-0000-4000-8000-000000000001';
const identity = { token: 'token', studentId: 'owner-1' };
const conversation = {
  id: 'conversation-1',
  spaceId: '20000000-0000-4000-8000-000000000002',
};

describe('GET /api/v1/chat/assets/[assetId]/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(
      conversation as never,
    );
    vi.mocked(loadOwnedAssetPreviewDetail).mockResolvedValue({
      preview: {
        kind: 'pdf',
        fileName: '教材.pdf',
        mimeType: 'application/pdf',
        fileUrl: `/api/v1/chat/assets/${assetId}/file`,
      },
      canvasResource: {
        schemaVersion: 1,
        resourceId: assetId,
        notebookId: conversation.spaceId,
        resourceKind: 'source',
        title: '教材.pdf',
        status: 'ready',
        version: {
          versionId: '30000000-0000-4000-8000-000000000003',
          sequence: null,
          checksum: 'a'.repeat(64),
        },
        representation: {
          kind: 'document',
          mimeType: 'application/pdf',
          byteSize: 100,
        },
        renderer: { rendererId: 'source.pdf', rendererVersion: 1 },
        trustTier: 'tier1',
        allowedActions: ['view', 'download', 'delete'],
        canProduceCandidateLearningEvents: false,
        provenance: {
          origin: 'upload',
          createdBy: 'user',
          createdAt: '2026-07-25T00:00:00.000Z',
          sourceResourceIds: [],
          operationId: null,
          generator: null,
        },
        runtime: { kind: 'none' },
      },
    });
  });

  it('adds CanvasResource after passing trusted user and Notebook scope', async () => {
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ assetId }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(loadOwnedAssetPreviewDetail).toHaveBeenCalledWith({
      identity,
      spaceId: conversation.spaceId,
      assetId,
    });
    expect(payload).toMatchObject({
      preview: { kind: 'pdf' },
      canvasResource: {
        resourceId: assetId,
        version: { sequence: null },
      },
    });
  });

  it('maps cross-user, cross-Notebook and missing lookups to one 404', async () => {
    vi.mocked(loadOwnedAssetPreviewDetail).mockRejectedValue(
      new AssetPreviewError('asset_not_found', 404),
    );
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ assetId }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'asset_not_found' },
    });
  });
});
