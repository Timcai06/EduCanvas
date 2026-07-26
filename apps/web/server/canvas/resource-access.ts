import 'server-only';

import {
  AssetAccessError,
  ArtifactOwnershipError,
  DrizzleAssetRepository,
  DrizzlePlatformArtifactRepository,
  getDb,
  requireNotebookAccess,
} from '@educanvas/db';
import type {
  CanvasResource,
  CanvasResourceErrorCode,
  CanvasResourceKind,
} from '@educanvas/canvas-protocol';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import {
  ArtifactResourceProjectionError,
  projectOwnedArtifactResource,
} from './artifact-resource-adapter';
import {
  projectOwnedSourceResource,
  SourceResourceProjectionError,
} from './source-resource-adapter';

export class CanvasResourceAccessError extends Error {
  constructor(
    readonly code: CanvasResourceErrorCode,
    readonly status: 404 | 422 | 503,
  ) {
    super(code);
    this.name = 'CanvasResourceAccessError';
  }
}

async function loadSource(input: {
  identity: AnonymousIdentity;
  notebookId: string;
  resourceId: string;
}): Promise<CanvasResource> {
  try {
    const repository = new DrizzleAssetRepository();
    const [snapshot, policy] = await Promise.all([
      repository.getOwnedSnapshot({
        ownerSubjectId: input.identity.studentId,
        spaceId: input.notebookId,
        assetId: input.resourceId,
      }),
      repository.getAccessPolicy({
        ownerSubjectId: input.identity.studentId,
        spaceId: input.notebookId,
        assetId: input.resourceId,
      }),
    ]);
    return projectOwnedSourceResource({
      assetId: snapshot.descriptor.assetId,
      notebookId: input.notebookId,
      title: snapshot.descriptor.displayName,
      mimeType:
        snapshot.version?.mimeType ?? snapshot.descriptor.mimeType ?? '',
      status: snapshot.descriptor.status,
      origin: snapshot.descriptor.origin,
      createdAt: snapshot.createdAt,
      accessRole: policy.role,
      isCreator: policy.isCreator,
      version: snapshot.version
        ? {
            versionId: snapshot.version.versionId,
            byteSize: snapshot.version.byteSize,
            checksum: snapshot.version.contentHash,
          }
        : null,
    });
  } catch (error) {
    if (error instanceof AssetAccessError) {
      throw new CanvasResourceAccessError('resource_not_found', 404);
    }
    if (error instanceof SourceResourceProjectionError) {
      throw new CanvasResourceAccessError(error.code, error.status);
    }
    throw error;
  }
}

async function loadArtifact(input: {
  identity: AnonymousIdentity;
  notebookId: string;
  resourceId: string;
}): Promise<CanvasResource> {
  try {
    const access = await requireNotebookAccess(getDb(), {
      notebookId: input.notebookId,
      trustedSubjectId: input.identity.studentId,
      requiredPermission: 'notebook.read',
    }).catch(() => null);
    if (!access) throw new ArtifactOwnershipError();
    const detail =
      await new DrizzlePlatformArtifactRepository().getArtifactDetail({
        artifactId: input.resourceId,
        trustedSubjectId: input.identity.studentId,
      });
    if (detail.artifact.spaceId !== input.notebookId) {
      throw new ArtifactOwnershipError();
    }
    return projectOwnedArtifactResource({
      notebookId: input.notebookId,
      artifact: detail.artifact,
      version: detail.latestVersion,
      latestJob: detail.latestJob,
      accessRole: access.role,
    });
  } catch (error) {
    if (error instanceof ArtifactOwnershipError) {
      throw new CanvasResourceAccessError('resource_not_found', 404);
    }
    if (error instanceof ArtifactResourceProjectionError) {
      throw new CanvasResourceAccessError(
        error.code === 'resource_not_found' ? 'resource_not_found' : error.code,
        error.code === 'resource_not_found' ? 404 : error.status,
      );
    }
    throw error;
  }
}

/**
 * 统一资源读取边界：可信身份与当前Notebook来自服务端会话，客户端只能选择资源种类和ID。
 */
export async function loadOwnedCanvasResource(input: {
  identity: AnonymousIdentity;
  notebookId: string;
  resourceKind: CanvasResourceKind;
  resourceId: string;
}): Promise<CanvasResource> {
  return input.resourceKind === 'source'
    ? loadSource(input)
    : loadArtifact(input);
}
