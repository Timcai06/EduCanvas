import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  assetRepresentationKindSchema,
  DEFAULT_REPRESENTATION_IDENTITY,
  representationIdentitySchema,
  type AssetRepresentationKind,
  type RepresentationIdentity,
} from '@educanvas/agent-core';
import type { Database, DatabaseTransaction } from './internal/database-types';

function requireUuid(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error('invalid_uuid');
  }
  return value;
}
import { assetRepresentations, objectDeletionOutbox } from './schema';

export type AssetRepresentationStatus =
  'processing' | 'ready' | 'failed' | 'unavailable';

export interface RepresentationWriteInput {
  assetVersionId: string;
  kind: AssetRepresentationKind;
  /** identity 字段可省略（缺省 = 默认 identity default/default/v1）。 */
  variant?: string;
  producer?: string;
  producerVersion?: string;
  mimeType: string;
  status: AssetRepresentationStatus;
  derivedStorageKey?: string | null;
  byteSize?: number | null;
  checksum?: string | null;
  failureCode?: string | null;
  now?: Date;
}

export interface AssetRepresentationRow {
  id: string;
  assetVersionId: string;
  kind: string;
  variant: string;
  producer: string;
  producerVersion: string;
  mimeType: string;
  status: AssetRepresentationStatus;
  derivedStorageKey: string | null;
  byteSize: number | null;
  checksum: string | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

const rowProjection = {
  id: assetRepresentations.id,
  assetVersionId: assetRepresentations.assetVersionId,
  kind: assetRepresentations.kind,
  variant: assetRepresentations.variant,
  producer: assetRepresentations.producer,
  producerVersion: assetRepresentations.producerVersion,
  mimeType: assetRepresentations.mimeType,
  status: assetRepresentations.status,
  derivedStorageKey: assetRepresentations.derivedStorageKey,
  byteSize: assetRepresentations.byteSize,
  checksum: assetRepresentations.checksum,
  failureCode: assetRepresentations.failureCode,
  createdAt: assetRepresentations.createdAt,
  updatedAt: assetRepresentations.updatedAt,
  completedAt: assetRepresentations.completedAt,
};

/** 所有默认读取共用同一稳定排序，最后用主键消除相同时间戳下的并列。 */
export function defaultRepresentationOrderBy() {
  return [
    desc(sql`(${assetRepresentations.status} = 'ready')`),
    desc(sql`(${assetRepresentations.variant} = 'default')`),
    desc(sql`(${assetRepresentations.producer} = 'default')`),
    asc(assetRepresentations.producer),
    asc(assetRepresentations.producerVersion),
    asc(assetRepresentations.createdAt),
    asc(assetRepresentations.id),
  ] as const;
}

/** 在调用方事务中按完整 identity 收敛派生表示，并回收被替换的旧对象。 */
export async function upsertAssetRepresentation(
  transaction: DatabaseTransaction,
  input: RepresentationWriteInput,
): Promise<AssetRepresentationRow> {
  const kind = assetRepresentationKindSchema.parse(input.kind);
  const identity = representationIdentitySchema.parse(input);
  const assetVersionId = requireUuid(input.assetVersionId);
  const now = input.now ?? new Date();
  const completedAt = input.status === 'processing' ? null : now;
  const [existing] = await transaction
    .select({
      id: assetRepresentations.id,
      derivedStorageKey: assetRepresentations.derivedStorageKey,
    })
    .from(assetRepresentations)
    .where(
      and(
        eq(assetRepresentations.assetVersionId, assetVersionId),
        eq(assetRepresentations.kind, kind),
        eq(assetRepresentations.variant, identity.variant),
        eq(assetRepresentations.producer, identity.producer),
        eq(assetRepresentations.producerVersion, identity.producerVersion),
      ),
    )
    .limit(1);
  const nextKey = input.derivedStorageKey ?? null;
  if (existing?.derivedStorageKey && existing.derivedStorageKey !== nextKey) {
    await transaction
      .insert(objectDeletionOutbox)
      .values({
        objectKind: 'asset',
        storageKey: existing.derivedStorageKey,
        sourceType: 'asset_representation',
        sourceId: existing.id,
        availableAt: now,
      })
      .onConflictDoNothing();
  }

  const values = {
    status: input.status,
    mimeType: input.mimeType,
    derivedStorageKey: nextKey,
    byteSize: input.byteSize ?? null,
    checksum: input.checksum ?? null,
    failureCode: input.failureCode ?? null,
    updatedAt: now,
    completedAt,
  };
  const [row] = await transaction
    .insert(assetRepresentations)
    .values({
      assetVersionId,
      kind,
      variant: identity.variant,
      producer: identity.producer,
      producerVersion: identity.producerVersion,
      ...values,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        assetRepresentations.assetVersionId,
        assetRepresentations.kind,
        assetRepresentations.variant,
        assetRepresentations.producer,
        assetRepresentations.producerVersion,
      ],
      set: values,
    })
    .returning(rowProjection);
  return row as unknown as AssetRepresentationRow;
}

/**
 * D04：asset_representations 领域 Repository（派生结果多版本权威）。
 *
 * 身份契约：identity = (assetVersionId, kind, variant, producer, producerVersion)，
 * 与数据库唯一约束 asset_representations_identity_unique 一一对应。
 * 默认 identity = { variant: 'default', producer: 'default', producerVersion: 'v1' }，
 * 现有系统派生流程（文本抽取/转录/预览/缩略图）使用默认 identity；多 Provider
 * 写入（如 cloud transcription）使用显式 identity 并存。
 *
 * 幂等契约：相同完整 identity 的重复写 = 幂等更新（upsert），不产生新行、
 * 不拒绝（同 identity 重试安全）；不同 identity 永不互相覆盖。
 */
export class DrizzleAssetRepresentationRepository {
  constructor(private readonly database: Database) {}

  private parseIdentity(input: RepresentationIdentity): RepresentationIdentity {
    return representationIdentitySchema.parse(input);
  }

  /** 按完整 identity 获取单条 representation（不存在返回 null）。 */
  async getRepresentation(input: {
    assetVersionId: string;
    kind: AssetRepresentationKind;
    identity?: {
      variant?: string;
      producer?: string;
      producerVersion?: string;
    };
  }): Promise<AssetRepresentationRow | null> {
    const identity = this.parseIdentity(
      representationIdentitySchema.parse(
        input.identity ?? DEFAULT_REPRESENTATION_IDENTITY,
      ),
    );
    const [row] = await this.database
      .select(rowProjection)
      .from(assetRepresentations)
      .where(
        and(
          eq(
            assetRepresentations.assetVersionId,
            requireUuid(input.assetVersionId),
          ),
          eq(
            assetRepresentations.kind,
            assetRepresentationKindSchema.parse(input.kind),
          ),
          eq(assetRepresentations.variant, identity.variant),
          eq(assetRepresentations.producer, identity.producer),
          eq(assetRepresentations.producerVersion, identity.producerVersion),
        ),
      )
      .limit(1);
    return (row ?? null) as AssetRepresentationRow | null;
  }

  /** 列出同一 AssetVersion + kind 的全部可用版本（含 processing/failed）。 */
  async listRepresentations(input: {
    assetVersionId: string;
    kind?: AssetRepresentationKind;
  }): Promise<AssetRepresentationRow[]> {
    return this.database
      .select(rowProjection)
      .from(assetRepresentations)
      .where(
        and(
          eq(
            assetRepresentations.assetVersionId,
            requireUuid(input.assetVersionId),
          ),
          input.kind === undefined
            ? undefined
            : eq(
                assetRepresentations.kind,
                assetRepresentationKindSchema.parse(input.kind),
              ),
        ),
      )
      .orderBy(
        asc(assetRepresentations.kind),
        asc(assetRepresentations.variant),
        asc(assetRepresentations.producer),
        asc(assetRepresentations.producerVersion),
      ) as unknown as Promise<AssetRepresentationRow[]>;
  }

  /**
   * 确定性默认选择：同一 (assetVersionId, kind) 下
   * 1) status='ready' 优先；2) variant='default' 优先；3) producer='default'
   * 优先；4) producer、producer_version 字典序最小；5) created_at、id
   * 依次打破并列。
   * 不依赖数据库未指定顺序或"最后一行"。
   */
  async selectDefaultRepresentation(input: {
    assetVersionId: string;
    kind: AssetRepresentationKind;
  }): Promise<AssetRepresentationRow | null> {
    const [row] = await this.database
      .select(rowProjection)
      .from(assetRepresentations)
      .where(
        and(
          eq(
            assetRepresentations.assetVersionId,
            requireUuid(input.assetVersionId),
          ),
          eq(
            assetRepresentations.kind,
            assetRepresentationKindSchema.parse(input.kind),
          ),
        ),
      )
      .orderBy(...defaultRepresentationOrderBy())
      .limit(1);
    return (row ?? null) as AssetRepresentationRow | null;
  }

  /**
   * 幂等 upsert：相同完整 identity 存在则更新状态/内容身份/时间戳，
   * 不存在则插入。失败/处理中→ready 或 ready→failed 均允许（状态由
   * 调用方的处理流程控制，本方法不判定状态迁移合法性——状态机由
   * 各处理流程的 begin/settle 幂等逻辑负责）。
   */
  async upsertRepresentation(
    input: RepresentationWriteInput,
  ): Promise<AssetRepresentationRow> {
    return this.database.transaction((transaction) =>
      upsertAssetRepresentation(transaction, input),
    );
  }
}
