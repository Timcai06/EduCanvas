import 'server-only';

import {
  AssetAccessError,
  ArtifactOwnershipError,
  DrizzleAssetRepository,
  DrizzlePlatformArtifactRepository,
  requireNotebookAccess,
  type AssetSnapshot,
} from '@educanvas/db';
import { getDb } from '@educanvas/db/internal';
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

/**
 * 统一可预期的资源读取错误。404 同时掩盖“资源不存在 / 跨 Notebook / 无权访问”，
 * 防止客户端探测资源存在性；422/503 保留投影层给出的稳定错误码和状态。
 * 数据库等未知异常不包装为本类，由路由统一归一化为 503 resource_unavailable；
 * 本类只携带可安全返回浏览器的 code 与 status。
 */
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
 * 批量投影当前Notebook的Source列表。
 *
 * 与单资源读取的两点刻意差异：
 * 1. Notebook 成员资格只解析一次。角色是 Notebook 级事实，逐条再查会把列表变成 N+1；
 * 2. 无法投影的条目被跳过而不是抛错。列表里混进一个未知 MIME 的历史资产时，
 *    整页不能因此 503——调用方保留该条目的既有字段，只是拿不到 canvasResource。
 *    单资源端点仍按 renderer_not_found 显式拒绝，两处语义不同是有意的。
 *
 * 返回 assetId → CanvasResource 的映射，调用方自行决定如何与既有投影合并。
 */
export async function projectOwnedSourceResources(input: {
  identity: AnonymousIdentity;
  notebookId: string;
  snapshots: readonly AssetSnapshot[];
}): Promise<ReadonlyMap<string, CanvasResource>> {
  const projected = new Map<string, CanvasResource>();
  if (input.snapshots.length === 0) return projected;
  const access = await requireNotebookAccess(getDb(), {
    notebookId: input.notebookId,
    trustedSubjectId: input.identity.studentId,
    requiredPermission: 'notebook.read',
  }).catch(() => null);
  if (!access) throw new CanvasResourceAccessError('resource_not_found', 404);

  for (const snapshot of input.snapshots) {
    try {
      projected.set(
        snapshot.descriptor.assetId,
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
  return projected;
}

/**
 * 统一资源读取边界：可信身份与当前Notebook来自服务端会话，客户端只能选择
 * 资源种类和 ID。跨用户、跨 Notebook 与不存在的资源统一返回 404
 * （resource_not_found），避免暴露任何资源存在性信息。
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
