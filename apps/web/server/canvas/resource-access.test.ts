import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  mockGetOwnedSnapshot,
  mockGetAccessPolicy,
  mockRequireNotebookAccess,
  mockGetArtifactDetail,
} = vi.hoisted(() => ({
  mockGetOwnedSnapshot: vi.fn(),
  mockGetAccessPolicy: vi.fn(),
  mockRequireNotebookAccess: vi.fn(),
  mockGetArtifactDetail: vi.fn(),
}));

vi.mock('@educanvas/db', () => ({
  AssetAccessError: class AssetAccessError extends Error {
    constructor() {
      super('access denied');
      this.name = 'AssetAccessError';
    }
  },
  ArtifactOwnershipError: class ArtifactOwnershipError extends Error {
    constructor() {
      super('ownership');
      this.name = 'ArtifactOwnershipError';
    }
  },
  DrizzleAssetRepository: class {
    getOwnedSnapshot = mockGetOwnedSnapshot;
    getAccessPolicy = mockGetAccessPolicy;
  },
  DrizzlePlatformArtifactRepository: class {
    getArtifactDetail = mockGetArtifactDetail;
  },
  requireNotebookAccess: mockRequireNotebookAccess,
}));
vi.mock('@educanvas/db/internal', () => ({ getDb: vi.fn() }));

const { loadOwnedCanvasResource, projectOwnedSourceResources } =
  await import('./resource-access');

const identity = { token: 'test-token', studentId: 'user-1' };
const notebookId = '20000000-0000-4000-8000-000000000002';
const sourceId = '10000000-0000-4000-8000-000000000001';
const artifactId = '10000000-0000-4000-8000-000000000010';

describe('resource-access boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadOwnedCanvasResource - Source', () => {
    it('throws resource_not_found/404 for cross-user access', async () => {
      const { AssetAccessError } = await import('@educanvas/db');
      mockGetOwnedSnapshot.mockRejectedValue(new AssetAccessError());

      await expect(
        loadOwnedCanvasResource({
          identity: { token: 'attacker-token', studentId: 'attacker' },
          notebookId,
          resourceKind: 'source',
          resourceId: sourceId,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'resource_not_found',
          status: 404,
        }),
      );
      expect(mockGetOwnedSnapshot).toHaveBeenCalledWith({
        ownerSubjectId: 'attacker',
        spaceId: notebookId,
        assetId: sourceId,
      });
      expect(mockGetAccessPolicy).toHaveBeenCalledWith({
        ownerSubjectId: 'attacker',
        spaceId: notebookId,
        assetId: sourceId,
      });
    });

    it('throws resource_not_found/404 for cross-Notebook access', async () => {
      const { AssetAccessError } = await import('@educanvas/db');
      mockGetOwnedSnapshot.mockRejectedValue(new AssetAccessError());

      await expect(
        loadOwnedCanvasResource({
          identity,
          notebookId: 'different-notebook',
          resourceKind: 'source',
          resourceId: sourceId,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'resource_not_found',
          status: 404,
        }),
      );
      expect(mockGetOwnedSnapshot).toHaveBeenCalledWith({
        ownerSubjectId: identity.studentId,
        spaceId: 'different-notebook',
        assetId: sourceId,
      });
      expect(mockGetAccessPolicy).toHaveBeenCalledWith({
        ownerSubjectId: identity.studentId,
        spaceId: 'different-notebook',
        assetId: sourceId,
      });
    });

    it('throws resource_not_found/404 for missing source', async () => {
      const { AssetAccessError } = await import('@educanvas/db');
      mockGetOwnedSnapshot.mockRejectedValue(new AssetAccessError());

      await expect(
        loadOwnedCanvasResource({
          identity,
          notebookId,
          resourceKind: 'source',
          resourceId: 'nonexistent',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'resource_not_found',
          status: 404,
        }),
      );
      expect(mockGetOwnedSnapshot).toHaveBeenCalledWith({
        ownerSubjectId: identity.studentId,
        spaceId: notebookId,
        assetId: 'nonexistent',
      });
      expect(mockGetAccessPolicy).toHaveBeenCalledWith({
        ownerSubjectId: identity.studentId,
        spaceId: notebookId,
        assetId: 'nonexistent',
      });
    });
  });

  describe('loadOwnedCanvasResource - Artifact', () => {
    it.each(['failed', 'cancelled'] as const)(
      'uses version-bound provenance when latest revision is %s',
      async (status) => {
        mockRequireNotebookAccess.mockResolvedValue({ role: 'viewer' });
        mockGetArtifactDetail.mockResolvedValue({
          artifact: {
            id: artifactId,
            spaceId: notebookId,
            conversationId: null,
            ownerSubjectId: identity.studentId,
            kind: 'mind_map',
            trustTier: 'tier1',
            title: '回归产物',
            status: 'active',
            latestVersion: 1,
            createdAt: '2026-08-13T00:00:00.000Z',
            updatedAt: '2026-08-13T00:01:00.000Z',
          },
          latestVersion: {
            id: 'version-v1',
            artifactId,
            version: 1,
            content: { contentVersion: 1, nodes: [] },
            metadata: null,
            objectKey: null,
            checksum: null,
            generatedBy: 'model:artifact.generate:v1',
            createdByOperationId: null,
            generationJobId: 'generation-job-v1',
            createdAt: '2026-08-13T00:01:00.000Z',
          },
          latestJob: {
            id: 'revision-job-2',
            artifactId,
            operationId: null,
            status,
            progress: 100,
            failureCode: status === 'failed' ? 'timeout' : null,
            params: {
              provenance: {
                sources: [{ assetId: 'bad-source', versionId: 'bad-version' }],
              },
            },
            checkpoint: {},
            queueJobKey: null,
          },
          versionJob: {
            id: 'generation-job-v1',
            artifactId,
            operationId: null,
            status: 'succeeded',
            progress: 100,
            failureCode: null,
            params: {
              provenance: {
                sources: [
                  {
                    assetId: 'usable-source',
                    versionId: 'usable-version',
                  },
                ],
              },
            },
            checkpoint: {},
            queueJobKey: null,
          },
        });

        const projected = await loadOwnedCanvasResource({
          identity,
          notebookId,
          resourceKind: 'artifact',
          resourceId: artifactId,
        });

        expect(projected.provenance.sourceResourceIds).toEqual([
          'usable-source',
        ]);
        expect(projected.provenance.sourceReferences).toEqual([
          { resourceId: 'usable-source', versionId: 'usable-version' },
        ]);
      },
    );

    it('throws resource_not_found/404 for cross-Notebook artifact', async () => {
      mockRequireNotebookAccess.mockResolvedValue({ role: 'owner' });
      mockGetArtifactDetail.mockResolvedValue({
        artifact: {
          id: artifactId,
          spaceId: 'different-notebook',
          kind: 'mind_map',
          trustTier: 'tier1',
          title: '测试产物',
          status: 'active',
          latestVersion: 1,
        },
        latestVersion: { id: 'v1', version: 1, checksum: 'c'.repeat(64) },
        latestJob: null,
      });

      await expect(
        loadOwnedCanvasResource({
          identity,
          notebookId,
          resourceKind: 'artifact',
          resourceId: artifactId,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'resource_not_found',
          status: 404,
        }),
      );
    });

    it('throws resource_not_found/404 for unauthorized artifact access', async () => {
      mockRequireNotebookAccess.mockRejectedValue(new Error('access denied'));

      await expect(
        loadOwnedCanvasResource({
          identity,
          notebookId,
          resourceKind: 'artifact',
          resourceId: artifactId,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'resource_not_found',
          status: 404,
        }),
      );
    });

    it('throws resource_not_found/404 for missing artifact', async () => {
      const { ArtifactOwnershipError } = await import('@educanvas/db');
      mockRequireNotebookAccess.mockResolvedValue({ role: 'owner' });
      mockGetArtifactDetail.mockRejectedValue(new ArtifactOwnershipError());

      await expect(
        loadOwnedCanvasResource({
          identity,
          notebookId,
          resourceKind: 'artifact',
          resourceId: 'nonexistent',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'resource_not_found',
          status: 404,
        }),
      );
    });

    it('does not let an Artifact provenance reference authorize a foreign Source', async () => {
      const { AssetAccessError } = await import('@educanvas/db');
      const foreignSourceId = '90000000-0000-4000-8000-000000000009';
      mockRequireNotebookAccess.mockResolvedValue({ role: 'viewer' });
      mockGetArtifactDetail.mockResolvedValue({
        artifact: {
          id: artifactId,
          spaceId: notebookId,
          conversationId: null,
          ownerSubjectId: identity.studentId,
          kind: 'mind_map',
          trustTier: 'tier1',
          title: '引用外部来源的产物',
          status: 'active',
          latestVersion: 1,
          createdAt: '2026-08-13T00:00:00.000Z',
          updatedAt: '2026-08-13T00:01:00.000Z',
        },
        latestVersion: {
          id: '90000000-0000-4000-8000-000000000011',
          artifactId,
          version: 1,
          content: {},
          metadata: null,
          objectKey: null,
          checksum: null,
          generatedBy: 'model:fixture',
          createdByOperationId: null,
          generationJobId: '90000000-0000-4000-8000-000000000012',
          createdAt: '2026-08-13T00:01:00.000Z',
        },
        latestJob: {
          id: '90000000-0000-4000-8000-000000000012',
          artifactId,
          operationId: null,
          status: 'succeeded',
          progress: 100,
          failureCode: null,
          params: {
            provenance: {
              sources: [
                {
                  assetId: foreignSourceId,
                  versionId: '90000000-0000-4000-8000-000000000010',
                },
              ],
            },
          },
          checkpoint: {},
          queueJobKey: null,
        },
      });

      const projected = await loadOwnedCanvasResource({
        identity,
        notebookId,
        resourceKind: 'artifact',
        resourceId: artifactId,
      });
      expect(projected.provenance.sourceResourceIds).toContain(foreignSourceId);

      mockGetOwnedSnapshot.mockRejectedValue(new AssetAccessError());
      mockGetAccessPolicy.mockRejectedValue(new AssetAccessError());
      await expect(
        loadOwnedCanvasResource({
          identity,
          notebookId,
          resourceKind: 'source',
          resourceId: foreignSourceId,
        }),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'resource_not_found', status: 404 }),
      );
    });
  });

  describe('projectOwnedSourceResources', () => {
    it('throws resource_not_found/404 for unauthorized notebook access', async () => {
      mockRequireNotebookAccess.mockRejectedValue(new Error('access denied'));

      await expect(
        projectOwnedSourceResources({
          identity,
          notebookId,
          snapshots: [
            {
              descriptor: {
                assetId: sourceId,
                scope: 'space',
                kind: 'document',
                origin: 'upload',
                displayName: '测试',
                mimeType: 'application/pdf',
                status: 'ready',
                currentVersionId: 'v1',
              },
              version: {
                assetId: sourceId,
                versionId: 'v1',
                kind: 'document',
                mimeType: 'application/pdf',
                byteSize: 100,
                contentHash: 'a'.repeat(64),
                status: 'ready',
              },
              processing: null,
              createdAt: '2026-07-25T00:00:00.000Z',
              updatedAt: '2026-07-25T00:00:00.000Z',
            },
          ],
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'resource_not_found',
          status: 404,
        }),
      );
    });

    it('skips invalid sources without throwing', async () => {
      mockRequireNotebookAccess.mockResolvedValue({ role: 'owner' });

      const result = await projectOwnedSourceResources({
        identity,
        notebookId,
        snapshots: [
          {
            descriptor: {
              assetId: sourceId,
              scope: 'space',
              kind: 'document',
              origin: 'upload',
              displayName: '无效来源',
              mimeType: 'application/x-unknown',
              status: 'ready',
              currentVersionId: 'v1',
            },
            version: {
              assetId: sourceId,
              versionId: 'v1',
              kind: 'document',
              mimeType: 'application/x-unknown',
              byteSize: 100,
              contentHash: 'a'.repeat(64),
              status: 'ready',
            },
            processing: null,
            createdAt: '2026-07-25T00:00:00.000Z',
            updatedAt: '2026-07-25T00:00:00.000Z',
          },
        ],
      });

      expect(result.size).toBe(0);
    });
  });
});
