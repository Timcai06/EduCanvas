import {
  check,
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
import type { AssetVersionRepresentationIdentity } from '@educanvas/agent-core';
import { platformUsers } from './identity';
import { assetVersions, assets } from './asset';
import { agentOperations, conversations } from './conversation';

/**
 * 教学状态机和审计的会话边界。student_id 为强 FK（D02 起，与 learner_profiles
 * 口径一致）；ON DELETE restrict 与 learning_events/audio_consents 一致——
 * 教学事实是审计保留链，主体删除必须先走显式教学闭包（D01 §4.1/§4.10）。
 * 年级段和课程目录尚在迭代，阶段一用 text 接受稳定外部标识，待正式实体表落地后再加外键。
 */
export const lessonSessions = pgTable(
  'lesson_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'restrict',
    }),
    studentId: text('student_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'restrict' }),
    // 年级段和课程目录尚在迭代，阶段一用 text 接受稳定外部标识，待正式实体表落地后再加外键。
    gradeBand: text('grade_band').notNull(),
    courseSlug: text('course_slug').notNull(),
    knowledgeNodeId: text('knowledge_node_id'),
    // 状态机仍处早期演进期，text 避免每次新增教学分支都先修改数据库枚举。
    // 不设默认值：初始状态必须由 runtime 显式决定（新学生 DIAGNOSE、有掌握记录可直入 EXPLAIN），
    // 让"跳过诊断"成为显式决策而非默认值副作用，见学习计划数据契约。
    state: text('state').notNull(),
    interruptedState: text('interrupted_state'),
    status: text('status').notNull().default('active'),
    title: text('title'),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // 可信事件序号通过原子UPDATE递增，不与会话状态version共用锁。
    eventSequence: integer('event_sequence').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('lesson_sessions_conversation_fk_idx').on(table.conversationId),
    uniqueIndex('lesson_sessions_active_scope_unique')
      .on(
        table.studentId,
        table.gradeBand,
        table.courseSlug,
        sql`coalesce(${table.knowledgeNodeId}, '')`,
      )
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('lesson_sessions_id_student_unique').on(
      table.id,
      table.studentId,
    ),
    index('lesson_sessions_recent_scope_idx').on(
      table.studentId,
      table.gradeBand,
      table.courseSlug,
      table.knowledgeNodeId,
      table.lastActivityAt,
      table.id,
    ),
    check(
      'lesson_sessions_status_check',
      sql`${table.status} in ('active', 'archived')`,
    ),
    check(
      'lesson_sessions_archive_timestamp_check',
      sql`(${table.status} = 'active' and ${table.archivedAt} is null) or (${table.status} = 'archived' and ${table.archivedAt} is not null)`,
    ),
  ],
);

/**
 * K12 v1 用户可见消息账本。学生消息保存发送幂等证据，老师消息保存可恢复的生命周期；
 * Provider trace 和内部工具结果不写入该表。当前外键仍指向 lesson_sessions、角色仍是
 * student/assistant，不能被当作平台通用 Conversation 模型；通用数据骨架落地后迁移。
 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').notNull(),
    clientMessageId: text('client_message_id'),
    requestHash: text('request_hash'),
    role: text('role').notNull(),
    status: text('status').notNull(),
    content: text('content').notNull().default(''),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelRequestedAt: timestamp('cancel_requested_at', {
      withTimezone: true,
    }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    leaseId: uuid('lease_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('chat_messages_session_client_message_unique').on(
      table.sessionId,
      table.clientMessageId,
    ),
    uniqueIndex('chat_messages_session_turn_role_unique').on(
      table.sessionId,
      table.turnId,
      table.role,
    ),
    uniqueIndex('chat_messages_one_active_assistant_per_session')
      .on(table.sessionId)
      .where(
        sql`${table.role} = 'assistant' and ${table.status} in ('pending', 'streaming')`,
      ),
    index('chat_messages_history_cursor_idx').on(
      table.sessionId,
      table.createdAt,
      table.id,
    ),
    check(
      'chat_messages_role_check',
      sql`${table.role} in ('student', 'assistant')`,
    ),
    check(
      'chat_messages_status_check',
      sql`${table.status} in ('pending', 'streaming', 'completed', 'cancelled', 'interrupted', 'failed')`,
    ),
    check(
      'chat_messages_idempotency_fields_check',
      sql`(${table.role} = 'student' and ${table.clientMessageId} is not null and ${table.requestHash} is not null) or (${table.role} = 'assistant' and ${table.clientMessageId} is null and ${table.requestHash} is null)`,
    ),
    check(
      'chat_messages_terminal_timestamps_check',
      sql`(${table.status} in ('completed', 'failed', 'cancelled', 'interrupted') and ${table.completedAt} is not null) or (${table.status} in ('pending', 'streaming') and ${table.completedAt} is null)`,
    ),
    check(
      'chat_messages_cancelled_timestamp_check',
      sql`(${table.status} = 'cancelled' and ${table.cancelledAt} is not null and ${table.cancelRequestedAt} is not null) or (${table.status} <> 'cancelled' and ${table.cancelledAt} is null)`,
    ),
    check(
      'chat_messages_lease_shape_check',
      sql`(${table.role} = 'student' and ${table.leaseId} is null and ${table.leaseExpiresAt} is null and ${table.heartbeatAt} is null) or (${table.role} = 'assistant' and ${table.status} in ('pending', 'streaming') and ${table.leaseId} is not null and ${table.leaseExpiresAt} is not null and ${table.heartbeatAt} is not null) or (${table.role} = 'assistant' and ${table.status} in ('completed', 'cancelled', 'interrupted', 'failed') and ${table.leaseId} is null and ${table.leaseExpiresAt} is null)`,
    ),
  ],
);

/**
 * 消息的结构化 Part。chat_messages.content 保留为文本投影和历史兼容层；
 * Asset/Artifact 引用只保存不可变版本标识，不保存对象存储 URL。
 */
export const agentMessageParts = pgTable(
  'agent_message_parts',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    partIndex: integer('part_index').notNull(),
    partType: text('part_type').notNull(),
    textContent: text('text_content'),
    assetId: uuid('asset_id').references(() => assets.id),
    assetVersionId: uuid('asset_version_id').references(() => assetVersions.id),
    assetUsage: text('asset_usage'),
    artifactId: text('artifact_id'),
    artifactVersionId: text('artifact_version_id'),
    artifactKind: text('artifact_kind'),
  },
  (table) => [
    index('agent_message_parts_asset_fk_idx').on(table.assetId),
    primaryKey({ columns: [table.messageId, table.partIndex] }),
    index('agent_message_parts_asset_version_idx').on(table.assetVersionId),
    check(
      'agent_message_parts_index_check',
      sql`${table.partIndex} >= 0 and ${table.partIndex} < 32`,
    ),
    check(
      'agent_message_parts_type_check',
      // partType 决定同一行的列形状；新增分支必须同步 shape CHECK 与读取器，
      // 因而属于封闭结构判别符。artifactKind 才是可独立扩展的 Vocabulary。
      sql`${table.partType} in ('text', 'asset_ref', 'artifact_ref')`,
    ),
    check(
      'agent_message_parts_shape_check',
      sql`(${table.partType} = 'text' and ${table.textContent} is not null and ${table.assetId} is null and ${table.assetVersionId} is null and ${table.assetUsage} is null and ${table.artifactId} is null and ${table.artifactVersionId} is null and ${table.artifactKind} is null) or (${table.partType} = 'asset_ref' and ${table.textContent} is null and ${table.assetId} is not null and ${table.assetVersionId} is not null and ${table.assetUsage} in ('attachment', 'context') and ${table.artifactId} is null and ${table.artifactVersionId} is null and ${table.artifactKind} is null) or (${table.partType} = 'artifact_ref' and ${table.textContent} is null and ${table.assetId} is null and ${table.assetVersionId} is null and ${table.assetUsage} is null and ${table.artifactId} is not null and ${table.artifactVersionId} is not null and ${table.artifactKind} ~ '^[a-z][a-z0-9_]{0,63}$')`,
    ),
  ],
);

/**
 * 单次 Turn 实际选用的上下文清单。只保存不可变标识和计数，不复制消息/资产正文；
 * Prompt 正文仍由消息账本与 AssetVersion 在受控组合根中按需重建。
 */
export const turnContextSnapshots = pgTable(
  'turn_context_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => lessonSessions.id, {
      onDelete: 'cascade',
    }),
    turnId: uuid('turn_id'),
    agentOperationId: uuid('agent_operation_id').references(
      () => agentOperations.id,
      { onDelete: 'cascade' },
    ),
    builderVersion: text('builder_version').notNull(),
    includedMessageIds: jsonb('included_message_ids')
      .$type<string[]>()
      .notNull(),
    selectedAssetVersionIds: jsonb('selected_asset_version_ids')
      .$type<string[]>()
      .notNull(),
    /* ADR-0026 第 5 节：与 selected_asset_version_ids 同序的实际表示身份
       （null=无派生表示）。迁移必须带 DEFAULT '[]'：表在长期运行的库里
       非空，无 DEFAULT 的 NOT NULL 加列会直接失败；历史 Turn 未冻结身份
       以空数组表示可接受。 */
    selectedAssetRepresentations: jsonb('selected_asset_representations')
      .$type<(AssetVersionRepresentationIdentity | null)[]>()
      .notNull()
      .default([]),
    omittedMessageCount: integer('omitted_message_count').notNull(),
    characterCount: integer('character_count').notNull(),
    contextHash: text('context_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('turn_context_snapshots_operation_fk_idx').on(table.agentOperationId),
    uniqueIndex('turn_context_snapshots_session_turn_unique').on(
      table.sessionId,
      table.turnId,
    ),
    uniqueIndex('turn_context_snapshots_agent_operation_unique')
      .on(table.agentOperationId)
      .where(sql`${table.agentOperationId} is not null`),
    index('turn_context_snapshots_session_created_idx').on(
      table.sessionId,
      table.createdAt,
      table.id,
    ),
    check(
      'turn_context_snapshots_counts_check',
      sql`${table.omittedMessageCount} >= 0 and ${table.characterCount} >= 0 and ${table.characterCount} <= 128000`,
    ),
    check(
      'turn_context_snapshots_hash_check',
      sql`${table.contextHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'turn_context_snapshots_version_check',
      sql`char_length(${table.builderVersion}) between 1 and 128`,
    ),
    check(
      'turn_context_snapshots_scope_check',
      sql`(${table.sessionId} is not null and ${table.turnId} is not null and ${table.agentOperationId} is null) or (${table.sessionId} is null and ${table.turnId} is null and ${table.agentOperationId} is not null)`,
    ),
  ],
);
