import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  doublePrecision,
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
import type { AgentMessagePart } from '@educanvas/agent-core';

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

// 阶段一模块化单体的现行表集。它同时包含通用 Agent/Asset/RAG 账本和 K12 纵切，
// 物理同库不代表领域同层；目标边界与迁移顺序见 docs/04-data/data-design.md。

/** 通用资产、会话和产物的长期容器；不包含课程或教学状态。 */
export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerSubjectId: text('owner_subject_id').notNull(),
    kind: text('kind').notNull().default('personal'),
    title: text('title').notNull(),
    status: text('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('spaces_owner_status_updated_idx').on(
      table.ownerSubjectId,
      table.status,
      table.updatedAt,
      table.id,
    ),
    check(
      'spaces_kind_check',
      sql`${table.kind} in ('personal', 'notebook', 'course')`,
    ),
    check(
      'spaces_status_check',
      sql`${table.status} in ('active', 'archived')`,
    ),
    check(
      'spaces_text_check',
      sql`char_length(${table.ownerSubjectId}) between 1 and 160 and char_length(${table.title}) between 1 and 300`,
    ),
    check(
      'spaces_archive_shape_check',
      sql`(${table.status} = 'active' and ${table.archivedAt} is null) or (${table.status} = 'archived' and ${table.archivedAt} is not null)`,
    ),
  ],
);

/** Chat 主叙事线程；agentProfileId 选择能力组合，但不把垂直领域字段写入平台表。 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    ownerSubjectId: text('owner_subject_id').notNull(),
    agentProfileId: text('agent_profile_id').notNull().default('general'),
    title: text('title'),
    status: text('status').notNull().default('active'),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('conversations_owner_recent_idx').on(
      table.ownerSubjectId,
      table.status,
      table.lastActivityAt,
      table.id,
    ),
    index('conversations_space_recent_idx').on(
      table.spaceId,
      table.lastActivityAt,
      table.id,
    ),
    check(
      'conversations_status_check',
      sql`${table.status} in ('active', 'archived')`,
    ),
    check(
      'conversations_archive_shape_check',
      sql`(${table.status} = 'active' and ${table.archivedAt} is null) or (${table.status} = 'archived' and ${table.archivedAt} is not null)`,
    ),
    check(
      'conversations_text_check',
      sql`char_length(${table.ownerSubjectId}) between 1 and 160 and ${table.agentProfileId} ~ '^[a-z][a-z0-9._-]{0,127}$' and (${table.title} is null or char_length(${table.title}) between 1 and 300)`,
    ),
  ],
);

/** 通用 Agent/Artifact 操作信封；具体 Model Run 和 Tool Call 在后续迁移关联。 */
export const agentOperations = pgTable(
  'agent_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    traceId: text('trace_id').notNull(),
    status: text('status').notNull().default('pending'),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('agent_operations_conversation_idempotency_unique').on(
      table.conversationId,
      table.idempotencyKey,
    ),
    index('agent_operations_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
      table.id,
    ),
    check(
      'agent_operations_kind_check',
      sql`${table.kind} in ('turn', 'artifact_generation')`,
    ),
    check(
      'agent_operations_status_check',
      sql`${table.status} in ('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted')`,
    ),
    check(
      'agent_operations_text_check',
      sql`char_length(${table.idempotencyKey}) between 1 and 128 and char_length(${table.traceId}) between 1 and 128`,
    ),
  ],
);

/** 与K12 chat_messages并行的通用消息骨架；P1先支持持久化/恢复，后续再双写迁移。 */
export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    operationId: uuid('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),
    role: text('role').notNull(),
    status: text('status').notNull(),
    content: text('content').notNull().default(''),
    parts: jsonb('parts').$type<AgentMessagePart[]>().notNull().default([]),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('conversation_messages_history_idx').on(
      table.conversationId,
      table.createdAt,
      table.id,
    ),
    check(
      'conversation_messages_role_check',
      sql`${table.role} in ('system', 'user', 'assistant', 'tool')`,
    ),
    check(
      'conversation_messages_status_check',
      sql`${table.status} in ('pending', 'streaming', 'completed', 'failed', 'cancelled', 'interrupted')`,
    ),
    check(
      'conversation_messages_content_check',
      sql`char_length(${table.content}) <= 64000`,
    ),
    check(
      'conversation_messages_terminal_check',
      sql`(${table.status} in ('completed', 'failed', 'cancelled', 'interrupted') and ${table.completedAt} is not null) or (${table.status} in ('pending', 'streaming') and ${table.completedAt} is null)`,
    ),
  ],
);

/**
 * 教学状态机和审计的会话边界。阶段一尚未引入 users/courses 表，因此学生、年级和课程先用外部稳定标识；
 * 状态保留为 text 以允许状态机在早期演进而不频繁改枚举，取舍见 ADR-0003 与 docs/04-data/data-design.md。
 */
export const lessonSessions = pgTable(
  'lesson_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'restrict',
    }),
    studentId: text('student_id').notNull(),
    // 年级段和课程目录尚在迭代，阶段一用 text 接受稳定外部标识，待正式实体表落地后再加外键。
    gradeBand: text('grade_band').notNull(),
    courseSlug: text('course_slug').notNull(),
    knowledgeNodeId: text('knowledge_node_id'),
    // 状态机仍处早期演进期，text 避免每次新增教学分支都先修改数据库枚举。
    // 不设默认值：初始状态必须由 runtime 显式决定（新学生 DIAGNOSE、有掌握记录可直入 EXPLAIN），
    // 让"跳过诊断"成为显式决策而非默认值副作用，见 ADR-0004。
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
    uniqueIndex('lesson_sessions_active_scope_unique')
      .on(
        table.studentId,
        table.gradeBand,
        table.courseSlug,
        sql`coalesce(${table.knowledgeNodeId}, '')`,
      )
      .where(sql`${table.status} = 'active'`),
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
 * 平台通用 Asset。ownerSubjectId 与 spaceId 都是可信服务端解析出的不透明标识，
 * 对象存储地址只存在于不可变版本表。当前 K12 纵切尚无一等 Space 表，组合根会
 * 暂用 lessonSession.id 作为 spaceId，因此这里还不能提供 Workspace 级参照完整性；
 * 新增 spaces/conversations 后必须通过回填与双读迁移解除该临时绑定。
 */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerSubjectId: text('owner_subject_id').notNull(),
    spaceId: uuid('space_id').notNull(),
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
    index('assets_owner_space_status_idx').on(
      table.ownerSubjectId,
      table.spaceId,
      table.status,
      table.createdAt,
      table.id,
    ),
    check('assets_scope_check', sql`${table.scope} in ('turn', 'space')`),
    check(
      'assets_kind_check',
      sql`${table.kind} in ('image', 'audio', 'video', 'document', 'data', 'link', 'other')`,
    ),
    check(
      'assets_origin_check',
      sql`${table.origin} in ('upload', 'url_import', 'generated', 'library')`,
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
      sql`${table.kind} in ('image', 'audio', 'video', 'document', 'data', 'link', 'other')`,
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
    primaryKey({ columns: [table.messageId, table.partIndex] }),
    index('agent_message_parts_asset_version_idx').on(table.assetVersionId),
    check(
      'agent_message_parts_index_check',
      sql`${table.partIndex} >= 0 and ${table.partIndex} < 32`,
    ),
    check(
      'agent_message_parts_type_check',
      sql`${table.partType} in ('text', 'asset_ref', 'artifact_ref')`,
    ),
    check(
      'agent_message_parts_shape_check',
      sql`(${table.partType} = 'text' and ${table.textContent} is not null and ${table.assetId} is null and ${table.assetVersionId} is null and ${table.assetUsage} is null and ${table.artifactId} is null and ${table.artifactVersionId} is null and ${table.artifactKind} is null) or (${table.partType} = 'asset_ref' and ${table.textContent} is null and ${table.assetId} is not null and ${table.assetVersionId} is not null and ${table.assetUsage} in ('attachment', 'context') and ${table.artifactId} is null and ${table.artifactVersionId} is null and ${table.artifactKind} is null) or (${table.partType} = 'artifact_ref' and ${table.textContent} is null and ${table.assetId} is null and ${table.assetVersionId} is null and ${table.assetUsage} is null and ${table.artifactId} is not null and ${table.artifactVersionId} is not null and ${table.artifactKind} in ('image', 'audio', 'video', 'slide', 'interactive', 'document'))`,
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
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').notNull(),
    builderVersion: text('builder_version').notNull(),
    includedMessageIds: jsonb('included_message_ids')
      .$type<string[]>()
      .notNull(),
    selectedAssetVersionIds: jsonb('selected_asset_version_ids')
      .$type<string[]>()
      .notNull(),
    omittedMessageCount: integer('omitted_message_count').notNull(),
    characterCount: integer('character_count').notNull(),
    contextHash: text('context_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('turn_context_snapshots_session_turn_unique').on(
      table.sessionId,
      table.turnId,
    ),
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
  ],
);

/** 模型运行是与可见消息分层的审计记录；D1 只允许 teaching_turn operation。 */
export const modelRuns = pgTable(
  'model_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    operationId: uuid('operation_id').notNull(),
    operationKind: text('operation_kind').notNull(),
    assistantMessageId: uuid('assistant_message_id').references(
      () => chatMessages.id,
      { onDelete: 'cascade' },
    ),
    turnId: uuid('turn_id'),
    phase: text('phase').notNull(),
    attempt: integer('attempt').notNull().default(1),
    traceId: text('trace_id').notNull(),
    taskAlias: text('task_alias').notNull(),
    modelAlias: text('model_alias').notNull(),
    promptVersion: text('prompt_version').notNull(),
    promptHash: text('prompt_hash').notNull(),
    provider: text('provider'),
    providerModelId: text('provider_model_id'),
    modelRevision: text('model_revision'),
    providerResponseId: text('provider_response_id'),
    systemFingerprint: text('system_fingerprint'),
    finishReason: text('finish_reason'),
    status: text('status').notNull().default('pending'),
    errorCode: text('error_code'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheHitTokens: integer('cache_hit_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    latencyMs: integer('latency_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('model_runs_operation_phase_attempt_unique').on(
      table.operationKind,
      table.operationId,
      table.phase,
      table.attempt,
    ),
    index('model_runs_session_turn_idx').on(table.sessionId, table.turnId),
    check(
      'model_runs_teaching_turn_shape_check',
      sql`${table.operationKind} = 'teaching_turn' and ${table.assistantMessageId} is not null and ${table.turnId} is not null and ${table.operationId} = ${table.turnId} and ${table.phase} in ('answer', 'synthesis')`,
    ),
    check(
      'model_runs_status_check',
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')`,
    ),
    check('model_runs_attempt_check', sql`${table.attempt} >= 1`),
    check(
      'model_runs_usage_check',
      sql`coalesce(${table.inputTokens}, 0) >= 0 and coalesce(${table.outputTokens}, 0) >= 0 and coalesce(${table.cacheHitTokens}, 0) >= 0 and coalesce(${table.reasoningTokens}, 0) >= 0 and coalesce(${table.latencyMs}, 0) >= 0`,
    ),
    check(
      'model_runs_lifecycle_timestamps_check',
      sql`(${table.status} = 'pending' and ${table.startedAt} is null and ${table.completedAt} is null) or (${table.status} = 'running' and ${table.startedAt} is not null and ${table.completedAt} is null) or (${table.status} in ('succeeded', 'failed', 'cancelled', 'interrupted') and ${table.completedAt} is not null)`,
    ),
  ],
);

/**
 * Provider tool call 的脱敏审计账本。参数与结果只保存服务端生成的结构摘要，
 * 不保存原始值、异常消息、堆栈或供应商推理内容。
 */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').notNull(),
    answerModelRunId: uuid('answer_model_run_id')
      .notNull()
      .references(() => modelRuns.id, { onDelete: 'cascade' }),
    providerToolCallId: text('provider_tool_call_id').notNull(),
    executionId: text('execution_id').notNull(),
    requestHash: text('request_hash').notNull(),
    traceId: text('trace_id').notNull(),
    toolName: text('tool_name'),
    teachingState: text('teaching_state').notNull(),
    exposure: text('exposure'),
    effect: text('effect'),
    argumentSummary: jsonb('argument_summary').notNull(),
    resultSummary: jsonb('result_summary'),
    status: text('status').notNull().default('pending'),
    code: text('code'),
    retryable: boolean('retryable').notNull().default(false),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('tool_calls_execution_id_unique').on(table.executionId),
    uniqueIndex('tool_calls_model_provider_call_unique').on(
      table.answerModelRunId,
      table.providerToolCallId,
    ),
    index('tool_calls_session_turn_idx').on(table.sessionId, table.turnId),
    check(
      'tool_calls_status_check',
      sql`${table.status} in ('pending', 'running', 'succeeded', 'rejected', 'failed', 'outcome_unknown')`,
    ),
    check(
      'tool_calls_exposure_check',
      sql`${table.exposure} is null or ${table.exposure} in ('model', 'runtime')`,
    ),
    check(
      'tool_calls_effect_check',
      sql`${table.effect} is null or ${table.effect} in ('read', 'write')`,
    ),
    check(
      'tool_calls_lifecycle_check',
      sql`(${table.status} = 'pending' and ${table.startedAt} is null and ${table.completedAt} is null) or (${table.status} = 'running' and ${table.startedAt} is not null and ${table.completedAt} is null) or (${table.status} in ('succeeded', 'rejected', 'failed', 'outcome_unknown') and ${table.completedAt} is not null)`,
    ),
    check(
      'tool_calls_result_shape_check',
      sql`(${table.status} = 'succeeded' and ${table.resultSummary} is not null and ${table.code} is null) or (${table.status} in ('rejected', 'failed', 'outcome_unknown') and ${table.resultSummary} is null and ${table.code} is not null) or (${table.status} in ('pending', 'running') and ${table.resultSummary} is null and ${table.code} is null)`,
    ),
    check(
      'tool_calls_duration_check',
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
  ],
);

/**
 * Turn 输入/输出的安全决策审计。该表刻意不提供正文、Prompt、推理或 detector payload 字段，
 * 只保存可关联、可版本化的稳定分类结果。
 */
export const turnSafetyDecisions = pgTable(
  'turn_safety_decisions',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').notNull(),
    phase: text('phase').notNull(),
    policyVersion: text('policy_version').notNull(),
    category: text('category').notNull(),
    action: text('action').notNull(),
    detectorVersion: text('detector_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'turn_safety_decisions_turn_phase_policy_category_pk',
      columns: [table.turnId, table.phase, table.policyVersion, table.category],
    }),
    index('turn_safety_decisions_session_turn_created_idx').on(
      table.sessionId,
      table.turnId,
      table.createdAt,
    ),
    index('turn_safety_decisions_category_action_created_idx').on(
      table.category,
      table.action,
      table.createdAt,
    ),
    check(
      'turn_safety_decisions_phase_check',
      sql`${table.phase} in ('input', 'output')`,
    ),
    check(
      'turn_safety_decisions_category_check',
      sql`${table.category} in ('normal', 'pii', 'prompt_injection', 'self_harm', 'abuse', 'sexual_content', 'violence', 'dangerous_behavior')`,
    ),
    check(
      'turn_safety_decisions_action_check',
      sql`${table.action} in ('allow', 'block', 'escalate')`,
    ),
    check(
      'turn_safety_decisions_policy_version_check',
      sql`${table.policyVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'`,
    ),
    check(
      'turn_safety_decisions_detector_version_check',
      sql`${table.detectorVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'`,
    ),
  ],
);

/** 课程范围内由受控任务创建的审核资料入口；不属于任何单一学生。 */
export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gradeBand: text('grade_band').notNull(),
    courseSlug: text('course_slug').notNull(),
    sourceKey: text('source_key').notNull(),
    title: text('title').notNull(),
    sourceType: text('source_type').notNull(),
    status: text('status').notNull().default('active'),
    tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_sources_course_key_unique').on(
      table.gradeBand,
      table.courseSlug,
      table.sourceKey,
    ),
    index('knowledge_sources_course_status_idx').on(
      table.gradeBand,
      table.courseSlug,
      table.status,
      table.id,
    ),
    check(
      'knowledge_sources_type_check',
      sql`${table.sourceType} in ('text', 'pdf')`,
    ),
    check(
      'knowledge_sources_status_check',
      sql`${table.status} in ('active', 'tombstoned')`,
    ),
    check(
      'knowledge_sources_tombstone_check',
      sql`(${table.status} = 'active' and ${table.tombstonedAt} is null) or (${table.status} = 'tombstoned' and ${table.tombstonedAt} is not null)`,
    ),
    check(
      'knowledge_sources_text_shape_check',
      sql`char_length(${table.gradeBand}) between 1 and 64 and char_length(${table.courseSlug}) between 1 and 128 and char_length(${table.sourceKey}) between 1 and 128 and char_length(${table.title}) between 1 and 300`,
    ),
  ],
);

/**
 * 资料的不可变内容版本。状态只表达解析/发布生命周期；hash、object key、版本号与解析器版本
 * 一经创建不得由仓储修改。
 */
export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => knowledgeSources.id),
    version: integer('version').notNull(),
    contentHash: text('content_hash').notNull(),
    objectKey: text('object_key').notNull(),
    parserVersion: text('parser_version').notNull(),
    parseStatus: text('parse_status').notNull(),
    failureCode: text('failure_code'),
    parsedAt: timestamp('parsed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_documents_source_hash_unique').on(
      table.sourceId,
      table.contentHash,
    ),
    uniqueIndex('knowledge_documents_source_version_unique').on(
      table.sourceId,
      table.version,
    ),
    uniqueIndex('knowledge_documents_one_ready_per_source')
      .on(table.sourceId)
      .where(sql`${table.parseStatus} = 'ready'`),
    index('knowledge_documents_source_status_version_idx').on(
      table.sourceId,
      table.parseStatus,
      table.version,
    ),
    check('knowledge_documents_version_check', sql`${table.version} >= 1`),
    check(
      'knowledge_documents_hash_check',
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'knowledge_documents_object_key_check',
      sql`char_length(${table.objectKey}) between 1 and 1024 and ${table.objectKey} !~* '^https?://'`,
    ),
    check(
      'knowledge_documents_parser_version_check',
      sql`${table.parserVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'`,
    ),
    check(
      'knowledge_documents_status_check',
      sql`${table.parseStatus} in ('ready', 'parse_failed', 'superseded', 'tombstoned')`,
    ),
    check(
      'knowledge_documents_failure_shape_check',
      sql`(${table.parseStatus} = 'parse_failed' and ${table.failureCode} is not null and char_length(${table.failureCode}) between 1 and 128) or (${table.parseStatus} <> 'parse_failed' and ${table.failureCode} is null)`,
    ),
  ],
);

/** 不可变教材片段；全文向量由PostgreSQL从审核文本生成并以GIN索引。 */
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id),
    chunkIndex: integer('chunk_index').notNull(),
    contentHash: text('content_hash').notNull(),
    content: text('content').notNull(),
    heading: text('heading'),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    searchVector: tsvector('search_vector')
      .notNull()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("heading", '') || ' ' || "content")`,
      ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_chunks_document_index_unique').on(
      table.documentId,
      table.chunkIndex,
    ),
    index('knowledge_chunks_document_idx').on(table.documentId, table.id),
    index('knowledge_chunks_fts_idx').using('gin', table.searchVector),
    check('knowledge_chunks_index_check', sql`${table.chunkIndex} >= 0`),
    check(
      'knowledge_chunks_hash_check',
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'knowledge_chunks_content_check',
      sql`char_length(${table.content}) between 1 and 20000 and (${table.heading} is null or char_length(${table.heading}) between 1 and 500)`,
    ),
    check(
      'knowledge_chunks_page_check',
      sql`(${table.pageStart} is null and ${table.pageEnd} is null) or (${table.pageStart} is not null and ${table.pageEnd} is not null and ${table.pageStart} >= 1 and ${table.pageEnd} >= ${table.pageStart})`,
    ),
    uniqueIndex('knowledge_chunks_id_document_unique').on(
      table.id,
      table.documentId,
    ),
  ],
);

/** Session对课程source的启用/停用事实流；同一mutation重放不得产生第二条事实。 */
export const sessionSourceBindings = pgTable(
  'session_source_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => knowledgeSources.id),
    sequence: integer('sequence').notNull(),
    enabled: boolean('enabled').notNull(),
    mutationId: text('mutation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('session_source_bindings_session_mutation_unique').on(
      table.sessionId,
      table.mutationId,
    ),
    uniqueIndex('session_source_bindings_session_source_sequence_unique').on(
      table.sessionId,
      table.sourceId,
      table.sequence,
    ),
    index('session_source_bindings_latest_idx').on(
      table.sessionId,
      table.sourceId,
      table.sequence,
    ),
    check(
      'session_source_bindings_sequence_check',
      sql`${table.sequence} >= 1`,
    ),
    check(
      'session_source_bindings_mutation_check',
      sql`${table.mutationId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'`,
    ),
  ],
);

/** Turn 的资料快照完成事实；即使本轮没有可用资料，也必须留下不可变 marker。 */
export const turnSourceSnapshots = pgTable(
  'turn_source_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('turn_source_snapshots_session_turn_unique').on(
      table.sessionId,
      table.turnId,
    ),
  ],
);

/** Turn开始时冻结的source→document不可变版本；后续换版不会改写历史快照。 */
export const turnSourceVersions = pgTable(
  'turn_source_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => knowledgeSources.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id),
    documentVersion: integer('document_version').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('turn_source_versions_turn_source_unique').on(
      table.turnId,
      table.sourceId,
    ),
    index('turn_source_versions_session_turn_idx').on(
      table.sessionId,
      table.turnId,
      table.id,
    ),
    uniqueIndex('turn_source_versions_id_document_unique').on(
      table.id,
      table.documentId,
    ),
    check(
      'turn_source_versions_document_version_check',
      sql`${table.documentVersion} >= 1`,
    ),
    check(
      'turn_source_versions_hash_check',
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

/** 本轮实际返回给Orchestrator的候选白名单；不保存学生查询原文。 */
export const retrievalCandidates = pgTable(
  'retrieval_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').notNull(),
    turnSourceVersionId: uuid('turn_source_version_id').notNull(),
    chunkId: uuid('chunk_id').notNull(),
    /** 冻结候选所属文档，供两个复合外键证明 snapshot 与 chunk 来自同一文档。 */
    documentId: uuid('document_id').notNull(),
    retriever: text('retriever').notNull(),
    retrieverVersion: text('retriever_version').notNull(),
    rank: integer('rank').notNull(),
    score: doublePrecision('score').notNull(),
    queryHash: text('query_hash').notNull(),
    traceId: text('trace_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('retrieval_candidates_query_rank_unique').on(
      table.turnId,
      table.queryHash,
      table.retriever,
      table.retrieverVersion,
      table.rank,
    ),
    uniqueIndex('retrieval_candidates_query_chunk_unique').on(
      table.turnId,
      table.queryHash,
      table.retriever,
      table.retrieverVersion,
      table.chunkId,
    ),
    index('retrieval_candidates_session_turn_rank_idx').on(
      table.sessionId,
      table.turnId,
      table.rank,
    ),
    foreignKey({
      columns: [table.turnSourceVersionId, table.documentId],
      foreignColumns: [turnSourceVersions.id, turnSourceVersions.documentId],
      name: 'retrieval_candidates_snapshot_document_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.chunkId, table.documentId],
      foreignColumns: [knowledgeChunks.id, knowledgeChunks.documentId],
      name: 'retrieval_candidates_chunk_document_fk',
    }),
    check('retrieval_candidates_rank_check', sql`${table.rank} >= 1`),
    check(
      'retrieval_candidates_score_check',
      sql`${table.score} >= 0 and ${table.score} <= 1`,
    ),
    check(
      'retrieval_candidates_query_hash_check',
      sql`${table.queryHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'retrieval_candidates_version_check',
      sql`${table.retriever} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' and ${table.retrieverVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'`,
    ),
  ],
);

/** 老师消息只引用本轮已持久化candidate，不接受source/document/chunk直达字段。 */
export const messageCitations = pgTable(
  'message_citations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').notNull(),
    assistantMessageId: uuid('assistant_message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    retrievalCandidateId: uuid('retrieval_candidate_id')
      .notNull()
      .references(() => retrievalCandidates.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('message_citations_message_ordinal_unique').on(
      table.assistantMessageId,
      table.ordinal,
    ),
    uniqueIndex('message_citations_message_candidate_unique').on(
      table.assistantMessageId,
      table.retrievalCandidateId,
    ),
    index('message_citations_session_turn_idx').on(
      table.sessionId,
      table.turnId,
      table.ordinal,
    ),
    check('message_citations_ordinal_check', sql`${table.ordinal} >= 1`),
  ],
);

/**
 * 保存已经白名单校验的 Artifact 快照，供学习过程回放、问题审计和协议兼容使用。
 * `params` 使用 JSONB 是因为不同 Artifact 的联合参数结构不同，但写入前仍必须通过 canvas-protocol；见 ADR-0002。
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('canvas_artifacts_session_artifact_unique').on(
      table.sessionId,
      table.artifactId,
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
 * `schemaVersion` 用于消费端兼容演进，口径见 docs/04-data/data-design.md。
 */
export const learningEvents = pgTable(
  'learning_events',
  {
    // 直接保存领域事件eventId，避免数据库ID与事件信封出现双重身份。
    id: uuid('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    studentId: text('student_id').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id),
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
  ],
);

/**
 * 每个“学生 × 知识节点”只有一行可计算掌握状态，复合主键防止同一口径出现多份当前值。
 * 分数用 real 支持连续更新，次数字段保留可解释证据，JSONB 标签允许误区分类逐步扩展；
 * `version` 已由Drizzle适配器用于并发更新的乐观锁，模型不得直接决定这些值，见 docs/04-data/data-design.md。
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
