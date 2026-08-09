import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lessonSessions } from './agent-runtime';
import { artifactVersions, artifacts } from './artifact';

/**
 * 保存已经白名单校验的 Artifact 快照，供学习过程回放、问题审计和协议兼容使用。
 * `params` 使用 JSONB 是因为不同 Artifact 的联合参数结构不同，但写入前仍必须通过 canvas-protocol；见 ADR-0004 与 ADR-0009。
 */
export const canvasArtifacts = pgTable(
  'canvas_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id),
    artifactId: text('artifact_id').notNull(),
    type: text('type').notNull(),
    schemaVersion: text('schema_version').notNull(),
    title: text('title').notNull(),
    // 这里只保存浏览器安全投影；答案必须进入canvas_artifact_grading_keys。
    params: jsonb('params').notNull(),
    /**
     * 可选的平台 Artifact 长期身份关联。新建 K12 Artifact 时由同一事务写入，
     * 旧记录保持 NULL——不做无界回填。两列必须成对且 Version 必须属于该 Artifact。
     */
    platformArtifactId: uuid('platform_artifact_id').references(
      () => artifacts.id,
      { onDelete: 'set null' },
    ),
    platformArtifactVersionId: uuid('platform_artifact_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('canvas_artifacts_platform_artifact_fk_idx').on(
      table.platformArtifactId,
    ),
    uniqueIndex('canvas_artifacts_session_artifact_unique').on(
      table.sessionId,
      table.artifactId,
    ),
    uniqueIndex('canvas_artifacts_platform_artifact_unique')
      .on(table.platformArtifactId)
      .where(sql`${table.platformArtifactId} is not null`),
    foreignKey({
      columns: [table.platformArtifactVersionId, table.platformArtifactId],
      foreignColumns: [artifactVersions.id, artifactVersions.artifactId],
      name: 'canvas_artifacts_platform_version_scope_fk',
    }).onDelete('set null'),
    check(
      'canvas_artifacts_platform_link_pair_check',
      sql`(${table.platformArtifactId} is null and ${table.platformArtifactVersionId} is null) or (${table.platformArtifactId} is not null and ${table.platformArtifactVersionId} is not null)`,
    ),
  ],
);

/**
 * 与公开Canvas快照物理分离的私有判分键。应用层必须保证Web页面和客户端注册表不查询此表；
 * 服务端判分器按artifact记录主键读取后才能产生可信assessment_graded事件。
 */
export const canvasArtifactGradingKeys = pgTable(
  'canvas_artifact_grading_keys',
  {
    artifactRecordId: uuid('artifact_record_id')
      .primaryKey()
      .references(() => canvasArtifacts.id, { onDelete: 'cascade' }),
    gradingKey: jsonb('grading_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/**
 * 只追加的学习事实流，作为掌握度重算和教学决策的可追溯输入；业务代码不得原地改写历史事件。
 * `occurredAt` 不设数据库默认值，以保存客户端实际发生时间；`payload` 用 JSONB 承载事件专属字段，
 * `schemaVersion` 用于消费端兼容演进，口径见 docs/04-data/02-数据设计.md。
 */
export const learningEvents = pgTable(
  'learning_events',
  {
    // 直接保存领域事件eventId，避免数据库ID与事件信封出现双重身份。
    id: uuid('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    studentId: text('student_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    knowledgeNodeId: text('knowledge_node_id'),
    sequence: integer('sequence').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    source: text('source').notNull(),
    schemaVersion: text('schema_version').notNull(),
    causationId: text('causation_id').notNull(),
  },
  (table) => [
    uniqueIndex('learning_events_idempotency_key_unique').on(
      table.idempotencyKey,
    ),
    uniqueIndex('learning_events_session_sequence_unique').on(
      table.sessionId,
      table.sequence,
    ),
    foreignKey({
      columns: [table.sessionId, table.studentId],
      foreignColumns: [lessonSessions.id, lessonSessions.studentId],
      name: 'learning_events_session_student_fk',
    }).onDelete('restrict'),
  ],
);

/**
 * 每个“学生 × 知识节点”只有一行可计算掌握状态，复合主键防止同一口径出现多份当前值。
 * 分数用 real 支持连续更新，次数字段保留可解释证据，JSONB 标签允许误区分类逐步扩展；
 * `version` 已由Drizzle适配器用于并发更新的乐观锁，模型不得直接决定这些值，见 docs/04-data/02-数据设计.md。
 */
export const masteryStates = pgTable(
  'mastery_states',
  {
    studentId: text('student_id').notNull(),
    knowledgeNodeId: text('knowledge_node_id').notNull(),
    masteryScore: real('mastery_score').notNull().default(0),
    attemptCount: integer('attempt_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    hintCount: integer('hint_count').notNull().default(0),
    misconceptionTags: jsonb('misconception_tags').notNull().default([]),
    lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true }),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.studentId, table.knowledgeNodeId] }),
  ],
);
