import {
  ArtifactOwnershipError,
  ArtifactRevisionConflictError,
} from '@educanvas/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const artifactRepo = {
  getArtifactDetail: vi.fn(),
  listVersionProvenance: vi.fn(),
  getVersion: vi.fn(),
  getArtifact: vi.fn(),
  createRevisionGenerationJob: vi.fn(),
};

vi.mock('@educanvas/db', async () => {
  const actual =
    await vi.importActual<typeof import('@educanvas/db')>('@educanvas/db');
  return {
    ...actual,
    DrizzlePlatformArtifactRepository: vi.fn(() => artifactRepo),
  };
});

vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: vi.fn(),
}));

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { GET, PATCH } from './route';

const identity = {
  token: 'token',
  studentId: `anon:v1:${'b'.repeat(64)}`,
};
const conversation = {
  id: 'conversation-1',
  spaceId: 'space-1',
};

const validArtifact = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'mind_map',
  trustTier: 'tier1',
  title: '要点',
  status: 'active',
  latestVersion: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function params(artifactId: string) {
  return { params: Promise.resolve({ artifactId }) };
}

function getRequest(artifactId: string): Request {
  return new Request(
    `http://localhost/api/v1/chat/artifacts/${artifactId}/?version=1`,
    {
      method: 'GET',
      headers: { origin: 'http://localhost' },
    },
  );
}

function patchRequest(artifactId: string, body: string): Request {
  return new Request(
    `http://localhost/api/v1/chat/artifacts/${artifactId}`,
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body,
    },
  );
}

const detail = {
  artifact: {
    id: validArtifact.id,
    kind: validArtifact.kind,
    status: validArtifact.status,
    spaceId: conversation.spaceId,
    conversationId: null,
  },
  latestVersion: {
    version: 1,
    content: { blocks: [] },
    metadata: {
      contentVersion: 1,
      transcript: 'x',
      byteSize: 1,
      sourceCount: 1,
      contentType: 'audio/mpeg',
      script: {
        generator: 'gpt',
        provider: null,
        resolvedModelId: null,
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      },
      speech: {
        provider: 'provider',
        resolvedModelId: 'model',
        voice: 'voice',
        inputCharacters: 1,
        latencyMs: 1,
      },
    },
    objectKey: 'audio.mp3',
    checksum: 'a'.repeat(64),
  },
  latestJob: {
    id: 'job-1',
    status: 'queued',
    progress: null,
    failureCode: null,
  },
  versions: [
    { version: 1, generatedBy: 'gpt', revisionInstruction: 'rev', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
};

describe('GET /api/v1/chat/artifacts/[artifactId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(
      conversation as unknown as never,
    );
    artifactRepo.getArtifactDetail.mockReset();
    artifactRepo.listVersionProvenance.mockReset();
    artifactRepo.getVersion.mockReset();
    artifactRepo.getArtifact.mockReset();
    artifactRepo.createRevisionGenerationJob.mockReset();
    artifactRepo.getArtifactDetail.mockResolvedValue(detail);
    artifactRepo.listVersionProvenance.mockResolvedValue([
      { version: 1, generatedBy: 'gpt', revisionInstruction: 'init', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    artifactRepo.getVersion.mockResolvedValue(detail.latestVersion);
    artifactRepo.getArtifact.mockResolvedValue(validArtifact);
    artifactRepo.createRevisionGenerationJob.mockResolvedValue({
      artifact: validArtifact,
      job: { id: 'job-2', status: 'queued', progress: null, failureCode: null },
    });
  });

  it('returns detail projection and denies invalid artifact id', async () => {
    const response = await GET(
      getRequest('not-uuid'),
      params('not-uuid'),
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({ error: { code: 'artifact_not_found' } });
  });

  it('returns 401 when identity missing', async () => {
    vi.mocked(readAnonymousIdentity).mockResolvedValue(null);
    const response = await GET(
      getRequest(validArtifact.id),
      params(validArtifact.id),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthorized' },
    });
  });

  it('reads detail for valid id and space', async () => {
    const response = await GET(
      getRequest(validArtifact.id),
      params(validArtifact.id),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      artifact: {
        id: validArtifact.id,
        kind: validArtifact.kind,
      },
    });
    expect(payload.versions[0].version).toBe(1);
  });

  it('maps repository errors to 503', async () => {
    artifactRepo.getArtifactDetail.mockRejectedValue(new Error('db'));
    const response = await GET(
      getRequest(validArtifact.id),
      params(validArtifact.id),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_detail_unavailable' },
    });
  });
});

describe('PATCH /api/v1/chat/artifacts/[artifactId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(
      conversation as unknown as never,
    );
    artifactRepo.getArtifactDetail.mockReset();
    artifactRepo.listVersionProvenance.mockReset();
    artifactRepo.getVersion.mockReset();
    artifactRepo.getArtifact.mockReset();
    artifactRepo.createRevisionGenerationJob.mockReset();
    artifactRepo.getArtifact.mockResolvedValue({
      ...validArtifact,
      spaceId: conversation.spaceId,
    });
    artifactRepo.createRevisionGenerationJob.mockResolvedValue({
      artifact: {
        ...validArtifact,
        spaceId: conversation.spaceId,
      },
      job: { id: 'job-2', status: 'queued', progress: null, failureCode: null },
    });
  });

  it('returns 403 for cross-origin requests before request validation', async () => {
    const response = await PATCH(
      new Request(
        `http://localhost/api/v1/chat/artifacts/${validArtifact.id}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            origin: 'https://evil.example',
          },
          body: JSON.stringify({ baseVersion: 1, instruction: '修订' }),
        },
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(403);
  });

  it('returns 404 for invalid artifact ids before auth', async () => {
    const response = await PATCH(
      patchRequest('bad-id', JSON.stringify({ baseVersion: 1, instruction: '修订' })),
      params('bad-id'),
    );

    expect(response.status).toBe(404);
  });

  it('returns 400 for malformed patch payload', async () => {
    const response = await PATCH(
      patchRequest(validArtifact.id, JSON.stringify({ instruction: '修订' })),
      params(validArtifact.id),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    });
  });

  it('returns 409 when revision conflicts happen', async () => {
    artifactRepo.createRevisionGenerationJob.mockRejectedValue(
      new ArtifactRevisionConflictError('stale_version'),
    );

    const response = await PATCH(
      patchRequest(validArtifact.id, JSON.stringify({ baseVersion: 1, instruction: '修订' })),
      params(validArtifact.id),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_revision_conflict' },
    });
  });

  it('returns 202 for accepted revision request', async () => {
    const response = await PATCH(
      patchRequest(validArtifact.id, JSON.stringify({ baseVersion: 1, instruction: '修订' })),
      params(validArtifact.id),
    );

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload).toMatchObject({
      artifact: {
        id: validArtifact.id,
      },
      job: { id: 'job-2' },
    });
    expect(artifactRepo.createRevisionGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVersion: 1,
        artifactId: validArtifact.id,
        trustedSubjectId: identity.studentId,
        taskIdentifier: 'artifact:generate',
      }),
    );
  });

  it('maps artifact ownership mismatches to 404', async () => {
    artifactRepo.getArtifact.mockRejectedValue(new ArtifactOwnershipError());

    const response = await PATCH(
      patchRequest(validArtifact.id, JSON.stringify({ baseVersion: 1, instruction: '修订' })),
      params(validArtifact.id),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('maps generic failures to 503', async () => {
    artifactRepo.createRevisionGenerationJob.mockRejectedValue(
      new Error('queue down'),
    );

    const response = await PATCH(
      patchRequest(validArtifact.id, JSON.stringify({ baseVersion: 1, instruction: '修订' })),
      params(validArtifact.id),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_revision_unavailable' },
    });
  });
});
