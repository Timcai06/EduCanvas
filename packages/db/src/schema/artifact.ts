import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { spaces } from './workspace';
import { agentOperations, conversations } from './conversation';

/**
 * Artifact 一等公民（ADR-0005）。身份与信任层级在本表,内容进不可变版本表。
 * `trustTier` 使用 ADR-0004 的层级词汇:tier1=判分型白名单,tier2=沙箱探索型,
 * 判分与学习事件消费方必须先校验 tier。`kind` 只在库里限形状,合法产物类型
 * 集合由应用层 Registry 裁决——类型随 M2 逐个增加,不适合写死为库级枚举。
 * `latestVersion` 以计数器代替 current_version 外键,避免与版本表循环引用;
 * conversation 删除只断挂接不删产物(Studio 产物跨对话长寿),故 set null。
 */
export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    ownerSubjectId: text('owner_subject_id').notNull(),
    kind: text('kind').notNull(),
    trustTier: text('trust_tier').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('proposed'),
    latestVersion: integer('latest_version').notNull().default(0),
    creationIdempotencyKey: text('creation_idempotency_key'),
    creationRequestFingerprint: text('creation_request_fingerprint'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('artifacts_space_status_updated_idx').on(
      table.spaceId,
      table.status,
      table.updatedAt,
      table.id,
    ),
    index('artifacts_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
      table.id,
    ),
    index('artifacts_owner_recent_idx').on(
      table.ownerSubjectId,
      table.updatedAt,
      table.id,
    ),
    uniqueIndex('artifacts_owner_creation_idempotency_unique')
      .on(table.ownerSubjectId, table.creationIdempotencyKey)
      .where(sql`${table.creationIdempotencyKey} is not null`),
    check(
      'artifacts_trust_tier_check',
      sql`${table.trustTier} in ('tier1', 'tier2')`,
    ),
    check(
      'artifacts_status_check',
      sql`${table.status} in ('proposed', 'active', 'archived')`,
    ),
    check(
      'artifacts_kind_check',
      sql`${table.kind} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'artifacts_text_check',
      sql`char_length(${table.ownerSubjectId}) between 1 and 160 and char_length(${table.title}) between 1 and 300`,
    ),
    check('artifacts_version_check', sql`${table.latestVersion} >= 0`),
    check(
      'artifacts_creation_idempotency_shape_check',
      sql`(${table.creationIdempotencyKey} is null and ${table.creationRequestFingerprint} is null) or (char_length(${table.creationIdempotencyKey}) between 1 and 128 and ${table.creationRequestFingerprint} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'artifacts_archive_shape_check',
      sql`(${table.status} = 'archived') = (${table.archivedAt} is not null)`,
    ),
  ],
);

/**
 * 产物生成任务账本(ADR-0005)。graphile_worker 表是队列实现细节,本表才是
 * 业务事实源:状态、进度、失败原因与溯源在此,经 `queueJobKey`(graphile 的
 * job_key,文本)与队列行松耦合关联——不用 bigint job id,因为队列行会被
 * 库自身的清理机制回收,而账本必须长期可审计。
 */
export const artifactGenerationJobs = pgTable(
  'artifact_generation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    operationId: uuid('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('queued'),
    progress: integer('progress'),
    failureCode: text('failure_code'),
    params: jsonb('params').notNull().default({}),
    checkpoint: jsonb('checkpoint').notNull().default({}),
    queueJobKey: text('queue_job_key'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('artifact_generation_jobs_operation_fk_idx').on(table.operationId),
    index('artifact_generation_jobs_artifact_created_idx').on(
      table.artifactId,
      table.createdAt,
      table.id,
    ),
    index('artifact_generation_jobs_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    uniqueIndex('artifact_generation_jobs_artifact_id_unique').on(
      table.artifactId,
      table.id,
    ),
    check(
      'artifact_generation_jobs_status_check',
      sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
    check(
      'artifact_generation_jobs_progress_check',
      sql`${table.progress} is null or (${table.progress} between 0 and 100)`,
    ),
    check(
      'artifact_generation_jobs_failure_shape_check',
      sql`(${table.status} = 'failed' and ${table.failureCode} is not null and char_length(${table.failureCode}) between 1 and 128) or (${table.status} <> 'failed' and ${table.failureCode} is null)`,
    ),
    check(
      'artifact_generation_jobs_lifecycle_shape_check',
      sql`(${table.status} = 'queued' and ${table.startedAt} is null and ${table.completedAt} is null) or (${table.status} = 'running' and ${table.startedAt} is not null and ${table.completedAt} is null) or (${table.status} in ('succeeded', 'failed', 'cancelled') and ${table.completedAt} is not null)`,
    ),
    check(
      'artifact_generation_jobs_queue_key_check',
      sql`${table.queueJobKey} is null or char_length(${table.queueJobKey}) between 1 and 512`,
    ),
    check(
      'artifact_generation_jobs_json_shape_check',
      sql`jsonb_typeof(${table.params}) = 'object' and jsonb_typeof(${table.checkpoint}) = 'object'`,
    ),
  ],
);

/**
 * 不可变产物版本(ADR-0005)。结构化产物内容进 `content`(JSONB),媒体产物进
 * 对象存储、库里只留 `objectKey` + `checksum`(sha-256)——二者恰取其一由
 * 形状约束强制。版本号在产物内单调递增且唯一,仓储不提供 update/delete。
 */
export const artifactVersions = pgTable(
  'artifact_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: jsonb('content'),
    metadata: jsonb('metadata'),
    objectKey: text('object_key'),
    checksum: text('checksum'),
    createdByOperationId: uuid('created_by_operation_id').references(
      () => agentOperations.id,
      { onDelete: 'set null' },
    ),
    /* 生成器溯源(如 rule:outline-v1 / model:artifact.generate:v1);完整
       模型运行账本待平台 Operation 迁移(M3 承接债务)后关联,此列先保证
       "这版内容怎么来的"可审计。 */
    generatedBy: text('generated_by'),
    generationJobId: uuid('generation_job_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('artifact_versions_created_by_operation_fk_idx').on(
      table.createdByOperationId,
    ),
    uniqueIndex('artifact_versions_artifact_version_unique').on(
      table.artifactId,
      table.version,
    ),
    unique('artifact_versions_id_artifact_unique').on(
      table.id,
      table.artifactId,
    ),
    uniqueIndex('artifact_versions_generation_job_unique')
      .on(table.generationJobId)
      .where(sql`${table.generationJobId} is not null`),
    foreignKey({
      columns: [table.artifactId, table.generationJobId],
      foreignColumns: [
        artifactGenerationJobs.artifactId,
        artifactGenerationJobs.id,
      ],
      name: 'artifact_versions_generation_job_scope_fk',
    }).onDelete('restrict'),
    check('artifact_versions_version_check', sql`${table.version} >= 1`),
    check(
      'artifact_versions_content_shape_check',
      sql`(${table.content} is not null and ${table.objectKey} is null and ${table.checksum} is null) or (${table.content} is null and ${table.objectKey} is not null and ${table.checksum} is not null)`,
    ),
    check(
      'artifact_versions_generated_by_check',
      sql`${table.generatedBy} is null or char_length(${table.generatedBy}) between 1 and 128`,
    ),
    check(
      'artifact_versions_object_key_check',
      sql`${table.objectKey} is null or (char_length(${table.objectKey}) between 1 and 1024 and ${table.checksum} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      'artifact_versions_metadata_shape_check',
      sql`${table.metadata} is null or jsonb_typeof(${table.metadata}) = 'object'`,
    ),
  ],
);
