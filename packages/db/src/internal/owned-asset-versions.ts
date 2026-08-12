import type {
  AssetVersionReference,
  RepresentationQuality,
} from '@educanvas/agent-core';
import { and, eq, inArray } from 'drizzle-orm';
import { assets, assetRepresentations, assetVersions } from '../schema';
import { defaultRepresentationOrderBy } from '../asset-representation-repository';
import { requireNotebookAccess } from '../notebook-access';
import type { DatabaseExecutor } from './database-types';
import { isUuid } from './identifiers';

export class OwnedAssetVersionError extends Error {
  constructor(readonly reason: 'invalid_reference' | 'not_available') {
    super(reason);
    this.name = 'OwnedAssetVersionError';
  }
}

/** ADR-0026 第 5 节：默认 text 表示身份（冻结用，不含任何存储位置）。 */
export interface OwnedTextRepresentationIdentity {
  /* 查询已限定 kind='text'，这里收窄为字面量，与 agent-runtime 契约对齐。 */
  kind: 'text';
  quality: RepresentationQuality;
  variant: string;
  producer: string;
  producerVersion: string;
}

/**
 * ADR-0026 第 5 节：structured 派生文件的源定位（读取用，不进 Context Snapshot）。
 * 由物化层按 checksum 核对后作为模型文本源；degraded 与旧资产不暴露（走
 * extractedText 兼容，mirror 与派生文件同事务写入内容等价）。
 */
export interface DerivedTextSource {
  storageKey: string;
  checksumSha256: string;
}

export async function loadOwnedReadyAssetVersions(
  executor: DatabaseExecutor,
  input: {
    ownerSubjectId: string;
    spaceId: string;
    references: readonly AssetVersionReference[];
  },
) {
  if (
    !isUuid(input.spaceId) ||
    input.references.some(
      (reference) => !isUuid(reference.assetId) || !isUuid(reference.versionId),
    )
  ) {
    throw new OwnedAssetVersionError('invalid_reference');
  }
  if (input.references.length === 0) return [];
  await requireNotebookAccess(executor, {
    notebookId: input.spaceId,
    trustedSubjectId: input.ownerSubjectId,
    requiredPermission: 'notebook.read',
  }).catch(() => {
    throw new OwnedAssetVersionError('not_available');
  });

  const rows = await executor
    .select({ asset: assets, version: assetVersions })
    .from(assetVersions)
    .innerJoin(assets, eq(assets.id, assetVersions.assetId))
    .where(
      and(
        eq(assets.spaceId, input.spaceId),
        eq(assets.status, 'ready'),
        eq(assetVersions.status, 'ready'),
        inArray(
          assetVersions.id,
          input.references.map((reference) => reference.versionId),
        ),
      ),
    );
  /* ADR-0026：批量带出每个版本的默认 text 表示身份（defaultRepresentationOrderBy
     确定性选择；无 text 行时为 null）。身份不含对象键，仅供 Context Snapshot 冻结。 */
  const versionIds = rows.map((row) => row.version.id);
  const textRepresentations =
    versionIds.length === 0
      ? []
      : await executor
          .selectDistinctOn([assetRepresentations.assetVersionId], {
            assetVersionId: assetRepresentations.assetVersionId,
            kind: assetRepresentations.kind,
            variant: assetRepresentations.variant,
            producer: assetRepresentations.producer,
            producerVersion: assetRepresentations.producerVersion,
            quality: assetRepresentations.quality,
            derivedStorageKey: assetRepresentations.derivedStorageKey,
            checksum: assetRepresentations.checksum,
          })
          .from(assetRepresentations)
          .where(
            and(
              eq(assetRepresentations.kind, 'text'),
              inArray(assetRepresentations.assetVersionId, versionIds),
            ),
          )
          .orderBy(
            assetRepresentations.assetVersionId,
            ...defaultRepresentationOrderBy(),
          );
  const byVersion = new Map(rows.map((row) => [row.version.id, row]));
  const representationByVersion = new Map(
    textRepresentations.map((representation) => [
      representation.assetVersionId,
      representation,
    ]),
  );
  return input.references.map((reference) => {
    const row = byVersion.get(reference.versionId);
    if (
      !row ||
      row.asset.id !== reference.assetId ||
      row.asset.currentVersionId !== reference.versionId ||
      row.asset.kind !== reference.kind ||
      row.version.kind !== reference.kind
    ) {
      throw new OwnedAssetVersionError('not_available');
    }
    const identity = representationByVersion.get(reference.versionId);
    const textRepresentation = identity
      ? {
          kind: identity.kind as 'text',
          quality: identity.quality as RepresentationQuality,
          variant: identity.variant,
          producer: identity.producer,
          producerVersion: identity.producerVersion,
        }
      : null;
    return {
      ...row,
      textRepresentation,
      /* ADR-0026 第 5 节：仅 structured 且带派生文件时暴露源定位；
         旧 default text 行（createUploaded 同步正文）与 degraded 均无。 */
      derivedTextSource:
        textRepresentation?.quality === 'structured' &&
        identity!.derivedStorageKey &&
        identity!.checksum
          ? {
              storageKey: identity!.derivedStorageKey,
              checksumSha256: identity!.checksum,
            }
          : null,
    };
  });
}
