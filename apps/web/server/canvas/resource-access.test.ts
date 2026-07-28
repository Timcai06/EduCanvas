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
  getDb: vi.fn(),
}));

const {
  CanvasResourceAccessError,
  loadOwnedCanvasResource,
  projectOwnedSourceResources,
} = await import('./resource-access');

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
