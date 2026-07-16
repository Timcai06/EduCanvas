import { randomUUID } from 'node:crypto';
import {
  assetDescriptorSchema,
  assetVersionDescriptorSchema,
  assetVersionReferenceSchema,
  canTransitionAssetStatus,
  type AssetDescriptor,
  type AssetKind,
  type AssetScope,
  type AssetVersionDescriptor,
  type AssetVersionReference,
} from '@educanvas/agent-core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from './client';
import { assets, assetVersions } from './schema';

type Database = ReturnType<typeof getDb>;

const OWNER_ID = /^.{1,160}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

export interface AssetSnapshot {
  descriptor: AssetDescriptor;
  version: AssetVersionDescriptor | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaterializedAssetVersion {
  reference: AssetVersionReference;
  displayName: string;
  mimeType: string;
  byteSize: number;
  extractedText: string | null;
}

export interface CreateUploadedAssetInput {
  ownerSubjectId: string;
  spaceId: string;
  scope: AssetScope;
  kind: Extract<AssetKind, 'image' | 'document'>;
  displayName: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  storageKey: string;
  extractedText?: string | null;
  outcome: { status: 'ready' } | { status: 'failed'; failureCode: string };
  now?: Date;
}

export class AssetAccessError extends Error {
  readonly code = 'asset_not_available';

  constructor() {
    super('Asset不存在、不可用或不属于当前空间');
    this.name = 'AssetAccessError';
  }
}

export class AssetPersistenceError extends Error {
  readonly code = 'asset_persistence_failed';

  constructor(message: string) {
    super(message);
    this.name = 'AssetPersistenceError';
  }
}

function requireOwner(value: string): string {
  if (!OWNER_ID.test(value)) throw new AssetAccessError();
  return value;
}

function requireUuid(value: string): string {
  if (!UUID.test(value)) throw new AssetAccessError();
  return value;
}

function requireText(value: string, label: string, max: number): string {
  const normalized = value.normalize('NFC').trim();
  if (!normalized || normalized.length > max) {
    throw new AssetPersistenceError(`${label}格式或长度无效`);
  }
  return normalized;
}

function toSnapshot(
  asset: typeof assets.$inferSelect,
  version: typeof assetVersions.$inferSelect | null,
): AssetSnapshot {
  return {
    descriptor: assetDescriptorSchema.parse({
      assetId: asset.id,
      scope: asset.scope,
      kind: asset.kind,
      origin: asset.origin,
      displayName: asset.displayName,
      mimeType: asset.mimeType,
      status: asset.status,
      currentVersionId: asset.currentVersionId,
    }),
    version: version
      ? assetVersionDescriptorSchema.parse({
          assetId: version.assetId,
          versionId: version.id,
          kind: version.kind,
          mimeType: version.mimeType,
          byteSize: version.byteSize,
          contentHash: version.contentHash,
          status: version.status,
        })
      : null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

/** 通用 Asset 仓储；K12 只负责把可信学生与当前 lesson session 映射成 owner/space。 */
export class DrizzleAssetRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createUploaded(
    input: CreateUploadedAssetInput,
  ): Promise<AssetSnapshot> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const displayName = requireText(input.displayName, 'displayName', 300);
    const mimeType = requireText(input.mimeType, 'mimeType', 255).toLowerCase();
    const storageKey = requireText(input.storageKey, 'storageKey', 1_024);
    if (/^https?:\/\//i.test(storageKey)) {
      throw new AssetPersistenceError('storageKey不能是公开URL');
    }
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 0 ||
      input.byteSize > 50 * 1024 * 1024
    ) {
      throw new AssetPersistenceError('byteSize超出允许范围');
    }
    if (!SHA256.test(input.contentHash)) {
      throw new AssetPersistenceError('contentHash必须是小写SHA-256');
    }
    if (!canTransitionAssetStatus('pending', 'processing')) {
      throw new AssetPersistenceError('Asset状态机不可用');
    }

    const now = input.now ?? new Date();
    const assetId = randomUUID();
    const versionId = randomUUID();
    const versionStatus = input.outcome.status;

    return this.database.transaction(async (transaction) => {
      const [createdAsset] = await transaction
        .insert(assets)
        .values({
          id: assetId,
          ownerSubjectId,
          spaceId,
          scope: input.scope,
          kind: input.kind,
          origin: 'upload',
          displayName,
          mimeType,
          status: 'processing',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const [createdVersion] = await transaction
        .insert(assetVersions)
        .values({
          id: versionId,
          assetId,
          kind: input.kind,
          mimeType,
          byteSize: input.byteSize,
          contentHash: input.contentHash,
          status: versionStatus,
          storageKey,
          extractedText: input.extractedText?.trim() || null,
          failureCode:
            input.outcome.status === 'failed'
              ? requireText(input.outcome.failureCode, 'failureCode', 128)
              : null,
          createdAt: now,
        })
        .returning();
      if (!createdAsset || !createdVersion) {
        throw new AssetPersistenceError('Asset或版本写入失败');
      }

      const nextAssetStatus = versionStatus === 'ready' ? 'ready' : 'failed';
      if (!canTransitionAssetStatus('processing', nextAssetStatus)) {
        throw new AssetPersistenceError('Asset状态转换无效');
      }
      const [updatedAsset] = await transaction
        .update(assets)
        .set({
          status: nextAssetStatus,
          currentVersionId: versionStatus === 'ready' ? versionId : null,
          updatedAt: now,
        })
        .where(eq(assets.id, assetId))
        .returning();
      if (!updatedAsset) throw new AssetPersistenceError('Asset状态更新失败');
      return toSnapshot(updatedAsset, createdVersion);
    });
  }

  async listOwnedSpace(input: {
    ownerSubjectId: string;
    spaceId: string;
    limit?: number;
  }): Promise<readonly AssetSnapshot[]> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
    const rows = await this.database
      .select({ asset: assets, version: assetVersions })
      .from(assets)
      .leftJoin(assetVersions, eq(assetVersions.id, assets.currentVersionId))
      .where(
        and(
          eq(assets.ownerSubjectId, ownerSubjectId),
          eq(assets.spaceId, spaceId),
        ),
      )
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(limit);
    return rows.map(({ asset, version }) => toSnapshot(asset, version));
  }

  async materializeOwnedReferences(input: {
    ownerSubjectId: string;
    spaceId: string;
    references: readonly AssetVersionReference[];
  }): Promise<readonly MaterializedAssetVersion[]> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const references = input.references.map((reference) =>
      assetVersionReferenceSchema.parse(reference),
    );
    if (references.length === 0) return [];

    const versionIds = references.map((reference) => reference.versionId);
    const rows = await this.database
      .select({ asset: assets, version: assetVersions })
      .from(assetVersions)
      .innerJoin(assets, eq(assets.id, assetVersions.assetId))
      .where(
        and(
          eq(assets.ownerSubjectId, ownerSubjectId),
          eq(assets.spaceId, spaceId),
          eq(assets.status, 'ready'),
          eq(assetVersions.status, 'ready'),
          inArray(assetVersions.id, versionIds),
        ),
      );
    const byVersion = new Map(rows.map((row) => [row.version.id, row]));
    return references.map((reference) => {
      const row = byVersion.get(reference.versionId);
      if (
        !row ||
        row.asset.id !== reference.assetId ||
        row.asset.currentVersionId !== reference.versionId ||
        row.asset.kind !== reference.kind ||
        row.version.kind !== reference.kind
      ) {
        throw new AssetAccessError();
      }
      return {
        reference,
        displayName: row.asset.displayName,
        mimeType: row.version.mimeType,
        byteSize: row.version.byteSize,
        extractedText: row.version.extractedText,
      };
    });
  }
}
