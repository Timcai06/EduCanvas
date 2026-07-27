import {
  ARTIFACT_GENERATE_TASK,
  ArtifactIdempotencyConflictError,
  AssetAccessError,
} from '@educanvas/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const artifactRepo = {
  listSpaceArtifactsPage: vi.fn(),
  createArtifactWithGenerationJob: vi.fn(),
  getArtifact: vi.fn(),
  createRevisionGenerationJob: vi.fn(),
};
const manualArtifactRepo = {
  createWithInitialVersion: vi.fn(),
};
const assetRepo = {
  materializeOwnedReferences: vi.fn(),
};

vi.mock('@educanvas/db', async () => {
  const actual =
    await vi.importActual<typeof import('@educanvas/db')>('@educanvas/db');
  return {
    ...actual,
    DrizzlePlatformArtifactRepository: vi.fn(function () {
      return artifactRepo;
    }),
    DrizzleManualArtifactRepository: vi.fn(function () {
      return manualArtifactRepo;
    }),
    DrizzleAssetRepository: vi.fn(function () {
      return assetRepo;
    }),
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
import { POST, GET } from './route';

const identity = {
  token: 'token',
  studentId: `anon:v1:${'c'.repeat(64)}`,
};
const conversation = {
  id: '30000000-0000-4000-8000-000000000003',
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

const apiResponseBody = {
  artifact: {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'mind_map',
    trustTier: 'tier1',
    title: '要点',
    status: 'active',
    latestVersion: 1,
  },
  job: {
    id: 'jobs-1',
    status: 'queued',
  },
};

const sources = [
  {
    assetId: 'source-1',
    versionId: 'version-1',
    kind: 'document' as const,
  },
];

function postRequest(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/v1/chat/artifacts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      ...headers,
    },
    body,
  });
}

describe('GET /api/v1/chat/artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(
      conversation as unknown as never,
    );
    artifactRepo.listSpaceArtifactsPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
  });

  it('returns artifact list for active general conversation', async () => {
    artifactRepo.listSpaceArtifactsPage.mockResolvedValue({
      items: [validArtifact],
      nextCursor: null,
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      artifacts: [
        {
          id: validArtifact.id,
          kind: validArtifact.kind,
          trustTier: validArtifact.trustTier,
          title: validArtifact.title,
          status: validArtifact.status,
          latestVersion: validArtifact.latestVersion,
          updatedAt: validArtifact.updatedAt,
        },
      ],
      page: { nextCursor: null },
    });
    expect(artifactRepo.listSpaceArtifactsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: conversation.spaceId,
        trustedSubjectId: identity.studentId,
        kinds: ['mind_map', 'slides', 'flashcards', 'note', 'audio_overview'],
        limit: 50,
        cursor: null,
      }),
    );
  });

  it('returns 401 when conversation cannot be loaded', async () => {
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(null as never);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthorized' },
    });
  });

  it('maps query errors to 503', async () => {
    artifactRepo.listSpaceArtifactsPage.mockRejectedValue(new Error('db down'));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_list_unavailable' },
    });
  });
});

describe('POST /api/v1/chat/artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(
      conversation as unknown as never,
    );
    artifactRepo.getArtifact.mockReset?.();
    artifactRepo.createArtifactWithGenerationJob.mockReset();
    manualArtifactRepo.createWithInitialVersion.mockReset();
    assetRepo.materializeOwnedReferences.mockReset();
    artifactRepo.createArtifactWithGenerationJob.mockResolvedValue({
      artifact: validArtifact,
      job: {
        id: 'jobs-1',
        status: 'queued',
        progress: null,
        failureCode: null,
      },
    });
    manualArtifactRepo.createWithInitialVersion.mockResolvedValue({
      artifact: {
        ...validArtifact,
        kind: 'note',
        title: '课堂笔记',
      },
      version: { version: 1 },
    });
  });

  it('creates a text artifact for valid request', async () => {
    const response = await POST(
      postRequest(JSON.stringify({ kind: 'mind_map', title: '要点' })),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual(apiResponseBody);
    expect(artifactRepo.createArtifactWithGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: conversation.spaceId,
        conversationId: conversation.id,
        trustedSubjectId: identity.studentId,
        kind: 'mind_map',
        trustTier: 'tier1',
        title: '要点',
        taskIdentifier: ARTIFACT_GENERATE_TASK,
        params: {},
      }),
    );
  });

  it('passes a bounded idempotency key and returns a replay as 200', async () => {
    artifactRepo.createArtifactWithGenerationJob.mockResolvedValue({
      artifact: validArtifact,
      job: {
        id: 'jobs-1',
        status: 'queued',
        progress: null,
        failureCode: null,
      },
      replayed: true,
    });
    const response = await POST(
      postRequest(JSON.stringify({ kind: 'mind_map', title: '要点' }), {
        'idempotency-key': 'artifact:create:1',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ replayed: true });
    expect(artifactRepo.createArtifactWithGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'artifact:create:1',
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('rejects malformed or conflicting idempotency keys', async () => {
    const malformed = await POST(
      postRequest(JSON.stringify({ kind: 'mind_map', title: '要点' }), {
        'idempotency-key': 'contains spaces',
      }),
    );
    expect(malformed.status).toBe(400);
    artifactRepo.createArtifactWithGenerationJob.mockRejectedValue(
      new ArtifactIdempotencyConflictError(),
    );
    const conflict = await POST(
      postRequest(JSON.stringify({ kind: 'mind_map', title: '要点' }), {
        'idempotency-key': 'artifact:create:conflict',
      }),
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: 'idempotency_conflict' },
    });
  });

  it('creates a manual note atomically without enqueueing a worker job', async () => {
    const response = await POST(
      postRequest(
        JSON.stringify({
          kind: 'note',
          title: '课堂笔记',
          markdown: '# 二次函数',
        }),
      ),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      artifact: {
        kind: 'note',
        title: '课堂笔记',
        status: 'active',
        latestVersion: 1,
      },
      job: null,
    });
    expect(manualArtifactRepo.createWithInitialVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: conversation.spaceId,
        conversationId: conversation.id,
        trustedSubjectId: identity.studentId,
        kind: 'note',
        content: {
          contentVersion: 1,
          markdown: '# 二次函数',
          sourceConversationId: conversation.id,
          generatedByModel: false,
        },
        generatedBy: 'user:manual',
      }),
    );
    expect(artifactRepo.createArtifactWithGenerationJob).not.toHaveBeenCalled();
  });

  it('rejects invalid json payload with 400', async () => {
    const response = await POST(
      new Request('http://localhost/api/v1/chat/artifacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    });
  });

  it('rejects invalid request schema with 400', async () => {
    const response = await POST(
      postRequest(JSON.stringify({ kind: 'mind_map', title: '   ' })),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    });
  });

  it('rejects cross-origin writes with 403 before validation', async () => {
    const response = await POST(
      postRequest(JSON.stringify({ kind: 'mind_map', title: '要点' }), {
        origin: 'https://evil.example',
      }),
    );

    expect(response.status).toBe(403);
    expect(artifactRepo.createArtifactWithGenerationJob).not.toHaveBeenCalled();
  });

  it('returns 401 when identity missing', async () => {
    vi.mocked(readAnonymousIdentity).mockResolvedValue(null);

    const response = await POST(
      postRequest(JSON.stringify({ kind: 'mind_map', title: '要点' })),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthorized' },
    });
    expect(artifactRepo.createArtifactWithGenerationJob).not.toHaveBeenCalled();
  });

  it('returns 401 when conversation cannot be loaded', async () => {
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(null as never);

    const response = await POST(
      postRequest(JSON.stringify({ kind: 'mind_map', title: '要点' })),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthorized' },
    });
    expect(artifactRepo.createArtifactWithGenerationJob).not.toHaveBeenCalled();
  });

  it('maps audio source availability problems to 400/audio_sources_unavailable', async () => {
    assetRepo.materializeOwnedReferences.mockRejectedValue(
      new AssetAccessError(),
    );

    const response = await POST(
      postRequest(
        JSON.stringify({
          kind: 'audio_overview',
          title: '音频',
          sources,
        }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'audio_sources_unavailable' },
    });
  });

  it('maps unsupported audio sources to 400/audio_source_not_supported', async () => {
    assetRepo.materializeOwnedReferences.mockResolvedValue([
      {
        reference: { kind: 'image', assetId: 'img', versionId: 'vimg' },
        displayName: '图片',
        mimeType: 'image/png',
        byteSize: 1024,
        extractedText: null,
      },
    ]);

    const response = await POST(
      postRequest(
        JSON.stringify({
          kind: 'audio_overview',
          title: '音频',
          sources,
        }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'audio_source_not_supported' },
    });
  });

  it('maps repository failures to 503', async () => {
    artifactRepo.createArtifactWithGenerationJob.mockRejectedValue(
      new Error('queue down'),
    );

    const response = await POST(
      postRequest(JSON.stringify({ kind: 'mind_map', title: '要点' })),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_create_unavailable' },
    });
  });
});
