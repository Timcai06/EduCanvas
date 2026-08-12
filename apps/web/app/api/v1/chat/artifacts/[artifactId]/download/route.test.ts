import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const artifactRepo = {
  getArtifactDetail: vi.fn(),
  getVersion: vi.fn(),
};
const objectStorage = {
  readVerified: vi.fn(),
};
const { requireNotebookAccessMock } = vi.hoisted(() => ({
  requireNotebookAccessMock: vi.fn(),
}));

vi.mock('@educanvas/db', async () => {
  const actual =
    await vi.importActual<typeof import('@educanvas/db')>('@educanvas/db');
  return {
    ...actual,
    DrizzlePlatformArtifactRepository: vi.fn(function () {
      return artifactRepo;
    }),
    requireNotebookAccess: requireNotebookAccessMock,
  };
});
vi.mock('@educanvas/db/internal', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('@educanvas/agent-runtime', async () => {
  const actual = await vi.importActual<
    typeof import('@educanvas/agent-runtime')
  >('@educanvas/agent-runtime');
  return {
    ...actual,
    LocalObjectStorage: vi.fn(function () {
      return objectStorage;
    }),
  };
});

vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: vi.fn(),
}));

import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { ArtifactOwnershipError } from '@educanvas/db';
import { ObjectStorageError } from '@educanvas/agent-core';
import { GET } from './route';

const identity = {
  token: 'token',
  studentId: `anon:v1:${'d'.repeat(64)}`,
};
const conversation = { id: 'conversation-1', spaceId: 'space-1' };
const artifactId = '11111111-1111-4111-8111-111111111111';

const imageDetail = {
  artifact: {
    id: artifactId,
    kind: 'generated_image',
    spaceId: conversation.spaceId,
    title: '测试图片',
  },
  latestVersion: {
    version: 1,
    content: null,
    objectKey: 'artifacts/private/image.png',
    checksum: 'a'.repeat(64),
    metadata: {
      contentVersion: 1,
      contentType: 'image/png',
      byteSize: 4,
      size: '1024x1024',
      image: {
        provider: 'openai-compatible',
        resolvedModelId: 'image-v1',
        latencyMs: 120,
      },
    },
  },
  latestJob: null,
};

const audioDetail = {
  artifact: {
    id: artifactId,
    kind: 'audio_overview',
    spaceId: conversation.spaceId,
    title: '测试音频',
  },
  latestVersion: {
    version: 1,
    content: null,
    objectKey: 'artifacts/private/audio.mp3',
    checksum: 'b'.repeat(64),
    metadata: {
      contentVersion: 1,
      contentType: 'audio/mpeg',
      byteSize: 8,
      transcript: '这是一段测试文字稿。',
      sourceCount: 2,
      script: {
        generator: 'rule:audio-overview-v1',
        provider: null,
        resolvedModelId: null,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      },
      speech: {
        provider: 'test-speech',
        resolvedModelId: 'tts-v1',
        voice: 'alloy',
        inputCharacters: 10,
        latencyMs: 50,
      },
    },
  },
  latestJob: null,
};

const markdownDetail = {
  artifact: {
    id: artifactId,
    kind: 'markdown_document',
    spaceId: conversation.spaceId,
    title: '课程文档',
  },
  latestVersion: {
    version: 2,
    content: {
      contentVersion: 1,
      markdown: '# 标题\n\n正文',
      generatedByModel: true,
    },
    objectKey: null,
    checksum: null,
    metadata: null,
  },
  latestJob: null,
};

const mindMapDetail = {
  artifact: {
    id: artifactId,
    kind: 'mind_map',
    spaceId: conversation.spaceId,
    title: '课程导图',
  },
  latestVersion: {
    version: 1,
    content: {
      contentVersion: 2,
      rootNodeId: 'n_root',
      nodes: [{ id: 'n_root', label: '根节点' }],
      edges: [],
    },
    objectKey: null,
    checksum: null,
    metadata: null,
  },
  latestJob: null,
};

const webAppDetail = {
  artifact: {
    id: artifactId,
    kind: 'web_app',
    spaceId: conversation.spaceId,
    title: '小程序',
  },
  latestVersion: {
    version: 1,
    content: {
      schemaVersion: 1,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: 'text/html',
            content: '<!doctype html><html><body>ok</body></html>',
            hash: 'f'.repeat(64),
          },
        ],
      },
      lockedDependencies: [],
      capabilities: ['javascript-runtime'],
      budget: {
        maxInputBytes: 2000,
        maxMessageBytes: 2000,
        maxOutputBytes: 2000,
        maxDurationMs: 1000,
        maxConcurrentInstances: 2,
        maxQueueDepth: 8,
        maxMessagesPerSecond: 10,
      },
      diagnostics: [],
      sourceConversationId: '22222222-2222-4222-8222-222222222222',
      generatedByModel: false,
    },
    objectKey: null,
    checksum: null,
    metadata: null,
  },
  latestJob: null,
};

function request(artId = artifactId, version?: number): Request {
  const query = version ? `?version=${version}` : '';
  return new Request(
    `http://localhost/api/v1/chat/artifacts/${artId}/download${query}`,
    { method: 'GET', headers: { origin: 'http://localhost' } },
  );
}

describe('GET /api/v1/chat/artifacts/[artifactId]/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(
      conversation as unknown as never,
    );
    requireNotebookAccessMock.mockResolvedValue({
      notebookId: conversation.spaceId,
      role: 'owner',
      permissions: ['notebook.read', 'notebook.write'],
    });
    artifactRepo.getArtifactDetail.mockReset();
    objectStorage.readVerified.mockReset();
    artifactRepo.getArtifactDetail.mockResolvedValue(imageDetail);
    artifactRepo.getVersion.mockResolvedValue(imageDetail.latestVersion);
    objectStorage.readVerified.mockResolvedValue(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it('returns 404 for invalid artifact ids', async () => {
    const response = await GET(
      new Request('http://localhost/api/v1/chat/artifacts/not-uuid/download'),
      { params: Promise.resolve({ artifactId: 'not-uuid' }) },
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('returns 401 when identity or conversation is unavailable', async () => {
    vi.mocked(readAnonymousIdentity).mockResolvedValueOnce(null);
    const r1 = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(r1.status).toBe(401);

    vi.mocked(loadOwnedGeneralConversation).mockResolvedValueOnce(
      null as never,
    );
    const r2 = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(r2.status).toBe(401);
    expect(objectStorage.readVerified).not.toHaveBeenCalled();
  });

  it('returns 404 when artifact belongs to another Notebook', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...imageDetail,
      artifact: { ...imageDetail.artifact, spaceId: 'another-space' },
    });
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.status).toBe(404);
    expect(objectStorage.readVerified).not.toHaveBeenCalled();
  });

  it('returns 404 for viewer without notebook.read', async () => {
    requireNotebookAccessMock.mockResolvedValueOnce(null);
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.status).toBe(404);
  });

  it('serves image download with Content-Disposition attachment', async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    const bytes = await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="download.png"',
    );
    expect(new Uint8Array(bytes).byteLength).toBe(4);
  });

  it('uses explicit version when provided and falls back to latest when absent', async () => {
    const v1 = {
      ...imageDetail.latestVersion,
      version: 1,
    };
    artifactRepo.getVersion.mockResolvedValueOnce(v1);

    const withVersion = await GET(request(artifactId, 1), {
      params: Promise.resolve({ artifactId }),
    });
    expect(withVersion.status).toBe(200);
    expect(artifactRepo.getVersion).toHaveBeenCalledWith({
      artifactId,
      version: 1,
      trustedSubjectId: identity.studentId,
    });

    artifactRepo.getVersion.mockClear();
    await GET(request(artifactId), {
      params: Promise.resolve({ artifactId }),
    });
    expect(artifactRepo.getVersion).not.toHaveBeenCalled();
  });

  it('returns 404 for invalid version query', async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/v1/chat/artifacts/${artifactId}/download?version=bad`,
        { method: 'GET', headers: { origin: 'http://localhost' } },
      ),
      { params: Promise.resolve({ artifactId }) },
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('serves audio download with correct extension', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce(audioDetail);
    objectStorage.readVerified.mockResolvedValueOnce(
      new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]),
    );

    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="download.mp3"',
    );
  });

  it('allows viewer to download', async () => {
    requireNotebookAccessMock.mockResolvedValueOnce({
      notebookId: conversation.spaceId,
      role: 'viewer',
      permissions: ['notebook.read'],
    });
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.status).toBe(200);
  });

  it('returns markdown file for markdown_document kind', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce(markdownDetail);
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="download.md"',
    );
    expect(text).toBe('# 标题\n\n正文');
  });

  it('returns 404 for invalid markdown schema', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...markdownDetail,
      latestVersion: {
        ...markdownDetail.latestVersion,
        content: {
          ...markdownDetail.latestVersion.content,
          generatedByModel: undefined,
        },
      },
    });
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('returns json for mind_map kind with strict schema validation', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce(mindMapDetail);
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    );
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="download.json"',
    );
    expect(body).toMatchObject({
      contentVersion: 2,
      rootNodeId: 'n_root',
      nodes: [{ id: 'n_root', label: '根节点' }],
      edges: [],
    });
  });

  it('returns 404 for invalid mind_map schema', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...mindMapDetail,
      latestVersion: {
        ...mindMapDetail.latestVersion,
        content: {
          ...mindMapDetail.latestVersion.content,
          rootNodeId: 'missing',
        },
      },
    });
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('returns json for web_app kind with strict schema validation', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce(webAppDetail);
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    );
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="download.json"',
    );
    expect(body).toMatchObject({
      schemaVersion: 1,
      manifest: { entry: 'index.html', files: [{ path: 'index.html' }] },
    });
    expect(body).not.toHaveProperty('sourceConversationId');
  });

  it('returns 404 for invalid web_app schema', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...webAppDetail,
      latestVersion: {
        ...webAppDetail.latestVersion,
        content: {
          ...webAppDetail.latestVersion.content,
          manifest: {
            ...webAppDetail.latestVersion.content.manifest,
            files: [
              {
                ...webAppDetail.latestVersion.content.manifest.files[0],
                hash: 'bad-hash',
              },
            ],
          },
        },
      },
    });
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('returns 404 for unsupported artifact kind', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...imageDetail,
      artifact: { ...imageDetail.artifact, kind: 'note' },
    });
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.status).toBe(404);
  });

  it('maps storage errors to 503 and ownership errors to 404', async () => {
    objectStorage.readVerified.mockRejectedValueOnce(
      new ObjectStorageError('object_not_found', 'not found'),
    );
    const storageResponse = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(storageResponse.status).toBe(503);
    await expect(storageResponse.json()).resolves.toMatchObject({
      error: { code: 'download_unavailable' },
    });

    artifactRepo.getArtifactDetail.mockRejectedValueOnce(
      new ArtifactOwnershipError(),
    );
    const ownershipResponse = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(ownershipResponse.status).toBe(404);
  });

  it('rejects bytes whose length does not match public metadata', async () => {
    objectStorage.readVerified.mockResolvedValueOnce(
      new Uint8Array([0x89, 0x50, 0x4e]),
    );
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'download_integrity_failed' },
    });
  });

  it('does not expose storageKey, checksum, or stack in error responses', async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    const body = await response.text();
    expect(body).not.toMatch(
      /storageKey|checksum|stack|objectKey|providerBody/i,
    );
  });

  it('sanitizes filename by filtering special characters', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...imageDetail,
      artifact: {
        ...imageDetail.artifact,
        title: 'test/file\\name:with"special\r\nchars',
      },
    });
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="test_file_name_with_special_chars.png"',
    );
  });

  it('returns 404 for archived artifacts', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...imageDetail,
      artifact: { ...imageDetail.artifact, status: 'archived' },
    });
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.status).toBe(404);
    expect(objectStorage.readVerified).not.toHaveBeenCalled();
  });
});
