import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayCanvasResourceService } from './canvas-resource-service';

const requireNotebookAccess = vi.hoisted(() =>
  vi.fn(async () => ({ role: 'owner' })),
);
const listAccessibleSpacePage = vi.hoisted(() =>
  vi.fn(async () => ({ items: [] })),
);
const listSpaceArtifacts = vi.hoisted(() =>
  vi.fn(async () => [{ id: 'artifact:1', title: 'v1', latestVersion: 2 }]),
);
const getArtifactDetail = vi.hoisted(() => vi.fn());
const projectOwnedArtifactResource = vi.hoisted(() =>
  vi.fn(
    (input: {
      artifact: { id: string };
      version: { id: string } | null;
      versionJob: { id: string } | null;
      latestJob?: { id: string; status?: string };
    }) => ({
      resourceId: input.artifact.id,
      provenance: {
        sourceResourceIds: input.versionJob ? [input.versionJob.id] : [],
      },
    }),
  ),
);

vi.mock('@educanvas/db', async () => {
  const actual =
    await vi.importActual<typeof import('@educanvas/db')>('@educanvas/db');
  return {
    ...actual,
    DrizzleAssetRepository: class {
      listAccessibleSpacePage = listAccessibleSpacePage;
      getOwnedSnapshot = vi.fn();
    },
    DrizzlePlatformArtifactRepository: class {
      listSpaceArtifacts = listSpaceArtifacts;
      getArtifactDetail = getArtifactDetail;
    },
    ArtifactOwnershipError: class extends Error {},
    requireNotebookAccess,
  };
});

vi.mock('@educanvas/db/internal', () => ({
  getDb: vi.fn(),
}));

vi.mock('@educanvas/canvas-protocol/server', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@educanvas/canvas-protocol/server')>();
  return {
    ...original,
    projectOwnedArtifactResource,
  };
});

const sharedVersion = {
  id: 'version:1',
  artifactId: 'artifact:1',
  version: 2,
  content: { gradingKey: 'g', providerBody: 'x' },
  metadata: null,
  objectKey: 'k',
  checksum: 'c'.repeat(64),
  createdByOperationId: null,
  generatedBy: 'agent',
  generationJobId: 'revision-owning-job',
  createdAt: '2026-08-10T00:00:00.000Z',
};
const successfulVersionJob = { id: 'revision-owning-job' };
const failedLatestJob = { id: 'latest-revision-job' };

beforeEach(() => {
  vi.clearAllMocks();
  getArtifactDetail.mockReset();
  listSpaceArtifacts.mockReset();
  listAccessibleSpacePage.mockReset().mockResolvedValue({ items: [] });
});

describe('GatewayCanvasResourceService', () => {
  it('passes versionJob into list projection so failed latest revision keeps version provenance', async () => {
    getArtifactDetail.mockResolvedValue({
      artifact: { id: 'artifact:1', spaceId: 'notebook:1' },
      latestVersion: sharedVersion,
      versionJob: successfulVersionJob,
      latestJob: { ...failedLatestJob, status: 'failed' },
    });
    listSpaceArtifacts.mockResolvedValue([
      {
        id: 'artifact:1',
        title: 'v1',
        latestVersion: 2,
      },
    ]);

    const service = new GatewayCanvasResourceService();
    const resources = await service.list({
      trustedSubjectId: 'user:1',
      notebookId: 'notebook:1',
    });

    expect(projectOwnedArtifactResource).toHaveBeenCalledOnce();
    const input = projectOwnedArtifactResource.mock.calls[0]?.[0];
    expect(input).toBeDefined();
    if (!input) return;
    expect(input.versionJob).toEqual(successfulVersionJob);
    expect(input.latestJob).toEqual(
      expect.objectContaining({ id: failedLatestJob.id }),
    );
    expect(
      (resources[0] as { provenance: { sourceResourceIds: string[] } })
        .provenance.sourceResourceIds,
    ).toEqual([successfulVersionJob.id]);
  });

  it('passes versionJob into get projection for a cancellable failed revision', async () => {
    getArtifactDetail.mockResolvedValue({
      artifact: { id: 'artifact:1', spaceId: 'notebook:1' },
      latestVersion: sharedVersion,
      versionJob: successfulVersionJob,
      latestJob: {
        ...failedLatestJob,
        status: 'cancelled',
        failureCode: 'client_cancelled',
      },
    });

    const service = new GatewayCanvasResourceService();
    const resource = await service.get({
      trustedSubjectId: 'user:1',
      notebookId: 'notebook:1',
      resourceKind: 'artifact',
      resourceId: 'artifact:1',
    });

    expect(projectOwnedArtifactResource).toHaveBeenCalledOnce();
    const input = projectOwnedArtifactResource.mock.calls[0]?.[0];
    expect(input).toBeDefined();
    if (!input) return;
    expect(input.versionJob).toEqual(successfulVersionJob);
    expect(input.version).toEqual(sharedVersion);
    expect(
      (resource as { provenance: { sourceResourceIds: string[] } }).provenance
        .sourceResourceIds,
    ).toEqual([successfulVersionJob.id]);
    expect(input.latestJob).toEqual(
      expect.objectContaining({ status: 'cancelled' }),
    );
  });
});
