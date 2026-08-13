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
  getGenerationJob: vi.fn(),
  getArtifact: vi.fn(),
  appendVersion: vi.fn(),
  createRevisionGenerationJob: vi.fn(),
  archiveOwnedArtifact: vi.fn(),
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

vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: vi.fn(),
}));

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { GET, PATCH, DELETE } from './route';

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
  return new Request(`http://localhost/api/v1/chat/artifacts/${artifactId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body,
  });
}

const detail = {
  artifact: {
    ...validArtifact,
    spaceId: conversation.spaceId,
    conversationId: null,
    ownerSubjectId: identity.studentId,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  latestVersion: {
    id: '22222222-2222-4222-8222-222222222222',
    artifactId: validArtifact.id,
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
    generatedBy: 'model:artifact.generate:v1',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  latestJob: {
    id: 'job-1',
    status: 'queued',
    progress: null,
    failureCode: null,
  },
  versions: [
    {
      version: 1,
      generatedBy: 'gpt',
      revisionInstruction: 'rev',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
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
    artifactRepo.getGenerationJob.mockReset();
    artifactRepo.getArtifact.mockReset();
    artifactRepo.appendVersion.mockReset();
    artifactRepo.createRevisionGenerationJob.mockReset();
    requireNotebookAccessMock.mockReset();
    requireNotebookAccessMock.mockResolvedValue({
      notebookId: conversation.spaceId,
      role: 'owner',
      permissions: ['notebook.read'],
    });
    artifactRepo.archiveOwnedArtifact.mockReset();
    artifactRepo.archiveOwnedArtifact.mockResolvedValue(true);
    artifactRepo.getArtifactDetail.mockResolvedValue(detail);
    artifactRepo.listVersionProvenance.mockResolvedValue([
      {
        version: 1,
        generatedBy: 'gpt',
        revisionInstruction: 'init',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    artifactRepo.getVersion.mockResolvedValue(detail.latestVersion);
    artifactRepo.getGenerationJob.mockResolvedValue(null);
    artifactRepo.getArtifact.mockResolvedValue(validArtifact);
    artifactRepo.createRevisionGenerationJob.mockResolvedValue({
      artifact: validArtifact,
      job: { id: 'job-2', status: 'queued', progress: null, failureCode: null },
    });
  });

  it('returns detail projection and denies invalid artifact id', async () => {
    const response = await GET(getRequest('not-uuid'), params('not-uuid'));
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
      canvasResource: {
        resourceId: validArtifact.id,
        notebookId: conversation.spaceId,
        renderer: { rendererId: 'artifact.mind-map' },
      },
    });
    expect(payload.versions[0].version).toBe(1);
    expect(JSON.stringify(payload)).not.toContain('audio.mp3');
    expect(payload).not.toHaveProperty('objectKey');
    expect(payload).not.toHaveProperty('checksum');
  });

  it('loads historical version provenance from selected version generation job', async () => {
    const historicalVersion = {
      id: '33333333-3333-4333-8333-333333333333',
      artifactId: validArtifact.id,
      version: 1,
      content: { nodes: [] },
      metadata: { contentVersion: 1 },
      objectKey: null,
      checksum: null,
      createdByOperationId: null,
      generatedBy: 'model:artifact.generate:v1',
      generationJobId: 'historical-job',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    artifactRepo.getArtifactDetail.mockResolvedValue({
      ...detail,
      latestVersion: {
        ...detail.latestVersion,
        generationJobId: 'latest-job',
      },
      latestJob: {
        id: 'latest-job',
        status: 'failed',
        progress: null,
        failureCode: 'rate_limited',
      },
    });
    artifactRepo.getVersion.mockResolvedValue(historicalVersion);
    artifactRepo.getGenerationJob.mockResolvedValue({
      id: 'historical-job',
      artifactId: validArtifact.id,
      status: 'succeeded',
      progress: 100,
      failureCode: null,
      params: {
        provenance: {
          sources: [
            {
              assetId: 'source-a',
              versionId: 'v1',
              sourceType: 'note',
            },
          ],
        },
      },
      operationId: null,
      checkpoint: {},
      queueJobKey: null,
    });

    const response = await GET(
      getRequest(validArtifact.id),
      params(validArtifact.id),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(artifactRepo.getVersion).toHaveBeenCalledWith({
      artifactId: validArtifact.id,
      version: 1,
      trustedSubjectId: identity.studentId,
    });
    expect(artifactRepo.getGenerationJob).toHaveBeenCalledWith({
      jobId: 'historical-job',
      trustedSubjectId: identity.studentId,
    });
    expect(payload).toMatchObject({
      artifact: { id: validArtifact.id },
      latestJob: { id: 'latest-job', status: 'failed' },
      canvasResource: {
        provenance: {
          sourceResourceIds: ['source-a'],
          sourceReferences: [{ resourceId: 'source-a', versionId: 'v1' }],
        },
      },
    });
  });

  it('returns a queued artifact before its first immutable version exists', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValue({
      ...detail,
      artifact: {
        ...detail.artifact,
        latestVersion: 0,
      },
      latestVersion: null,
      latestJob: {
        id: 'job-queued',
        status: 'queued',
        progress: null,
        failureCode: null,
      },
    });
    artifactRepo.listVersionProvenance.mockResolvedValue([]);

    const response = await GET(
      new Request(`http://localhost/api/v1/chat/artifacts/${validArtifact.id}`),
      params(validArtifact.id),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      artifact: {
        id: validArtifact.id,
        latestVersion: 0,
      },
      version: null,
      versions: [],
      latestJob: {
        id: 'job-queued',
        status: 'queued',
      },
    });
    expect(payload).not.toHaveProperty('canvasResource');
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

  it('maps a cross-Notebook artifact to the same 404 as a missing artifact', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValue({
      ...detail,
      artifact: { ...detail.artifact, spaceId: 'other-notebook' },
    });
    const response = await GET(
      getRequest(validArtifact.id),
      params(validArtifact.id),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('returns stable 404 when current Notebook membership was revoked after summary load', async () => {
    requireNotebookAccessMock.mockRejectedValueOnce(
      new Error('membership revoked objectKey=private/key'),
    );
    const response = await GET(
      getRequest(validArtifact.id),
      params(validArtifact.id),
    );
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain('artifact_not_found');
    expect(body).not.toMatch(
      /membership revoked|objectKey|private\/key|stack/i,
    );
  });

  it('returns 404 for archived artifacts', async () => {
    artifactRepo.getArtifactDetail.mockResolvedValue({
      ...detail,
      artifact: { ...detail.artifact, status: 'archived' },
    });
    const response = await GET(
      getRequest(validArtifact.id),
      params(validArtifact.id),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
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
    artifactRepo.appendVersion.mockReset();
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
    artifactRepo.getVersion.mockResolvedValue({
      version: 1,
      content: {
        contentVersion: 1,
        markdown: '# 原笔记',
        generatedByModel: true,
      },
    });
    artifactRepo.appendVersion.mockResolvedValue({ version: 2 });
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
          body: JSON.stringify({
            action: 'generate',
            baseVersion: 1,
            instruction: '修订',
          }),
        },
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(403);
  });

  it('returns 404 for invalid artifact ids before auth', async () => {
    const response = await PATCH(
      patchRequest(
        'bad-id',
        JSON.stringify({
          action: 'generate',
          baseVersion: 1,
          instruction: '修订',
        }),
      ),
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
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'generate',
          baseVersion: 1,
          instruction: '修订',
        }),
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_revision_conflict' },
    });
  });

  it('returns 202 for accepted revision request', async () => {
    const response = await PATCH(
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'generate',
          baseVersion: 1,
          instruction: '修订',
        }),
      ),
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

  it('returns 202 for accepted markdown document revision request', async () => {
    artifactRepo.getArtifact.mockResolvedValue({
      ...validArtifact,
      kind: 'markdown_document',
      spaceId: conversation.spaceId,
    });
    const response = await PATCH(
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'generate',
          baseVersion: 1,
          instruction: '增加章节',
        }),
      ),
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

  it('returns 200 and appends a note version without a generation job', async () => {
    artifactRepo.getArtifact.mockResolvedValue({
      ...validArtifact,
      kind: 'note',
      spaceId: conversation.spaceId,
    });

    const response = await PATCH(
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'save_note',
          baseVersion: 1,
          markdown: '# 新笔记',
        }),
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      artifact: { latestVersion: 2 },
      job: null,
    });
    expect(artifactRepo.appendVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: validArtifact.id,
        expectedLatestVersion: 1,
        generatedBy: 'user:manual',
        content: expect.objectContaining({
          markdown: '# 新笔记',
          generatedByModel: false,
        }),
      }),
    );
    expect(artifactRepo.createRevisionGenerationJob).not.toHaveBeenCalled();
  });

  it('returns 200 and appends a markdown 文档版本并保留可追踪字段', async () => {
    artifactRepo.getArtifact.mockResolvedValue({
      ...validArtifact,
      kind: 'markdown_document',
      spaceId: conversation.spaceId,
    });
    artifactRepo.getVersion.mockResolvedValue({
      version: 1,
      content: {
        contentVersion: 1,
        markdown: '# 原文档',
        generatedByModel: true,
      },
    });

    const response = await PATCH(
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'save_markdown_document',
          baseVersion: 1,
          markdown: '# 新文档',
        }),
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      artifact: { latestVersion: 2 },
      job: null,
    });
    expect(artifactRepo.appendVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: validArtifact.id,
        trustedSubjectId: identity.studentId,
        expectedLatestVersion: 1,
        generatedBy: 'user:manual',
        content: expect.objectContaining({
          contentVersion: 1,
          markdown: '# 新文档',
          generatedByModel: false,
        }),
      }),
    );
    expect(artifactRepo.createRevisionGenerationJob).not.toHaveBeenCalled();
  });

  it('rejects markdown 文档保存在 kind 不匹配时的请求', async () => {
    artifactRepo.getArtifact.mockResolvedValue({
      ...validArtifact,
      kind: 'mind_map',
      spaceId: conversation.spaceId,
    });

    const response = await PATCH(
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'save_markdown_document',
          baseVersion: 1,
          markdown: '# 新文档',
        }),
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
    expect(artifactRepo.appendVersion).not.toHaveBeenCalled();
  });

  it('returns 400 when markdown_document 保存请求超出长度限制', async () => {
    artifactRepo.getArtifact.mockResolvedValue({
      ...validArtifact,
      kind: 'markdown_document',
      spaceId: conversation.spaceId,
    });

    const response = await PATCH(
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'save_markdown_document',
          baseVersion: 1,
          markdown: 'x'.repeat(60001),
        }),
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(artifactRepo.appendVersion).not.toHaveBeenCalled();
    expect(artifactRepo.createRevisionGenerationJob).not.toHaveBeenCalled();
  });

  it('restores a historical mind map by appending a new immutable version', async () => {
    const historical = {
      version: 1,
      content: {
        contentVersion: 2,
        rootNodeId: 'root',
        nodes: [{ id: 'root', label: '原导图' }],
        edges: [],
      },
    };
    artifactRepo.getVersion.mockResolvedValue(historical);
    artifactRepo.appendVersion.mockResolvedValue({ version: 3 });
    artifactRepo.getArtifact.mockResolvedValue({
      ...validArtifact,
      latestVersion: 2,
      spaceId: conversation.spaceId,
    });

    const response = await PATCH(
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'restore',
          sourceVersion: 1,
          expectedLatestVersion: 2,
        }),
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      artifact: { latestVersion: 3 },
      job: null,
    });
    expect(artifactRepo.appendVersion).toHaveBeenCalledWith({
      artifactId: validArtifact.id,
      trustedSubjectId: identity.studentId,
      content: historical.content,
      generatedBy: 'user:restore:v1',
      expectedLatestVersion: 2,
    });
  });

  it('rejects restore for a kind without a validated restore contract', async () => {
    artifactRepo.getArtifact.mockResolvedValue({
      ...validArtifact,
      kind: 'slides',
      latestVersion: 2,
      spaceId: conversation.spaceId,
    });

    const response = await PATCH(
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'restore',
          sourceVersion: 1,
          expectedLatestVersion: 2,
        }),
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(404);
    expect(artifactRepo.appendVersion).not.toHaveBeenCalled();
  });

  it('maps artifact ownership mismatches to 404', async () => {
    artifactRepo.getArtifact.mockRejectedValue(new ArtifactOwnershipError());

    const response = await PATCH(
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'generate',
          baseVersion: 1,
          instruction: '修订',
        }),
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
  });

  it('rechecks viewer write authority and returns stable 404', async () => {
    artifactRepo.createRevisionGenerationJob.mockRejectedValueOnce(
      new ArtifactOwnershipError(),
    );

    const response = await PATCH(
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'generate',
          baseVersion: 1,
          instruction: '不能依赖旧 allowedActions 的修改',
        }),
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_not_found' },
    });
    expect(artifactRepo.createRevisionGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({ trustedSubjectId: identity.studentId }),
    );
  });

  it('maps generic failures to 503', async () => {
    artifactRepo.createRevisionGenerationJob.mockRejectedValue(
      new Error('queue down'),
    );

    const response = await PATCH(
      patchRequest(
        validArtifact.id,
        JSON.stringify({
          action: 'generate',
          baseVersion: 1,
          instruction: '修订',
        }),
      ),
      params(validArtifact.id),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_revision_unavailable' },
    });
  });
});

function deleteRequest(artifactId: string): Request {
  return new Request(`http://localhost/api/v1/chat/artifacts/${artifactId}`, {
    method: 'DELETE',
    headers: { origin: 'http://localhost' },
  });
}

describe('DELETE /api/v1/chat/artifacts/[artifactId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue(
      conversation as unknown as never,
    );
    requireNotebookAccessMock.mockReset();
    requireNotebookAccessMock.mockResolvedValue({
      notebookId: conversation.spaceId,
      role: 'owner',
      permissions: ['notebook.read', 'notebook.write'],
    });
    artifactRepo.archiveOwnedArtifact.mockReset();
    artifactRepo.archiveOwnedArtifact.mockResolvedValue(true);
  });

  it('returns 403 for cross-origin requests', async () => {
    const response = await DELETE(
      new Request(
        `http://localhost/api/v1/chat/artifacts/${validArtifact.id}`,
        {
          method: 'DELETE',
          headers: { origin: 'https://evil.example' },
        },
      ),
      params(validArtifact.id),
    );
    expect(response.status).toBe(403);
  });

  it('returns 404 for invalid artifact ids', async () => {
    const response = await DELETE(
      deleteRequest('not-uuid'),
      params('not-uuid'),
    );
    expect(response.status).toBe(404);
  });

  it('returns 401 when identity missing', async () => {
    vi.mocked(readAnonymousIdentity).mockResolvedValue(null);
    const response = await DELETE(
      deleteRequest(validArtifact.id),
      params(validArtifact.id),
    );
    expect(response.status).toBe(401);
  });

  it('archives artifact and returns success', async () => {
    const response = await DELETE(
      deleteRequest(validArtifact.id),
      params(validArtifact.id),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ deleted: true });
    expect(artifactRepo.archiveOwnedArtifact).toHaveBeenCalledWith({
      artifactId: validArtifact.id,
      trustedSubjectId: identity.studentId,
      notebookId: conversation.spaceId,
    });
  });

  it('returns 404 for viewer without notebook.write', async () => {
    requireNotebookAccessMock.mockResolvedValueOnce({
      notebookId: conversation.spaceId,
      role: 'viewer',
      permissions: ['notebook.read'],
    });
    artifactRepo.archiveOwnedArtifact.mockResolvedValueOnce(false);
    const response = await DELETE(
      deleteRequest(validArtifact.id),
      params(validArtifact.id),
    );
    expect(response.status).toBe(404);
  });

  it('returns 404 for cross-notebook artifact', async () => {
    artifactRepo.archiveOwnedArtifact.mockResolvedValueOnce(false);
    const response = await DELETE(
      deleteRequest(validArtifact.id),
      params(validArtifact.id),
    );
    expect(response.status).toBe(404);
  });

  it('is idempotent for already-archived artifacts', async () => {
    artifactRepo.archiveOwnedArtifact.mockResolvedValueOnce(false);
    const response = await DELETE(
      deleteRequest(validArtifact.id),
      params(validArtifact.id),
    );
    expect(response.status).toBe(404);
  });

  it('maps ownership errors to 404', async () => {
    artifactRepo.archiveOwnedArtifact.mockRejectedValueOnce(
      new ArtifactOwnershipError(),
    );
    const response = await DELETE(
      deleteRequest(validArtifact.id),
      params(validArtifact.id),
    );
    expect(response.status).toBe(404);
  });

  it('maps generic errors to 503', async () => {
    artifactRepo.archiveOwnedArtifact.mockRejectedValueOnce(
      new Error('db down'),
    );
    const response = await DELETE(
      deleteRequest(validArtifact.id),
      params(validArtifact.id),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'artifact_delete_unavailable' },
    });
  });

  it('does not expose storageKey, checksum, or stack in responses', async () => {
    const response = await DELETE(
      deleteRequest(validArtifact.id),
      params(validArtifact.id),
    );
    const body = await response.text();
    expect(body).not.toMatch(/storageKey|checksum|stack|objectKey/i);
  });
});
