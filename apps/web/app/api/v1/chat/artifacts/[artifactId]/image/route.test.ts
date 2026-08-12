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
    DrizzlePlatformArtifactRepository: vi.fn(function () {
      return artifactRepo;
    }),
  };
});
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

const validMetadata = {
  contentVersion: 1,
  contentType: 'image/png',
  byteSize: 4,
  size: '1024x1024',
  image: {
    provider: 'openai-compatible',
    resolvedModelId: 'image-v1',
    latencyMs: 120,
  },
};

const artifactDetail = {
  artifact: {
    id: artifactId,
    kind: 'generated_image',
    spaceId: conversation.spaceId,
  },
  latestVersion: {
    version: 1,
    content: null,
    objectKey: 'artifacts/private/image.png',
    checksum: 'a'.repeat(64),
    metadata: validMetadata,
  },
  latestJob: null,
};

function request(): Request {
  return new Request(
    `http://localhost/api/v1/chat/artifacts/${artifactId}/image`,
    { method: 'GET', headers: { origin: 'http://localhost' } },
  );
}

describe('GET /api/v1/chat/artifacts/[artifactId]/image', () => {
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
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it('returns 404 for invalid artifact ids', async () => {
    const response = await GET(
      new Request('http://localhost/api/v1/chat/artifacts/not-uuid/image'),
      { params: Promise.resolve({ artifactId: 'not-uuid' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('returns 401 when identity or conversation is unavailable', async () => {
    vi.mocked(readAnonymousIdentity).mockResolvedValueOnce(null);
    await expect(
      GET(request(), { params: Promise.resolve({ artifactId }) }).then(
        (response) => response.status,
      ),
    ).resolves.toBe(401);

    vi.mocked(loadOwnedGeneralConversation).mockResolvedValueOnce(
      null as never,
    );
    await expect(
      GET(request(), { params: Promise.resolve({ artifactId }) }).then(
        (response) => response.status,
      ),
    ).resolves.toBe(401);
    expect(objectStorage.readVerified).not.toHaveBeenCalled();
  });

  it('returns 404 when the artifact belongs to another Notebook', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...artifactDetail,
      artifact: {
        ...artifactDetail.artifact,
        spaceId: 'another-space',
      },
    });

    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });

    expect(response.status).toBe(404);
    expect(objectStorage.readVerified).not.toHaveBeenCalled();
  });

  it('serves verified bytes with the declared MIME and no sniffing', async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    const bytes = await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(bytes).byteLength).toBe(4);
    expect(objectStorage.readVerified).toHaveBeenCalledWith(
      artifactDetail.latestVersion.objectKey,
      artifactDetail.latestVersion.checksum,
    );
  });

  it('returns 404 for other kinds and for versions without stored bytes', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...artifactDetail,
      artifact: { ...artifactDetail.artifact, kind: 'audio_overview' },
    } as never);
    await expect(
      GET(request(), { params: Promise.resolve({ artifactId }) }).then(
        (response) => response.status,
      ),
    ).resolves.toBe(404);

    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...artifactDetail,
      latestVersion: { ...artifactDetail.latestVersion, objectKey: null },
    } as never);
    await expect(
      GET(request(), { params: Promise.resolve({ artifactId }) }).then(
        (response) => response.status,
      ),
    ).resolves.toBe(404);
  });

  it('rejects metadata that is not a valid public image projection', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...artifactDetail,
      latestVersion: {
        ...artifactDetail.latestVersion,
        metadata: { ...validMetadata, contentType: 'image/svg+xml' },
      },
    } as never);

    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.status).toBe(404);
  });

  it('returns image_integrity_failed when byte count mismatches metadata', async () => {
    objectStorage.readVerified.mockResolvedValueOnce(new Uint8Array([1, 2]));

    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'image_integrity_failed' },
    });
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
      error: { code: 'image_unavailable' },
    });

    artifactRepo.getArtifactDetail.mockRejectedValueOnce(
      new ArtifactOwnershipError(),
    );
    const ownershipResponse = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(ownershipResponse.status).toBe(404);
    await expect(ownershipResponse.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('contains revoked-membership diagnostics and never reads private bytes', async () => {
    artifactRepo.getArtifactDetail.mockRejectedValueOnce(
      new ArtifactOwnershipError(),
    );
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(objectStorage.readVerified).not.toHaveBeenCalled();
    expect(body).not.toMatch(/objectKey|checksum|providerBody|prompt|stack/i);
  });

  it('returns 404 for archived artifacts', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValueOnce({
      ...artifactDetail,
      artifact: { ...artifactDetail.artifact, status: 'archived' },
    });
    const response = await GET(request(), {
      params: Promise.resolve({ artifactId }),
    });
    expect(response.status).toBe(404);
    expect(objectStorage.readVerified).not.toHaveBeenCalled();
  });
});
