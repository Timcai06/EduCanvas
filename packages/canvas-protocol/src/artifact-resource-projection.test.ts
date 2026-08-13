import { describe, expect, it } from 'vitest';
import {
  ArtifactResourceProjectionError,
  projectOwnedArtifactResource,
} from './artifact-resource-projection';

const artifactBase = {
  id: '10000000-0000-4000-8000-000000000001',
  spaceId: 'space-1',
  conversationId: null,
  ownerSubjectId: 'owner-1',
  trustTier: 'tier1' as const,
  title: '课程文档',
  status: 'active' as const,
  latestVersion: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:01:00.000Z',
};

const version = {
  id: '20000000-0000-4000-8000-000000000002',
  artifactId: artifactBase.id,
  version: 1,
  content: {
    contentVersion: 1,
    markdown: '# 文档',
    sourceConversationId: '11111111-1111-4111-8111-111111111111',
    generatedByModel: true,
  },
  metadata: { contentVersion: 1 },
  objectKey: 'artifacts/markdown.md',
  checksum: 'a'.repeat(64),
  createdByOperationId: null,
  generatedBy: 'model:artifact.generate:markdown-document',
  generationJobId: null,
  createdAt: '2026-08-01T00:02:00.000Z',
};

const webAppVersion = {
  ...version,
  generatedBy: 'model:artifact.generate:web_app',
};

describe('artifact-resource-projection（markdown_document）', () => {
  it('maps markdown_document as structured tier1 with authorized owner actions', () => {
    const resource = projectOwnedArtifactResource({
      notebookId: artifactBase.spaceId,
      artifact: {
        ...artifactBase,
        kind: 'markdown_document',
      },
      version,
      latestJob: null,
      accessRole: 'owner',
    });

    expect(resource).toMatchObject({
      representation: {
        kind: 'structured',
        mimeType: 'application/vnd.educanvas.markdown+text',
      },
      renderer: {
        rendererId: 'artifact.markdown-document',
        rendererVersion: 1,
      },
      trustTier: 'tier1',
      allowedActions: ['view', 'edit', 'regenerate', 'download', 'delete'],
    });
  });

  it('projects the exact immutable input versions without turning provenance into authority', () => {
    const generationJobId = '30000000-0000-4000-8000-000000000003';
    const resource = projectOwnedArtifactResource({
      notebookId: artifactBase.spaceId,
      artifact: { ...artifactBase, kind: 'markdown_document' },
      version: { ...version, generationJobId },
      latestJob: {
        id: generationJobId,
        artifactId: artifactBase.id,
        operationId: '40000000-0000-4000-8000-000000000004',
        status: 'succeeded',
        progress: 100,
        failureCode: null,
        params: {
          generation: { instruction: '根据资料生成文档' },
          provenance: {
            sources: [
              {
                assetId: 'asset-1',
                versionId: 'asset-version-1',
                representation: {
                  kind: 'text',
                  quality: 'structured',
                  variant: 'default',
                  producer: 'mineru',
                  producerVersion: 'v1',
                },
              },
              {
                assetId: 'asset-2',
                versionId: 'asset-version-2',
                representation: null,
              },
            ],
          },
        },
        checkpoint: {},
        queueJobKey: null,
      },
      accessRole: 'owner',
    });

    expect(resource.provenance.sourceResourceIds).toEqual([
      'asset-1',
      'asset-2',
    ]);
    expect(resource.provenance.sourceReferences).toEqual([
      { resourceId: 'asset-1', versionId: 'asset-version-1' },
      { resourceId: 'asset-2', versionId: 'asset-version-2' },
    ]);
    expect(resource.allowedActions).not.toContain('source.read');
  });

  it('does not attach provenance from a different generation job', () => {
    const resource = projectOwnedArtifactResource({
      notebookId: artifactBase.spaceId,
      artifact: { ...artifactBase, kind: 'markdown_document' },
      version: {
        ...version,
        generationJobId: '30000000-0000-4000-8000-000000000003',
      },
      latestJob: {
        id: '50000000-0000-4000-8000-000000000005',
        artifactId: artifactBase.id,
        operationId: null,
        status: 'succeeded',
        progress: 100,
        failureCode: null,
        params: {
          provenance: {
            sources: [
              { assetId: 'asset-stale', versionId: 'asset-version-stale' },
            ],
          },
        },
        checkpoint: {},
        queueJobKey: null,
      },
      accessRole: 'owner',
    });

    expect(resource.provenance.sourceResourceIds).toEqual([]);
    expect(resource.provenance.sourceReferences).toEqual([]);
  });

  it('uses the version-owning job for provenance when version and lifecycle jobs diverge', () => {
    const versionJobId = '30000000-0000-4000-8000-000000000013';
    const resource = projectOwnedArtifactResource({
      notebookId: artifactBase.spaceId,
      artifact: { ...artifactBase, kind: 'markdown_document' },
      version: {
        ...version,
        generationJobId: versionJobId,
      },
      latestJob: {
        id: '50000000-0000-4000-8000-000000000005',
        artifactId: artifactBase.id,
        operationId: null,
        status: 'failed',
        progress: 100,
        failureCode: 'generation_failed',
        params: {
          provenance: {
            sources: [
              {
                assetId: 'asset-stale',
                versionId: 'asset-version-stale',
              },
            ],
          },
        },
        checkpoint: {},
        queueJobKey: null,
      },
      versionJob: {
        id: versionJobId,
        artifactId: artifactBase.id,
        operationId: null,
        status: 'succeeded',
        progress: 100,
        failureCode: null,
        params: {
          provenance: {
            sources: [
              { assetId: 'asset-usable', versionId: 'asset-version-usable' },
            ],
          },
        },
        checkpoint: {},
        queueJobKey: null,
      },
      accessRole: 'owner',
    });

    expect(resource.provenance.sourceResourceIds).toEqual(['asset-usable']);
    expect(resource.provenance.sourceReferences).toEqual([
      { resourceId: 'asset-usable', versionId: 'asset-version-usable' },
    ]);
  });

  it('keeps viewer markdown_document to read-only actions', () => {
    const resource = projectOwnedArtifactResource({
      notebookId: artifactBase.spaceId,
      artifact: {
        ...artifactBase,
        kind: 'markdown_document',
      },
      version,
      latestJob: null,
      accessRole: 'viewer',
    });

    expect(resource.allowedActions).toEqual(['view', 'download']);
  });

  it.each(['failed', 'cancelled'] as const)(
    'keeps the committed version openable when the latest revision is %s',
    (status) => {
      const resource = projectOwnedArtifactResource({
        notebookId: artifactBase.spaceId,
        artifact: { ...artifactBase, kind: 'markdown_document' },
        version,
        latestJob: {
          id: '30000000-0000-4000-8000-000000000003',
          artifactId: artifactBase.id,
          operationId: null,
          status,
          progress: 100,
          failureCode: status === 'failed' ? 'generation_failed' : null,
          params: {},
          checkpoint: {},
          queueJobKey: null,
        },
        accessRole: 'owner',
      });

      expect(resource.status).toBe('ready');
      expect(resource.version?.sequence).toBe(1);
      expect(resource.allowedActions).toEqual([
        'view',
        'edit',
        'regenerate',
        'download',
        'delete',
      ]);
    },
  );

  it.each(['failed', 'cancelled'] as const)(
    'keeps a first-generation %s Artifact unavailable',
    (status) => {
      const resource = projectOwnedArtifactResource({
        notebookId: artifactBase.spaceId,
        artifact: {
          ...artifactBase,
          kind: 'markdown_document',
          latestVersion: 0,
        },
        version: null,
        latestJob: {
          id: '30000000-0000-4000-8000-000000000003',
          artifactId: artifactBase.id,
          operationId: null,
          status,
          progress: 100,
          failureCode: status === 'failed' ? 'generation_failed' : null,
          params: {},
          checkpoint: {},
          queueJobKey: null,
        },
        accessRole: 'owner',
      });

      expect(resource.status).toBe('failed');
      expect(resource.version).toBeNull();
      expect(resource.allowedActions).toEqual([]);
    },
  );

  it('rejects markdown_document trust mismatch', () => {
    expect(() =>
      projectOwnedArtifactResource({
        notebookId: artifactBase.spaceId,
        artifact: {
          ...artifactBase,
          kind: 'markdown_document',
          trustTier: 'tier2',
        },
        version,
        latestJob: null,
        accessRole: 'owner',
      }),
    ).toThrow(
      expect.objectContaining<Partial<ArtifactResourceProjectionError>>({
        code: 'resource_invalid',
      }),
    );
  });

  it('maps web_app as tier2 structured runtime artifact with runtime actions', () => {
    const resource = projectOwnedArtifactResource({
      notebookId: artifactBase.spaceId,
      artifact: {
        ...artifactBase,
        kind: 'web_app',
        trustTier: 'tier2',
      },
      version: webAppVersion,
      latestJob: null,
      accessRole: 'owner',
    });

    expect(resource).toMatchObject({
      trustTier: 'tier2',
      representation: {
        kind: 'interactive_app',
        mimeType: 'application/vnd.educanvas.web-app+json',
      },
      renderer: { rendererId: 'artifact.web-app', rendererVersion: 1 },
      allowedActions: [
        'view',
        'run',
        'cancel',
        'regenerate',
        'download',
        'delete',
        'annotate',
      ],
    });
  });

  it('keeps web_app viewer actions read/write-restricted with runtime control', () => {
    const resource = projectOwnedArtifactResource({
      notebookId: artifactBase.spaceId,
      artifact: {
        ...artifactBase,
        kind: 'web_app',
        trustTier: 'tier2',
      },
      version: webAppVersion,
      latestJob: null,
      accessRole: 'viewer',
    });

    expect(resource.allowedActions).toEqual([
      'view',
      'run',
      'cancel',
      'annotate',
    ]);
  });

  it('rejects web_app trust mismatch', () => {
    expect(() =>
      projectOwnedArtifactResource({
        notebookId: artifactBase.spaceId,
        artifact: {
          ...artifactBase,
          kind: 'web_app',
          trustTier: 'tier1',
        },
        version: webAppVersion,
        latestJob: null,
        accessRole: 'owner',
      }),
    ).toThrow(
      expect.objectContaining<Partial<ArtifactResourceProjectionError>>({
        code: 'resource_invalid',
      }),
    );
  });
});
