import type { AssetVersionReference } from '@educanvas/agent-core';
import { and, eq, inArray } from 'drizzle-orm';
import { assets, assetVersions } from '../schema';
import type { DatabaseExecutor } from './database-types';
import { isUuid } from './identifiers';

export class OwnedAssetVersionError extends Error {
  constructor(readonly reason: 'invalid_reference' | 'not_available') {
    super(reason);
    this.name = 'OwnedAssetVersionError';
  }
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

  const rows = await executor
    .select({ asset: assets, version: assetVersions })
    .from(assetVersions)
    .innerJoin(assets, eq(assets.id, assetVersions.assetId))
    .where(
      and(
        eq(assets.ownerSubjectId, input.ownerSubjectId),
        eq(assets.spaceId, input.spaceId),
        eq(assets.status, 'ready'),
        eq(assetVersions.status, 'ready'),
        inArray(
          assetVersions.id,
          input.references.map((reference) => reference.versionId),
        ),
      ),
    );
  const byVersion = new Map(rows.map((row) => [row.version.id, row]));
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
    return row;
  });
}
