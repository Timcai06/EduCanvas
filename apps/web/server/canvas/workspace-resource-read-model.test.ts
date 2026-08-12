import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildWorkspaceResourceCacheKey,
  mergeWorkspaceResourceCandidates,
  validateWorkspaceArtifactFact,
} from './workspace-resource-read-model';

describe('workspace resource cache authority key', () => {
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
