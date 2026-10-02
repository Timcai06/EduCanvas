import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  owned: vi.fn(),
  legacy: vi.fn(),
  preview: vi.fn(),
  download: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./general-conversation', () => ({
  loadOwnedGeneralConversation: mocks.legacy,
  loadOwnedGeneralConversationForSubject: mocks.legacy,
}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: async () => ({ studentId: 'user:owner', token: '' }),
}));
vi.mock('@educanvas/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@educanvas/db')>()),
  DrizzlePlatformConversationRepository: class {
    getOwned = mocks.owned;
  },
}));
vi.mock('@/server/assets/asset-preview', () => ({
  AssetPreviewError: class extends Error {},
  loadOwnedAssetPreviewDetail: mocks.preview,
  readOwnedAssetPreviewFile: mocks.download,
  readOwnedAssetDownload: mocks.download,
}));
vi.mock('@/server/canvas/resource-access', () => ({
  CanvasResourceAccessError: class extends Error {},
  loadOwnedCanvasResource: async () => ({ allowedActions: ['download'] }),
}));

import { GET as assetPreview } from '@/app/api/v1/chat/assets/[assetId]/preview/route';
import { GET as assetFile } from '@/app/api/v1/chat/assets/[assetId]/file/route';
import { GET as artifactImage } from '@/app/api/v1/chat/artifacts/[artifactId]/image/route';
import { GET as artifactAudio } from '@/app/api/v1/chat/artifacts/[artifactId]/audio/route';
import { GET as artifactDownload } from '@/app/api/v1/chat/artifacts/[artifactId]/download/route';
import { GET as picturebookPage } from '@/app/api/v1/chat/artifacts/[artifactId]/picturebook/pages/[page]/route';
import { POST as runtimeRun } from '@/app/api/v1/canvas/runtime/runs/route';

const notebookA = '11111111-1111-4111-8111-111111111111';
const notebookB = '22222222-2222-4222-8222-222222222222';
const conversationA = '33333333-3333-4333-8333-333333333333';
const resourceId = '44444444-4444-4444-8444-444444444444';
const assetParams = { params: Promise.resolve({ assetId: resourceId }) };
const artifactParams = { params: Promise.resolve({ artifactId: resourceId }) };
const query = `requestNotebookId=${notebookA}&requestConversationId=${conversationA}`;
function request(path: string, scope = query, method = 'GET') {
  return new Request(`https://app.test${path}?${scope}`, {
    method,
    headers: { origin: 'https://app.test' },
  });
}

describe('native resources use validated request scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.legacy.mockResolvedValue({
      id: conversationA,
      spaceId: notebookB,
      agentProfileId: 'general',
    });
    mocks.owned.mockResolvedValue({
      id: conversationA,
      spaceId: notebookB,
      agentProfileId: 'general',
    });
  });

  it.each([
    [
      'asset preview',
      () =>
        assetPreview(request('/api/v1/chat/assets/asset/preview'), assetParams),
    ],
    [
      'asset file/download',
      () =>
        assetFile(
          request('/api/v1/chat/assets/asset/file', `${query}&download=1`),
          assetParams,
        ),
    ],
    [
      'generated image',
      () =>
        artifactImage(
          request('/api/v1/chat/artifacts/artifact/image'),
          artifactParams,
        ),
    ],
    [
      'audio',
      () =>
        artifactAudio(
          request('/api/v1/chat/artifacts/artifact/audio'),
          artifactParams,
        ),
    ],
    [
      'artifact download',
      () =>
        artifactDownload(
          request('/api/v1/chat/artifacts/artifact/download'),
          artifactParams,
        ),
    ],
    [
      'picturebook page',
      () =>
        picturebookPage(
          request(
            '/api/v1/chat/artifacts/artifact/picturebook/pages/1',
            `${query}&version=1`,
          ),
          { params: Promise.resolve({ artifactId: resourceId, page: '1' }) },
        ),
    ],
    [
      'runtime admission',
      () => runtimeRun(request('/api/v1/canvas/runtime/runs', query, 'POST')),
    ],
  ] as const)(
    'returns 404 for forged cross-Notebook context before reading %s',
    async (_label, read) => {
      expect((await read()).status).toBe(404);
      expect(mocks.legacy).not.toHaveBeenCalled();
      expect(mocks.download).not.toHaveBeenCalled();
      expect(mocks.preview).not.toHaveBeenCalled();
    },
  );

  it('fails closed for a malformed native file context and preserves legacy anonymous/authenticated behavior', async () => {
    expect(
      (
        await assetFile(
          request('/api/v1/chat/assets/asset/file', 'requestNotebookId=broken'),
          assetParams,
        )
      ).status,
    ).toBe(404);
    expect(mocks.owned).not.toHaveBeenCalled();
    mocks.download.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
      fileName: 'image.png',
    });
    expect(
      (
        await assetFile(
          new Request('https://app.test/api/v1/chat/assets/asset/file'),
          assetParams,
        )
      ).status,
    ).toBe(200);
    expect(mocks.legacy).toHaveBeenCalledTimes(1);
  });

  it('reads a legal old-course native download from A even when the Cookie cursor points to B', async () => {
    mocks.owned.mockResolvedValue({
      id: conversationA,
      spaceId: notebookA,
      agentProfileId: 'k12.teacher',
    });
    mocks.download.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mimeType: 'application/pdf',
      fileName: 'lesson.pdf',
    });
    const response = await assetFile(
      request('/api/v1/chat/assets/asset/file', `${query}&download=1`),
      assetParams,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: notebookA }),
    );
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
});
