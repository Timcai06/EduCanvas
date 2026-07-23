import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const artifactRepo = {
  getArtifactDetail: vi.fn(),
};
const objectStorage = {
  readVerified: vi.fn(),
};

vi.mock('@educanvas/db', async () => {
  const actual =
    await vi.importActual<typeof import('@educanvas/db')>('@educanvas/db');
  return {
    ...actual,
    DrizzlePlatformArtifactRepository: vi.fn(() => artifactRepo),
  };
});
vi.mock('@educanvas/agent-runtime', async () => {
  const actual =
    await vi.importActual<typeof import('@educanvas/agent-runtime')>('@educanvas/agent-runtime');
  return {
    ...actual,
    LocalObjectStorage: vi.fn(() => objectStorage),
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

const conversation = {
  id: 'conversation-1',
  spaceId: 'space-1',
};

const artifactId = '11111111-1111-4111-8111-111111111111';

const validMetadata = {
  contentVersion: 1,
  contentType: 'audio/mpeg',
  byteSize: 4,
  transcript: '摘要',
  sourceCount: 1,
  script: {
    generator: 'gpt',
    provider: null,
    resolvedModelId: null,
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 10,
  },
  speech: {
    provider: 'provider',
    resolvedModelId: 'model',
    voice: 'voice',
    inputCharacters: 10,
    latencyMs: 12,
  },
};

function request(): Request {
  return new Request(
    `http://localhost/api/v1/chat/artifacts/${artifactId}/audio`,
    {
      method: 'GET',
      headers: { origin: 'http://localhost' },
    },
  );
}

function rangeRequest(range?: string): Request {
  return new Request(
    `http://localhost/api/v1/chat/artifacts/${artifactId}/audio`,
    {
      method: 'GET',
      headers: {
        origin: 'http://localhost',
        ...(range ? { range } : {}),
      },
    },
  );
}

const artifactDetail = {
  artifact: {
    id: artifactId,
    kind: 'audio_overview',
    spaceId: conversation.spaceId,
  },
  latestVersion: {
    version: 1,
    content: {},
    objectKey: 'audio/example.mp3',
    checksum: 'a'.repeat(64),
    metadata: validMetadata,
  },
  latestJob: null,
};

describe('GET /api/v1/chat/artifacts/[artifactId]/audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(
      conversation as unknown as never,
    );
    artifactRepo.getArtifactDetail.mockReset();
    objectStorage.readVerified.mockReset();
    artifactRepo.getArtifactDetail.mockResolvedValue(artifactDetail);
    objectStorage.readVerified.mockResolvedValue(
      new Uint8Array([1, 2, 3, 4]).buffer
    );
  });

  it('returns 404 for invalid artifact ids', async () => {
    const response = await GET(
      new Request('http://localhost/api/v1/chat/artifacts/not-uuid/audio', {
        method: 'GET',
      }),
      { params: Promise.resolve({ artifactId: 'not-uuid' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('returns 401 when no identity', async () => {
    vi.mocked(readAnonymousIdentity).mockResolvedValue(null);
    const response = await GET(request(), { params: Promise.resolve({ artifactId }) });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthorized' },
    });
  });

  it('returns 401 when conversation is unavailable', async () => {
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(null as never);
    const response = await GET(request(), { params: Promise.resolve({ artifactId }) });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthorized' },
    });
  });

  it('returns 404 when artifact is not available for playback', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValue({
      ...artifactDetail,
      artifact: { ...artifactDetail.artifact, kind: 'mind_map' },
      latestVersion: { ...artifactDetail.latestVersion, objectKey: null },
    } as never);

    const response = await GET(request(), { params: Promise.resolve({ artifactId }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('streams full audio when no range is provided', async () => {
    const response = await GET(request(), { params: Promise.resolve({ artifactId }) });
    const bytes = await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('4');
    expect(new Uint8Array(bytes).byteLength).toBe(4);
  });

  it('streams partial audio with range and content-range', async () => {
    const response = await GET(
      rangeRequest('bytes=1-2'),
      { params: Promise.resolve({ artifactId }) },
    );
    const bytes = await response.arrayBuffer();

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 1-2/4');
    expect(new Uint8Array(bytes).byteLength).toBe(2);
  });

  it('returns 416 for invalid range requests', async () => {
    const response = await GET(
      rangeRequest('bytes=100-200'),
      { params: Promise.resolve({ artifactId }) },
    );

    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */4');
  });

  it('returns audio_integrity_failed when byte count mismatch', async () => {
    objectStorage.readVerified.mockResolvedValueOnce(
      new Uint8Array([1, 2]).buffer,
    );
    const response = await GET(request(), { params: Promise.resolve({ artifactId }) });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'audio_integrity_failed' },
    });
  });

  it('maps storage errors to 503', async () => {
    objectStorage.readVerified.mockRejectedValueOnce(
      new ObjectStorageError('object_not_found', 'not found'),
    );
    const response = await GET(request(), { params: Promise.resolve({ artifactId }) });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'audio_unavailable' },
    });
  });

  it('maps ownership errors to 404', async () => {
    artifactRepo.getArtifactDetail.mockRejectedValueOnce(
      new ArtifactOwnershipError(),
    );

    const response = await GET(request(), { params: Promise.resolve({ artifactId }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });
});
