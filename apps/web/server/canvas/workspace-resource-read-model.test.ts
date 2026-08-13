import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGeneralConversation,
  mockListArtifactFactsPage,
  mockListSourceFactsPage,
  mockLoadWorkspaceMemberFacts,
} = vi.hoisted(() => ({
  mockGeneralConversation: vi.fn(),
  mockListArtifactFactsPage: vi.fn(),
  mockListSourceFactsPage: vi.fn(),
  mockLoadWorkspaceMemberFacts: vi.fn(),
}));

vi.mock('../platform/general-conversation', () => ({
  loadOwnedGeneralConversationForSubject: mockGeneralConversation,
}));

vi.mock('@educanvas/db/workspace-resource-summary', () => ({
  DrizzleWorkspaceResourceMemberFactsRepository: class {
    load = mockLoadWorkspaceMemberFacts;
  },
  DrizzleWorkspaceResourceSummaryRepository: class {
    listArtifactFactsPage = mockListArtifactFactsPage;
    listSourceFactsPage = mockListSourceFactsPage;
  },
}));

vi.mock('server-only', () => ({}));

import {
  buildWorkspaceResourceCacheKey,
  listWorkspaceResourceSummaries,
  mergeWorkspaceResourceCandidates,
  validateWorkspaceArtifactFact,
} from './workspace-resource-read-model';

describe('workspace resource cache authority key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const base = {
    dataOwnerKind: 'registered' as const,
    dataOwnerId: 'same-visible-id',
    notebookId: '10000000-0000-4000-8000-000000000001',
    cursor: null,
    filter: 'all' as const,
  };

  it('is stable without exposing the raw owner identity', () => {
    const key = buildWorkspaceResourceCacheKey(base);
    expect(buildWorkspaceResourceCacheKey(base)).toBe(key);
    expect(key).not.toContain(base.dataOwnerId);
  });

  it('separates effective owner kind, notebook and query facts', () => {
    const key = buildWorkspaceResourceCacheKey(base);
    expect(
      buildWorkspaceResourceCacheKey({ ...base, dataOwnerKind: 'local' }),
    ).not.toBe(key);
    expect(
      buildWorkspaceResourceCacheKey({
        ...base,
        notebookId: '10000000-0000-4000-8000-000000000002',
      }),
    ).not.toBe(key);
    expect(
      buildWorkspaceResourceCacheKey({ ...base, filter: 'source' }),
    ).not.toBe(key);
    expect(
      buildWorkspaceResourceCacheKey({ ...base, cursor: 'next-page' }),
    ).not.toBe(key);
  });
});

describe('workspace artifact fact validation', () => {
  const base = {
    accessRole: 'owner' as const,
    artifact: {
      id: 'artifact-1',
      spaceId: 'space-1',
      conversationId: null,
      ownerSubjectId: 'owner-1',
      kind: 'markdown_document',
      trustTier: 'tier1',
      title: 'Artifact',
      status: 'active',
      latestVersion: 2,
      createdAt: '2026-08-12T12:00:00.000Z',
      updatedAt: '2026-08-12T12:00:00.000Z',
    },
    latestVersion: {
      id: 'version-2',
      artifactId: 'artifact-1',
      version: 2,
      generatedBy: null,
      createdByOperationId: null,
      generationJobId: null,
      createdAt: '2026-08-12T12:00:00.000Z',
    },
    latestJob: null,
    versionJob: null,
  };

  it('requires the immutable row to match the aggregate counter', () => {
    expect(() => validateWorkspaceArtifactFact(base)).not.toThrow();
    expect(() =>
      validateWorkspaceArtifactFact({
        ...base,
        latestVersion: { ...base.latestVersion, version: 1 },
      }),
    ).toThrow('resource_not_found');
  });

  it('fails closed on unknown aggregate or job status', () => {
    expect(() =>
      validateWorkspaceArtifactFact({
        ...base,
        artifact: { ...base.artifact, status: 'future_status' },
      }),
    ).toThrow('resource_not_found');
    expect(() =>
      validateWorkspaceArtifactFact({
        ...base,
        latestJob: {
          id: 'job-1',
          artifactId: 'artifact-1',
          operationId: null,
          status: 'future_status',
          progress: null,
          failureCode: null,
          params: {},
        },
      }),
    ).toThrow('resource_not_found');
  });
});

describe('workspace resource dual cursor merge', () => {
  it('advances past an unrenderable Source instead of repeating it forever', () => {
    const result = mergeWorkspaceResourceCandidates({
      candidates: [
        {
          resourceKind: 'source',
          resourceId: '10000000-0000-4000-8000-000000000001',
          updatedAt: '2026-08-12T12:01:00.000Z',
          item: null,
        },
      ],
      cursor: { source: null, artifact: null },
      limit: 50,
      hasFurtherDatabasePage: true,
    });
    expect(result.items).toEqual([]);
    expect(result.cursor.source?.id).toBe(
      '10000000-0000-4000-8000-000000000001',
    );
    expect(result.hasMore).toBe(true);
  });

  it('does not invent an extra page when exactly one final item is consumed', () => {
    const source = {
      schemaVersion: 1 as const,
      resourceKind: 'source' as const,
      resourceId: 'source-1',
      notebookId: 'notebook-1',
      title: 'Source',
      updatedAt: '2026-08-12T12:00:00.000Z',
      status: 'ready' as const,
      version: { versionId: 'version-1', sequence: null },
      renderer: { rendererId: 'source.pdf', rendererVersion: 1 },
      allowedActions: ['view' as const],
      provenance: { sourceResourceIds: [], sourceReferences: [] },
      context: { enabled: true },
      surface: { restState: null },
    };
    const result = mergeWorkspaceResourceCandidates({
      candidates: [
        {
          resourceKind: 'source',
          resourceId: source.resourceId,
          updatedAt: source.updatedAt,
          item: source,
        },
      ],
      cursor: { source: null, artifact: null },
      limit: 1,
      hasFurtherDatabasePage: false,
    });
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(false);
  });
});

describe('workspace resource summary projection', () => {
  it('preserves version-bound provenance when latest revision has failed job', async () => {
    mockGeneralConversation.mockResolvedValue({ spaceId: 'space-1' });
    mockListSourceFactsPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    mockListArtifactFactsPage.mockResolvedValue({
      items: [
        {
          accessRole: 'owner',
          artifact: {
            id: 'artifact-1',
            spaceId: 'space-1',
            conversationId: null,
            ownerSubjectId: 'owner-1',
            kind: 'markdown_document',
            trustTier: 'tier1',
            title: 'Markdown',
            status: 'active',
            latestVersion: 2,
            createdAt: '2026-08-12T12:00:00.000Z',
            updatedAt: '2026-08-12T12:00:00.000Z',
          },
          latestVersion: {
            id: 'version-2',
            artifactId: 'artifact-1',
            version: 2,
            generatedBy: 'model:artifact.generate:v1',
            createdByOperationId: null,
            generationJobId: 'generation-job-v1',
            createdAt: '2026-08-12T12:00:00.000Z',
          },
          latestJob: {
            id: 'revised-failed-job',
            artifactId: 'artifact-1',
            operationId: null,
            status: 'failed',
            progress: 100,
            failureCode: 'timeout',
            params: {},
          },
          versionJob: {
            id: 'generation-job-v1',
            artifactId: 'artifact-1',
            operationId: null,
            status: 'succeeded',
            progress: 100,
            failureCode: null,
            params: {
              provenance: {
                sources: [
                  {
                    assetId: 'source-usable',
                    versionId: 'source-version-usable',
                  },
                ],
              },
            },
          },
        },
      ],
      nextCursor: null,
    });
    mockLoadWorkspaceMemberFacts.mockResolvedValue({
      sourceBindings: new Map(),
      surfacePositions: new Map(),
    });

    const result = await listWorkspaceResourceSummaries({
      dataOwnerKind: 'registered',
      dataOwnerId: 'owner-1',
      cursor: null,
      filter: 'artifact',
      limit: 10,
    });

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.status).toBe('ready');
    expect(item.version?.sequence).toBe(2);
    expect(item.provenance.sourceResourceIds).toEqual(['source-usable']);
    expect(item.provenance.sourceReferences).toEqual([
      {
        resourceId: 'source-usable',
        versionId: 'source-version-usable',
      },
    ]);
    expect(item.allowedActions).toEqual([
      'view',
      'edit',
      'regenerate',
      'download',
      'delete',
    ]);
  });

  it('preserves version-bound provenance when latest revision has cancelled job', async () => {
    mockGeneralConversation.mockResolvedValue({ spaceId: 'space-1' });
    mockListSourceFactsPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    mockListArtifactFactsPage.mockResolvedValue({
      items: [
        {
          accessRole: 'owner',
          artifact: {
            id: 'artifact-2',
            spaceId: 'space-1',
            conversationId: null,
            ownerSubjectId: 'owner-1',
            kind: 'markdown_document',
            trustTier: 'tier1',
            title: 'Markdown',
            status: 'active',
            latestVersion: 3,
            createdAt: '2026-08-12T12:00:00.000Z',
            updatedAt: '2026-08-12T12:00:00.000Z',
          },
          latestVersion: {
            id: 'version-3',
            artifactId: 'artifact-2',
            version: 3,
            generatedBy: 'model:artifact.generate:v1',
            createdByOperationId: null,
            generationJobId: 'generation-job-v2',
            createdAt: '2026-08-12T12:00:00.000Z',
          },
          latestJob: {
            id: 'cancelled-job',
            artifactId: 'artifact-2',
            operationId: null,
            status: 'cancelled',
            progress: 100,
            failureCode: null,
            params: {},
          },
          versionJob: {
            id: 'generation-job-v2',
            artifactId: 'artifact-2',
            operationId: null,
            status: 'succeeded',
            progress: 100,
            failureCode: null,
            params: {
              provenance: {
                sources: [
                  {
                    assetId: 'source-usable-2',
                    versionId: 'source-version-usable-2',
                  },
                ],
              },
            },
          },
        },
      ],
      nextCursor: null,
    });
    mockLoadWorkspaceMemberFacts.mockResolvedValue({
      sourceBindings: new Map(),
      surfacePositions: new Map(),
    });

    const result = await listWorkspaceResourceSummaries({
      dataOwnerKind: 'registered',
      dataOwnerId: 'owner-1',
      cursor: null,
      filter: 'artifact',
      limit: 10,
    });

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.status).toBe('ready');
    expect(item.version?.sequence).toBe(3);
    expect(item.provenance.sourceResourceIds).toEqual(['source-usable-2']);
    expect(item.provenance.sourceReferences).toEqual([
      {
        resourceId: 'source-usable-2',
        versionId: 'source-version-usable-2',
      },
    ]);
    expect(item.allowedActions).toEqual([
      'view',
      'edit',
      'regenerate',
      'download',
      'delete',
    ]);
  });
});
