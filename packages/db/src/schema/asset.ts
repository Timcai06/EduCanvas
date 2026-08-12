import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { spaces } from './workspace';

/**
 * 平台通用 Asset。ownerSubjectId 与 spaceId 都是可信服务端解析出的不透明标识，
 * 对象存储地址只存在于不可变版本表。D02 起 space_id 为强 FK；ON DELETE restrict
 * 强制 Space 删除先走 Asset tombstone + Outbox 闭包，避免级联删除绕过对象存储清理
 * （D-RISK-01 收口见 docs/04-data/06-D02）。
 */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerSubjectId: text('owner_subject_id').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'restrict' }),
    scope: text('scope').notNull(),
    kind: text('kind').notNull(),
    origin: text('origin').notNull(),
    displayName: text('display_name').notNull(),
    mimeType: text('mime_type'),
    status: text('status').notNull().default('pending'),
    currentVersionId: uuid('current_version_id').references(
      (): AnyPgColumn => assetVersions.id,
      { onDelete: 'set null' },
    ),
    tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('assets_current_version_fk_idx').on(table.currentVersionId),
    index('assets_space_fk_idx').on(table.spaceId),
    index('assets_owner_space_status_idx').on(
      table.ownerSubjectId,
      table.spaceId,
      table.status,
      table.createdAt,
      table.id,
    ),
    check('assets_scope_check', sql`${table.scope} in ('turn', 'space')`),
    check('assets_kind_check', sql`${table.kind} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check(
      'assets_origin_check',
      sql`${table.origin} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'assets_status_check',
      sql`${table.status} in ('pending', 'processing', 'ready', 'failed', 'tombstoned')`,
    ),
    check(
      'assets_status_shape_check',
      sql`(${table.status} = 'ready' and ${table.currentVersionId} is not null and ${table.tombstonedAt} is null) or (${table.status} in ('pending', 'processing', 'failed') and ${table.currentVersionId} is null and ${table.tombstonedAt} is null) or (${table.status} = 'tombstoned' and ${table.tombstonedAt} is not null)`,
    ),
    check(
      'assets_text_shape_check',
      sql`char_length(${table.ownerSubjectId}) between 1 and 160 and char_length(${table.displayName}) between 1 and 300 and (${table.mimeType} is null or char_length(${table.mimeType}) between 1 and 255)`,
    ),
  ],
);

/** 每次上传、解析、转码或重新生成都创建不可变版本。 */
export const assetVersions = pgTable(
  'asset_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull(),
    storageKey: text('storage_key').notNull(),
    extractedText: text('extracted_text'),
    /**
     * 音频转录派生文本；与 extractedText 分离是因为来源不同
     * （文本抽取 vs. Provider 转录），生命周期独立，审计需要分别追踪。
     */
    transcriptionText: text('transcription_text'),
    /** 转录 Provider 审计元数据（ProviderCallMetadata JSON），不包含 Prompt 正文。 */
    transcriptionMetadata: jsonb('transcription_metadata'),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('asset_versions_asset_hash_unique').on(
      table.assetId,
      table.contentHash,
    ),
    index('asset_versions_asset_created_idx').on(
      table.assetId,
      table.createdAt,
      table.id,
    ),
    check(
      'asset_versions_kind_check',
      sql`${table.kind} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'asset_versions_status_check',
      sql`${table.status} in ('processing', 'ready', 'failed', 'tombstoned')`,
    ),
    check(
      'asset_versions_size_check',
      sql`${table.byteSize} >= 0 and ${table.byteSize} <= 52428800`,
    ),
    check(
      'asset_versions_hash_check',
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'asset_versions_storage_key_check',
      sql`char_length(${table.storageKey}) between 1 and 1024 and ${table.storageKey} !~* '^https?://'`,
    ),
    check(
      'asset_versions_failure_shape_check',
      sql`(${table.status} = 'failed' and ${table.failureCode} is not null) or (${table.status} <> 'failed' and ${table.failureCode} is null)`,
    ),
  ],
);

/**
 * 成员对 Notebook 来源的启用/停用事实流。
 *
 * 为什么按成员而不是按 Notebook：启用与否是「这轮对话我要不要带这份资料」的
 * 个人选择，多人笔记本里不应互相覆盖。因此它不是资源动作（不进
 * `canvasResourceActions`），viewer 也能改自己的绑定；删除和重命名才是共享事实，
 * 仍需 owner/editor。
 *
 * 为什么是追加事实流而不是一列布尔：与 `session_source_bindings` 保持同一范式，
 * 保留切换历史用于审计，并靠 `mutationId` 让重放不产生第二条事实。
 * 当前值 = 同一 `(subjectId, assetId)` 下 `sequence` 最大的那条。
 *
 * 不存 notebookId：它可由 `assets.spaceId` 唯一确定，denormalize 只会引入漂移；
 * 按 Notebook 过滤时 join assets 即可。
 */
export const notebookAssetBindings = pgTable(
  'notebook_asset_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: text('subject_id').notNull(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    enabled: boolean('enabled').notNull(),
    mutationId: text('mutation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('notebook_asset_bindings_asset_fk_idx').on(table.assetId),
    uniqueIndex('notebook_asset_bindings_subject_mutation_unique').on(
      table.subjectId,
      table.mutationId,
    ),
    uniqueIndex('notebook_asset_bindings_subject_asset_sequence_unique').on(
      table.subjectId,
      table.assetId,
      table.sequence,
    ),
    /* 最新绑定读取复用 notebook_asset_bindings_subject_asset_sequence_unique：
       列与顺序完全相同，重复索引只增加写放大。 */
    check(
      'notebook_asset_bindings_sequence_check',
      sql`${table.sequence} >= 1`,
    ),
    check(
      'notebook_asset_bindings_text_shape_check',
      sql`char_length(${table.subjectId}) between 1 and 160 and char_length(${table.mutationId}) between 1 and 128`,
    ),
  ],
);

/** 不复制 Source 内容，只登记某个不可变版本已经具备的服务端表现能力。 */
export const assetRepresentations = pgTable(
  'asset_representations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetVersionId: uuid('asset_version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /**
     * D04 派生结果多版本身份：同一 AssetVersion 下不同 (variant, producer,
     * producer_version) 可并存且互不覆盖（如 transcription/default/local/sherpa.v1
     * 与 transcription/default/cloud/provider-a.v1、preview/low/high 变体）。
     * 唯一约束 = (asset_version_id, kind, variant, producer, producer_version)。
     * variant/producer/producer_version 是开放扩展 Vocabulary（格式 CHECK），
     * 已登记成员由 agent-core assetRepresentationKinds 等 Registry 约束。
     */
    variant: text('variant').notNull().default('default'),
    producer: text('producer').notNull().default('default'),
    producerVersion: text('producer_version').notNull().default('v1'),
    mimeType: text('mime_type').notNull(),
    status: text('status').notNull(),
    /**
     * ADR-0026 决定 6：文档派生表示的质量状态（structured /
     * degraded_plain_text / failed / processing；非文档表示取 unavailable）。
     * 与 status（生命周期）独立：status='ready' 时仍要区分结构化与降级。
     * 值域与形状一致性由下方两个 CHECK 约束强制。
     */
    quality: text('quality').notNull().default('unavailable'),
    derivedStorageKey: text('derived_storage_key'),
    byteSize: integer('byte_size'),
    checksum: text('checksum'),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('asset_representations_identity_unique').on(
      table.assetVersionId,
      table.kind,
      table.variant,
      table.producer,
      table.producerVersion,
    ),
    index('asset_representations_version_status_idx').on(
      table.assetVersionId,
      table.status,
    ),
    check(
      'asset_representations_kind_check',
      sql`${table.kind} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'asset_representations_variant_check',
      sql`${table.variant} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'asset_representations_producer_check',
      sql`${table.producer} ~ '^[a-z][a-z0-9._-]{0,63}$'`,
    ),
    check(
      'asset_representations_producer_version_check',
      sql`${table.producerVersion} ~ '^[a-z0-9][a-z0-9._-]{0,63}$'`,
    ),
    check(
      'asset_representations_status_check',
      sql`${table.status} in ('processing', 'ready', 'failed', 'unavailable')`,
    ),
    check(
      'asset_representations_quality_check',
      sql`${table.quality} in ('processing', 'structured', 'degraded_plain_text', 'failed', 'unavailable')`,
    ),
    /* quality 与 status/kind 的一致性：ready 的文档表示必须在
       structured/degraded_plain_text 二选一，其余状态一一对应。 */
    check(
      'asset_representations_quality_shape_check',
      sql`(${table.status} = 'processing' and ${table.quality} = 'processing') or (${table.status} = 'failed' and ${table.quality} = 'failed') or (${table.status} = 'unavailable' and ${table.quality} = 'unavailable') or (${table.status} = 'ready' and ${table.kind} = 'text' and ${table.quality} in ('structured', 'degraded_plain_text')) or (${table.status} = 'ready' and ${table.kind} <> 'text' and ${table.quality} = 'unavailable')`,
    ),
    check(
      'asset_representations_storage_shape_check',
      sql`(${table.derivedStorageKey} is null and ${table.checksum} is null) or (${table.derivedStorageKey} is not null and char_length(${table.derivedStorageKey}) between 1 and 1024 and ${table.derivedStorageKey} !~* '^https?://' and ${table.checksum} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'asset_representations_failure_shape_check',
      sql`(${table.status} = 'failed' and ${table.failureCode} is not null) or (${table.status} <> 'failed' and ${table.failureCode} is null)`,
    ),
  ],
);

/**
 * 视频关键帧派生物（ADR-0016）。
 *
 * 关键帧是派生内容而不是新的内容事实：原始 Asset Version 仍是唯一内容来源，
 * 整表清空只会让视频失去预览帧，不改变任何转录、引用或学习事实。
 *
 * `algorithmVersion` 随行保存：抽帧策略变化后新旧帧不可比较，也不能就地覆盖。
 * `(assetVersionId, algorithmVersion, ordinal)` 唯一使同一版本在不同算法下的帧
 * 可以共存，让算法升级成为可回滚过程。
 *
 * 与 `asset_representations` 的分工：representation 记录「这个版本有没有关键帧、
 * 处于什么状态」，本表记录「具体是哪几帧」。前者一个版本一行，无法表达 N 帧。
 */
export const assetVideoKeyframes = pgTable(
  'asset_video_keyframes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetVersionId: uuid('asset_version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'cascade' }),
    algorithmVersion: text('algorithm_version').notNull(),
    ordinal: integer('ordinal').notNull(),
    timestampSeconds: doublePrecision('timestamp_seconds').notNull(),
    storageKey: text('storage_key').notNull(),
    checksum: text('checksum').notNull(),
    byteSize: integer('byte_size').notNull(),
    mimeType: text('mime_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('asset_video_keyframes_version_algorithm_ordinal_unique').on(
      table.assetVersionId,
      table.algorithmVersion,
      table.ordinal,
    ),
    check('asset_video_keyframes_ordinal_check', sql`${table.ordinal} >= 1`),
    check(
      'asset_video_keyframes_timestamp_check',
      sql`${table.timestampSeconds} >= 0`,
    ),
    check(
      'asset_video_keyframes_size_check',
      sql`${table.byteSize} > 0 and ${table.byteSize} <= 2097152`,
    ),
    check(
      'asset_video_keyframes_hash_check',
      sql`${table.checksum} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'asset_video_keyframes_storage_key_check',
      sql`char_length(${table.storageKey}) between 1 and 1024 and ${table.storageKey} !~* '^https?://'`,
    ),
    check(
      'asset_video_keyframes_shape_check',
      sql`${table.algorithmVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' and ${table.mimeType} = 'image/jpeg'`,
    ),
  ],
);

/** Source 解析、转码和缩略图生成的业务任务账本；队列行不是事实源。 */
export const assetProcessingJobs = pgTable(
  'asset_processing_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetVersionId: uuid('asset_version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /**
     * D04：job 与 representation 共享同一派生 identity（(asset_version_id,
     * kind, variant, producer, producer_version)），唯一约束保证同一 identity
     * 不会产生第二个 job（重试 = 同 job attempts 递增），消除入队查重的 TOCTOU。
     */
    variant: text('variant').notNull().default('default'),
    producer: text('producer').notNull().default('default'),
    producerVersion: text('producer_version').notNull().default('v1'),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    queueJobKey: text('queue_job_key'),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('asset_processing_jobs_identity_unique').on(
      table.assetVersionId,
      table.kind,
      table.variant,
      table.producer,
      table.producerVersion,
    ),
    index('asset_processing_jobs_status_created_idx').on(
      table.status,
      table.createdAt,
      table.id,
    ),
    index('asset_processing_jobs_version_created_idx').on(
      table.assetVersionId,
      table.createdAt,
      table.id,
    ),
    check(
      'asset_processing_jobs_kind_check',
      sql`${table.kind} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'asset_processing_jobs_variant_check',
      sql`${table.variant} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'asset_processing_jobs_producer_check',
      sql`${table.producer} ~ '^[a-z][a-z0-9._-]{0,63}$'`,
    ),
    check(
      'asset_processing_jobs_producer_version_check',
      sql`${table.producerVersion} ~ '^[a-z0-9][a-z0-9._-]{0,63}$'`,
    ),
    check(
      'asset_processing_jobs_status_check',
      sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
    check(
      'asset_processing_jobs_lifecycle_check',
      sql`(${table.status} = 'queued' and ${table.startedAt} is null and ${table.completedAt} is null) or (${table.status} = 'running' and ${table.startedAt} is not null and ${table.completedAt} is null) or (${table.status} in ('succeeded', 'failed', 'cancelled') and ${table.completedAt} is not null)`,
    ),
    check(
      'asset_processing_jobs_failure_shape_check',
      sql`(${table.status} = 'failed' and ${table.failureCode} is not null) or (${table.status} <> 'failed' and ${table.failureCode} is null)`,
    ),
    check(
      'asset_processing_jobs_attempts_check',
      sql`${table.attempts} between 0 and 100`,
    ),
  ],
);

/**
 * 对象存储物理删除的可靠 Outbox。业务事务只登记 storageKey；Worker 负责幂等删除，
 * 失败时保留稳定错误码与重试时间，不记录绝对路径或堆栈。
 */
export const objectDeletionOutbox = pgTable(
  'object_deletion_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectKind: text('object_kind').notNull(),
    storageKey: text('storage_key').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('object_deletion_outbox_object_unique').on(
      table.objectKind,
      table.storageKey,
    ),
    index('object_deletion_outbox_claim_idx').on(
      table.status,
      table.availableAt,
      table.createdAt,
      table.id,
    ),
    check(
      'object_deletion_outbox_kind_check',
      sql`${table.objectKind} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'object_deletion_outbox_source_check',
      sql`${table.sourceType} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'object_deletion_outbox_status_check',
      sql`${table.status} in ('pending', 'processing', 'completed', 'failed')`,
    ),
    check(
      'object_deletion_outbox_storage_key_check',
      sql`char_length(${table.storageKey}) between 1 and 1024 and ${table.storageKey} !~* '^https?://'`,
    ),
    check(
      'object_deletion_outbox_lifecycle_check',
      sql`(${table.status} = 'pending' and ${table.claimedAt} is null and ${table.completedAt} is null) or (${table.status} = 'processing' and ${table.claimedAt} is not null and ${table.completedAt} is null) or (${table.status} = 'completed' and ${table.completedAt} is not null) or (${table.status} = 'failed' and ${table.claimedAt} is null and ${table.completedAt} is null and ${table.failureCode} is not null)`,
    ),
    check(
      'object_deletion_outbox_attempts_check',
      sql`${table.attempts} between 0 and 100`,
    ),
  ],
);
