import {
  AssetAccessError,
  ArtifactOwnershipError,
  DrizzleAssetRepository,
  DrizzlePlatformArtifactRepository,
  requireNotebookAccess,
} from '@educanvas/db';
import { getDb } from '@educanvas/db/internal';
import {
  ArtifactResourceProjectionError,
  projectOwnedArtifactResource,
  projectOwnedSourceResource,
  SourceResourceProjectionError,
} from '@educanvas/canvas-protocol/server';
import type {
  CanvasResource,
  CanvasResourceKind,
} from '@educanvas/canvas-protocol';

export class GatewayCanvasResourceError extends Error {
  constructor(
    readonly code: 'resource_not_found' | 'resource_invalid',
    readonly status: 404 | 422,
  ) {
    super(code);
    this.name = 'GatewayCanvasResourceError';
  }
}

export class GatewayCanvasResourceService {
  constructor(
    private readonly assets = new DrizzleAssetRepository(),
    private readonly artifacts = new DrizzlePlatformArtifactRepository(),
  ) {}

  private async access(input: {
    trustedSubjectId: string;
    notebookId: string;
  }) {
    return requireNotebookAccess(getDb(), {
      notebookId: input.notebookId,
      trustedSubjectId: input.trustedSubjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => {
      throw new GatewayCanvasResourceError('resource_not_found', 404);
    });
  }

  async list(input: {
    trustedSubjectId: string;
    notebookId: string;
  }): Promise<readonly CanvasResource[]> {
    const access = await this.access(input);
    const [sourcePage, artifactList] = await Promise.all([
      this.assets.listAccessibleSpacePage({
        ownerSubjectId: input.trustedSubjectId,
        spaceId: input.notebookId,
        limit: 50,
      }),
      this.artifacts.listSpaceArtifacts({
        spaceId: input.notebookId,
        trustedSubjectId: input.trustedSubjectId,
        limit: 50,
      }),
    ]);

    const projected: CanvasResource[] = [];
    for (const snapshot of sourcePage.items) {
      try {
        projected.push(
          projectOwnedSourceResource({
            assetId: snapshot.descriptor.assetId,
            notebookId: input.notebookId,
            title: snapshot.descriptor.displayName,
            mimeType:
              snapshot.version?.mimeType ?? snapshot.descriptor.mimeType ?? '',
            status: snapshot.descriptor.status,
            origin: snapshot.descriptor.origin,
            createdAt: snapshot.createdAt,
            accessRole: access.role,
            version: snapshot.version
              ? {
                  versionId: snapshot.version.versionId,
                  byteSize: snapshot.version.byteSize,
                  checksum: snapshot.version.contentHash,
                }
              : null,
          }),
        );
      } catch (error) {
        if (error instanceof SourceResourceProjectionError) continue;
        throw error;
      }
    }

    // The list row intentionally omits version and job details. Keep this fan-out
    // bounded by the page limit so projections use authoritative current state.
    const artifactDetails = await Promise.all(
      artifactList.map((artifact) =>
        this.artifacts.getArtifactDetail({
          artifactId: artifact.id,
          trustedSubjectId: input.trustedSubjectId,
        }),
      ),
    );
    for (const detail of artifactDetails) {
      try {
        projected.push(
          projectOwnedArtifactResource({
            notebookId: input.notebookId,
            artifact: detail.artifact,
            version: detail.latestVersion,
            latestJob: detail.latestJob,
            versionJob: detail.versionJob,
            accessRole: access.role,
          }),
        );
      } catch (error) {
        if (error instanceof ArtifactResourceProjectionError) continue;
        throw error;
      }
    }

    return projected
      .sort((left, right) =>
        right.provenance.createdAt.localeCompare(left.provenance.createdAt),
      )
      .slice(0, 100);
  }

  async get(input: {
    trustedSubjectId: string;
    notebookId: string;
    resourceKind: CanvasResourceKind;
    resourceId: string;
  }): Promise<CanvasResource> {
    const access = await this.access(input);
    try {
      if (input.resourceKind === 'source') {
        const snapshot = await this.assets.getOwnedSnapshot({
          ownerSubjectId: input.trustedSubjectId,
          spaceId: input.notebookId,
          assetId: input.resourceId,
        });
        return projectOwnedSourceResource({
          assetId: snapshot.descriptor.assetId,
          notebookId: input.notebookId,
          title: snapshot.descriptor.displayName,
          mimeType:
            snapshot.version?.mimeType ?? snapshot.descriptor.mimeType ?? '',
          status: snapshot.descriptor.status,
          origin: snapshot.descriptor.origin,
          createdAt: snapshot.createdAt,
          accessRole: access.role,
          version: snapshot.version
            ? {
                versionId: snapshot.version.versionId,
                byteSize: snapshot.version.byteSize,
                checksum: snapshot.version.contentHash,
              }
            : null,
        });
      }

      const detail = await this.artifacts.getArtifactDetail({
        artifactId: input.resourceId,
        trustedSubjectId: input.trustedSubjectId,
      });
      if (detail.artifact.spaceId !== input.notebookId) {
        throw new ArtifactOwnershipError();
      }
      return projectOwnedArtifactResource({
        notebookId: input.notebookId,
        artifact: detail.artifact,
        version: detail.latestVersion,
        latestJob: detail.latestJob,
        versionJob: detail.versionJob,
        accessRole: access.role,
      });
    } catch (error) {
      if (
        error instanceof AssetAccessError ||
        error instanceof ArtifactOwnershipError
      ) {
        throw new GatewayCanvasResourceError('resource_not_found', 404);
      }
      if (
        error instanceof SourceResourceProjectionError ||
        error instanceof ArtifactResourceProjectionError
      ) {
        throw new GatewayCanvasResourceError('resource_invalid', 422);
      }
      throw error;
    }
  }
}
