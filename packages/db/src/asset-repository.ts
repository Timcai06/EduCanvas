import { randomUUID } from 'node:crypto';
import {
  assetDescriptorSchema,
  assetOriginSchema,
  assetVersionDescriptorSchema,
  assetVersionReferenceSchema,
  canTransitionAssetStatus,
  type AssetDescriptor,
  type AssetKind,
  type AssetOrigin,
  type AssetScope,
  type AssetVersionDescriptor,
  type AssetVersionReference,
} from '@educanvas/agent-core';
import type { NotebookMembershipRole } from '@educanvas/gateway-core';
import { and, desc, eq, isNotNull, lt, ne, or } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import {
  loadOwnedReadyAssetVersions,
  OwnedAssetVersionError,
} from './internal/owned-asset-versions';
import { requireNotebookAccess } from './notebook-access';
import {
  boundedPageLimit,
  type CursorPage,
  type TemporalIdCursor,
} from './pagination';
import {
  assetProcessingJobs,
  assetRepresentations,
  assets,
  assetVersions,
  notebookAssetBindings,
  objectDeletionOutbox,
} from './schema';

type Database = ReturnType<typeof getDb>;

const OWNER_ID = /^.{1,160}$/u;
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

export interface AssetAccessPolicy {
  role: NotebookMembershipRole;
}

/**
 * 仅供服务端对象存储 Adapter 使用的当前版本。
 * storageKey 绝不能进入 AssetSnapshot、公共 API、模型 Context 或客户端状态。
 */
export interface OwnedStoredAssetVersion {
  assetId: string;
  versionId: string;
  displayName: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  origin: AssetOrigin;
  createdAt: string;
  storageKey: string;
  extractedText: string | null;
}

export interface CreateUploadedAssetInput {
  ownerSubjectId: string;
  spaceId: string;
  scope: AssetScope;
  kind: Extract<AssetKind, 'image' | 'document' | 'link'>;
  /** 缺省 upload;链接导入传 url_import,溯源与上传物理区分。 */
  origin?: Extract<AssetOrigin, 'upload' | 'url_import'>;
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
  if (!isUuid(value)) throw new AssetAccessError();
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
      await requireNotebookAccess(transaction, {
        notebookId: spaceId,
        trustedSubjectId: ownerSubjectId,
        requiredPermission: 'source.write',
        now,
      }).catch(() => {
        throw new AssetAccessError();
      });
      const [createdAsset] = await transaction
        .insert(assets)
        .values({
          id: assetId,
          ownerSubjectId,
          spaceId,
          scope: input.scope,
          kind: input.kind,
          origin: input.origin ?? 'upload',
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
      await transaction.insert(assetRepresentations).values({
        assetVersionId: versionId,
        kind: 'original',
        mimeType,
        status: 'ready',
        byteSize: input.byteSize,
        createdAt: now,
      });
      const extractedText = input.extractedText?.trim() || null;
      if (extractedText) {
        await transaction.insert(assetRepresentations).values({
          assetVersionId: versionId,
          kind: 'text',
          mimeType: 'text/plain',
          status: 'ready',
          byteSize: Buffer.byteLength(extractedText, 'utf8'),
          createdAt: now,
        });
      }
      if (input.kind === 'document') {
        await transaction.insert(assetProcessingJobs).values({
          assetVersionId: versionId,
          kind: 'extract_text',
          status: versionStatus === 'ready' ? 'succeeded' : 'failed',
          attempts: 1,
          failureCode:
            versionStatus === 'failed'
              ? requireText(input.outcome.failureCode, 'failureCode', 128)
              : null,
          startedAt: now,
          completedAt: now,
          createdAt: now,
        });
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
    return (await this.listAccessibleSpacePage(input)).items;
  }

  async listAccessibleSpacePage(input: {
    ownerSubjectId: string;
    spaceId: string;
    limit?: number;
    cursor?: TemporalIdCursor | null;
  }): Promise<CursorPage<AssetSnapshot>> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const limit = boundedPageLimit(input.limit);
    await requireNotebookAccess(this.database, {
      notebookId: spaceId,
      trustedSubjectId: ownerSubjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => {
      throw new AssetAccessError();
    });
    const rows = await this.database
      .select({ asset: assets, version: assetVersions })
      .from(assets)
      .leftJoin(assetVersions, eq(assetVersions.id, assets.currentVersionId))
      .where(
        and(
          eq(assets.spaceId, spaceId),
          ne(assets.status, 'tombstoned'),
          input.cursor
            ? or(
                lt(assets.createdAt, input.cursor.timestamp),
                and(
                  eq(assets.createdAt, input.cursor.timestamp),
                  lt(assets.id, input.cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(limit + 1);
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1)?.asset;
    return {
      items: pageRows.map(({ asset, version }) => toSnapshot(asset, version)),
      nextCursor:
        rows.length > limit && last
          ? { timestamp: last.createdAt, id: last.id }
          : null,
    };
  }

  /**
   * 读取单个主体和空间内的Asset状态投影；失败或处理中可以没有当前内容版本。
   * 不返回storageKey，供状态类只读组合层使用。
   */
  async getOwnedSnapshot(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
  }): Promise<AssetSnapshot> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    await requireNotebookAccess(this.database, {
      notebookId: spaceId,
      trustedSubjectId: ownerSubjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => {
      throw new AssetAccessError();
    });
    const [row] = await this.database
      .select({ asset: assets, version: assetVersions })
      .from(assets)
      .leftJoin(assetVersions, eq(assetVersions.id, assets.currentVersionId))
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.spaceId, spaceId),
          ne(assets.status, 'tombstoned'),
        ),
      )
      .limit(1);
    if (!row) throw new AssetAccessError();
    return toSnapshot(row.asset, row.version);
  }

  /** Canvas 动作策略只使用数据库成员角色与资源创建者，不接受客户端声明。 */
  async getAccessPolicy(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
  }): Promise<AssetAccessPolicy> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    const access = await requireNotebookAccess(this.database, {
      notebookId: spaceId,
      trustedSubjectId: ownerSubjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => null);
    if (!access) throw new AssetAccessError();
    const [asset] = await this.database
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.spaceId, spaceId),
          ne(assets.status, 'tombstoned'),
        ),
      )
      .limit(1);
    if (!asset) throw new AssetAccessError();
    return { role: access.role };
  }

  /**
   * 读取当前主体和空间内的已就绪对象存储版本。
   * 调用边界：只允许服务端在完成身份与Notebook路由后读取，返回值不得序列化给客户端。
   */
  async loadOwnedCurrentStoredVersion(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
  }): Promise<OwnedStoredAssetVersion> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    await requireNotebookAccess(this.database, {
      notebookId: spaceId,
      trustedSubjectId: ownerSubjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => {
      throw new AssetAccessError();
    });
    const [row] = await this.database
      .select({ asset: assets, version: assetVersions })
      .from(assets)
      .innerJoin(assetVersions, eq(assetVersions.id, assets.currentVersionId))
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.spaceId, spaceId),
          eq(assets.status, 'ready'),
          eq(assetVersions.status, 'ready'),
        ),
      )
      .limit(1);
    if (!row) throw new AssetAccessError();
    return {
      assetId: row.asset.id,
      versionId: row.version.id,
      displayName: row.asset.displayName,
      mimeType: row.version.mimeType,
      byteSize: row.version.byteSize,
      contentHash: row.version.contentHash,
      origin: assetOriginSchema.parse(row.asset.origin),
      createdAt: row.version.createdAt.toISOString(),
      storageKey: row.version.storageKey,
      extractedText: row.version.extractedText,
    };
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

    try {
      const rows = await loadOwnedReadyAssetVersions(this.database, {
        ownerSubjectId,
        spaceId,
        references,
      });
      return rows.map((row, index) => {
        const reference = references[index]!;
        return {
          reference,
          displayName: row.asset.displayName,
          mimeType: row.version.mimeType,
          byteSize: row.version.byteSize,
          extractedText: row.version.extractedText,
        };
      });
    } catch (error) {
      if (error instanceof OwnedAssetVersionError) throw new AssetAccessError();
      throw error;
    }
  }

  /**
   * 将资产及版本收敛为tombstoned；保留storageKey供后续Outbox物理清理。
   * 调用者必须传入服务端确认的主体与空间，跨主体请求统一返回false。
   */
  /**
   * 读取某个成员在当前 Notebook 内的来源启停状态。
   *
   * 启停是成员私有事实：只要求 `notebook.read`，viewer 也能有自己的一份。
   * 取值是每个 asset 下 sequence 最大的那条事实；从未切换过的 asset 不出现在
   * 结果里，由调用方决定默认值（当前 UI 默认启用 space 级来源）。
   */
  async listSubjectAssetBindings(input: {
    subjectId: string;
    spaceId: string;
  }): Promise<ReadonlyMap<string, boolean>> {
    const subjectId = requireOwner(input.subjectId);
    const spaceId = requireUuid(input.spaceId);
    await requireNotebookAccess(this.database, {
      notebookId: spaceId,
      trustedSubjectId: subjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => {
      throw new AssetAccessError();
    });
    const rows = await this.database
      .selectDistinctOn(
        [notebookAssetBindings.subjectId, notebookAssetBindings.assetId],
        {
          assetId: notebookAssetBindings.assetId,
          enabled: notebookAssetBindings.enabled,
        },
      )
      .from(notebookAssetBindings)
      .innerJoin(assets, eq(assets.id, notebookAssetBindings.assetId))
      .where(
        and(
          eq(notebookAssetBindings.subjectId, subjectId),
          eq(assets.spaceId, spaceId),
          ne(assets.status, 'tombstoned'),
        ),
      )
      .orderBy(
        notebookAssetBindings.subjectId,
        notebookAssetBindings.assetId,
        desc(notebookAssetBindings.sequence),
      );
    return new Map(rows.map((row) => [row.assetId, row.enabled]));
  }

  /**
   * 追加一条启停事实。返回生效后的值。
   *
   * `mutationId` 让重放幂等：同一成员重复提交同一个 mutationId 时唯一索引冲突，
   * 此时读回既有事实返回，而不是写第二条或报错——网络重试不该翻转开关。
   */
  async setSubjectAssetBinding(input: {
    subjectId: string;
    spaceId: string;
    assetId: string;
    enabled: boolean;
    mutationId: string;
  }): Promise<boolean | null> {
    const subjectId = requireOwner(input.subjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    const mutationId = requireText(input.mutationId, 'mutationId', 128);
    return this.database.transaction(async (transaction) => {
      const access = await requireNotebookAccess(transaction, {
        notebookId: spaceId,
        trustedSubjectId: subjectId,
        requiredPermission: 'notebook.read',
      }).catch(() => null);
      if (!access) return null;
      const [owned] = await transaction
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.spaceId, spaceId),
            ne(assets.status, 'tombstoned'),
          ),
        )
        .limit(1);
      if (!owned) return null;

      const [replayed] = await transaction
        .select({ enabled: notebookAssetBindings.enabled })
        .from(notebookAssetBindings)
        .where(
          and(
            eq(notebookAssetBindings.subjectId, subjectId),
            eq(notebookAssetBindings.mutationId, mutationId),
          ),
        )
        .limit(1);
      if (replayed) return replayed.enabled;

      const [latest] = await transaction
        .select({ sequence: notebookAssetBindings.sequence })
        .from(notebookAssetBindings)
        .where(
          and(
            eq(notebookAssetBindings.subjectId, subjectId),
            eq(notebookAssetBindings.assetId, assetId),
          ),
        )
        .orderBy(desc(notebookAssetBindings.sequence))
        .limit(1);
      await transaction.insert(notebookAssetBindings).values({
        subjectId,
        assetId,
        sequence: (latest?.sequence ?? 0) + 1,
        enabled: input.enabled,
        mutationId,
      });
      return input.enabled;
    });
  }

  /** 重命名是共享事实，按 `source.write` 授权；只改展示名，不动任何版本。 */
  async renameOwnedAsset(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
    displayName: string;
  }): Promise<boolean> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    const displayName = requireText(input.displayName, 'displayName', 300);
    return this.database.transaction(async (transaction) => {
      const access = await requireNotebookAccess(transaction, {
        notebookId: spaceId,
        trustedSubjectId: ownerSubjectId,
        requiredPermission: 'source.write',
      }).catch(() => null);
      if (!access) return false;
      const updated = await transaction
        .update(assets)
        .set({ displayName, updatedAt: new Date() })
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.spaceId, spaceId),
            ne(assets.status, 'tombstoned'),
          ),
        )
        .returning({ id: assets.id });
      return updated.length > 0;
    });
  }

  async tombstoneOwnedAsset(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
  }): Promise<boolean> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    const now = new Date();
    return this.database.transaction(async (transaction) => {
      const access = await requireNotebookAccess(transaction, {
        notebookId: spaceId,
        trustedSubjectId: ownerSubjectId,
        requiredPermission: 'source.write',
        now,
      }).catch(() => null);
      if (!access) return false;
      const [owned] = await transaction
        .select({ id: assets.id, createdBy: assets.ownerSubjectId })
        .from(assets)
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.spaceId, spaceId),
            ne(assets.status, 'tombstoned'),
          ),
        )
        .limit(1);
      if (!owned) return false;
      if (
        owned.createdBy !== ownerSubjectId &&
        access.role !== 'owner' &&
        access.role !== 'editor'
      ) {
        return false;
      }

      const storedVersions = await transaction
        .select({
          id: assetVersions.id,
          storageKey: assetVersions.storageKey,
        })
        .from(assetVersions)
        .where(eq(assetVersions.assetId, assetId));
      const derivedRepresentations = await transaction
        .select({
          id: assetRepresentations.id,
          storageKey: assetRepresentations.derivedStorageKey,
        })
        .from(assetRepresentations)
        .innerJoin(
          assetVersions,
          eq(assetVersions.id, assetRepresentations.assetVersionId),
        )
        .where(
          and(
            eq(assetVersions.assetId, assetId),
            isNotNull(assetRepresentations.derivedStorageKey),
          ),
        );
      const deletionEntries = [
        ...storedVersions.map((version) => ({
          objectKind: 'asset' as const,
          storageKey: version.storageKey,
          sourceType: 'asset_version' as const,
          sourceId: version.id,
          availableAt: now,
        })),
        ...derivedRepresentations.flatMap((representation) =>
          representation.storageKey
            ? [
                {
                  objectKind: 'asset' as const,
                  storageKey: representation.storageKey,
                  sourceType: 'asset_representation' as const,
                  sourceId: representation.id,
                  availableAt: now,
                },
              ]
            : [],
        ),
      ];
      if (deletionEntries.length > 0) {
        await transaction
          .insert(objectDeletionOutbox)
          .values(deletionEntries)
          .onConflictDoNothing();
      }
      await transaction
        .update(assetVersions)
        .set({ status: 'tombstoned' })
        .where(eq(assetVersions.assetId, assetId));
      await transaction
        .update(assets)
        .set({ status: 'tombstoned', tombstonedAt: now, updatedAt: now })
        .where(eq(assets.id, assetId));
      return true;
    });
  }
}
