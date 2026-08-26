import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  conversation: vi.fn(),
  getArtifact: vi.fn(),
  getVersion: vi.fn(),
  loadBundle: vi.fn(),
  readPage: vi.fn(),
}));

vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: mocks.identity,
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: mocks.conversation,
}));
vi.mock('@/server/canvas/picturebook-bundle', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/server/canvas/picturebook-bundle')>();
  return {
    ...actual,
    loadPicturebookBundle: mocks.loadBundle,
    readPicturebookPage: mocks.readPage,
  };
});
vi.mock('@educanvas/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@educanvas/db')>();
  return {
    ...actual,
    DrizzlePlatformArtifactRepository: vi.fn(function () {
      return {
        getArtifact: mocks.getArtifact,
        getVersion: mocks.getVersion,
      };
    }),
  };
});

import { GET } from './route';

const artifactId = '11111111-1111-4111-8111-111111111111';
const request = () =>
  new Request(
    `http://localhost/api/v1/chat/artifacts/${artifactId}/picturebook/pages/1?version=2`,
  );

describe('GET picturebook page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue({ studentId: 'student-1' });
    mocks.conversation.mockResolvedValue({ spaceId: 'notebook-1' });
    mocks.getArtifact.mockResolvedValue({
      id: artifactId,
      spaceId: 'notebook-1',
      status: 'active',
      kind: 'picturebook',
    });
    mocks.getVersion.mockResolvedValue({
      objectKey: 'artifacts/private/picturebook.json',
      checksum: 'a'.repeat(64),
    });
    mocks.loadBundle.mockResolvedValue({ pages: [{}] });
    mocks.readPage.mockReturnValue({
      bytes: new Uint8Array([137, 80, 78, 71]),
      contentType: 'image/png',
    });
  });

  it('按不可变版本读取当前 Notebook 的指定页', async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId, page: '1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mocks.getVersion).toHaveBeenCalledWith({
      artifactId,
      version: 2,
      trustedSubjectId: 'student-1',
    });
    expect(mocks.loadBundle).toHaveBeenCalledWith({
      objectKey: 'artifacts/private/picturebook.json',
      checksum: 'a'.repeat(64),
    });
  });

  it('拒绝缺少版本、越界页码和其他 Notebook', async () => {
    const missingVersion = await GET(
      new Request(
        `http://localhost/api/v1/chat/artifacts/${artifactId}/picturebook/pages/1`,
      ),
      { params: Promise.resolve({ artifactId, page: '1' }) },
    );
    expect(missingVersion.status).toBe(404);

    const invalidPage = await GET(request(), {
      params: Promise.resolve({ artifactId, page: '9' }),
    });
    expect(invalidPage.status).toBe(404);

    const missingBundlePage = await GET(request(), {
      params: Promise.resolve({ artifactId, page: '2' }),
    });
    expect(missingBundlePage.status).toBe(404);
    expect(mocks.readPage).not.toHaveBeenCalled();
    mocks.loadBundle.mockClear();

    mocks.getArtifact.mockResolvedValueOnce({
      id: artifactId,
      spaceId: 'other-notebook',
      status: 'active',
      kind: 'picturebook',
    });
    const wrongNotebook = await GET(request(), {
      params: Promise.resolve({ artifactId, page: '1' }),
    });
    expect(wrongNotebook.status).toBe(404);
    expect(mocks.loadBundle).not.toHaveBeenCalled();
  });
});
