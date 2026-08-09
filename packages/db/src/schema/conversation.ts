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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { GatewayOperationEvent } from '@educanvas/gateway-core';
import type { AgentMessagePart } from '@educanvas/agent-core';
import { personalAgents, platformUsers } from './identity';
import { spaces } from './workspace';
import { assetVersions } from './asset';

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
    uniqueIndex('conversations_id_space_unique').on(table.id, table.spaceId),
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
    gatewayEnvelopeId: text('gateway_envelope_id'),
    requestFingerprint: text('request_fingerprint'),
    actorUserId: text('actor_user_id').references(() => platformUsers.id, {
      onDelete: 'restrict',
    }),
    agentId: uuid('agent_id').references(() => personalAgents.id, {
      onDelete: 'restrict',
    }),
    notebookId: uuid('notebook_id').references(() => spaces.id, {
      onDelete: 'restrict',
    }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    traceId: text('trace_id').notNull(),
    status: text('status').notNull().default('pending'),
    failureCode: text('failure_code'),
    cancelRequestedAt: timestamp('cancel_requested_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('agent_operations_notebook_fk_idx').on(table.notebookId),
    uniqueIndex('agent_operations_actor_conversation_idempotency_unique').on(
      table.conversationId,
      sql`coalesce(${table.actorUserId}, '')`,
      table.idempotencyKey,
    ),
    uniqueIndex('agent_operations_gateway_envelope_unique')
      .on(table.gatewayEnvelopeId)
      .where(sql`${table.gatewayEnvelopeId} is not null`),
    index('agent_operations_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex('agent_operations_conversation_id_unique').on(
      table.conversationId,
      table.id,
    ),
    foreignKey({
      columns: [table.conversationId, table.notebookId],
      foreignColumns: [conversations.id, conversations.spaceId],
      name: 'agent_operations_conversation_notebook_fk',
    }).onDelete('restrict'),
    check(
      'agent_operations_kind_check',
      sql`${table.kind} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'agent_operations_status_check',
      sql`${table.status} in ('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted')`,
    ),
    check(
      'agent_operations_text_check',
      sql`char_length(${table.idempotencyKey}) between 1 and 128 and char_length(${table.traceId}) between 1 and 128`,
    ),
    check(
      'agent_operations_gateway_shape_check',
      sql`(${table.gatewayEnvelopeId} is null and ${table.requestFingerprint} is null and ((${table.actorUserId} is null and ${table.agentId} is null and ${table.notebookId} is null) or (${table.actorUserId} is not null and ${table.agentId} is not null and ${table.notebookId} is not null))) or (${table.gatewayEnvelopeId} is not null and char_length(${table.gatewayEnvelopeId}) between 1 and 160 and ${table.requestFingerprint} ~ '^[a-f0-9]{64}$' and ${table.actorUserId} is not null and ${table.agentId} is not null and ${table.notebookId} is not null)`,
    ),
  ],
);

/** Gateway 对客户端公开的可恢复事件流；payload 必须再次通过 gateway-core 解析。 */
export const gatewayOperationEvents = pgTable(
  'gateway_operation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<GatewayOperationEvent>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('gateway_operation_events_sequence_unique').on(
      table.operationId,
      table.sequence,
    ),
    /* 恢复读取直接复用 gateway_operation_events_sequence_unique：它的列与顺序
       完全相同，再建一条非唯一副本只增加写放大，不改变任何查询计划。 */
    check(
      'gateway_operation_events_sequence_check',
      sql`${table.sequence} >= 0`,
    ),
    check(
      'gateway_operation_events_payload_check',
      sql`jsonb_typeof(${table.payload}) = 'object' and ${table.payload}->>'type' = ${table.type}`,
    ),
  ],
);

export const gatewayApprovals = pgTable(
  'gateway_approvals',
  {
    id: text('id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    capability: text('capability').notNull(),
    risk: text('risk').notNull(),
    summary: text('summary').notNull(),
    status: text('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedByUserId: text('decided_by_user_id').references(
      () => platformUsers.id,
      { onDelete: 'restrict' },
    ),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    reason: text('reason'),
  },
  (table) => [
    index('gateway_approvals_operation_fk_idx').on(table.operationId),
    index('gateway_approvals_actor_status_idx').on(
      table.actorUserId,
      table.status,
      table.expiresAt,
    ),
    check('gateway_approvals_risk_check', sql`${table.risk} in ('l2', 'l3')`),
    check(
      'gateway_approvals_status_check',
      sql`${table.status} in ('pending', 'approved', 'denied', 'expired', 'revoked')`,
    ),
    check(
      'gateway_approvals_time_check',
      sql`${table.expiresAt} > ${table.requestedAt}`,
    ),
    check(
      'gateway_approvals_decision_check',
      sql`(${table.status} = 'pending' and ${table.decidedByUserId} is null and ${table.decidedAt} is null) or (${table.status} <> 'pending' and ${table.decidedByUserId} is not null and ${table.decidedAt} is not null)`,
    ),
  ],
);

export const gatewayDeliveries = pgTable(
  'gateway_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    envelopeId: text('envelope_id').notNull(),
    targetKind: text('target_kind').notNull(),
    target: jsonb('target').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'),
    attempt: integer('attempt').notNull().default(1),
    externalMessageId: text('external_message_id'),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('gateway_deliveries_envelope_target_unique').on(
      table.envelopeId,
      table.targetKind,
    ),
    index('gateway_deliveries_operation_status_idx').on(
      table.operationId,
      table.status,
    ),
    check(
      'gateway_deliveries_status_check',
      sql`${table.status} in ('pending', 'sent', 'acknowledged', 'failed', 'expired')`,
    ),
    check(
      'gateway_deliveries_shape_check',
      sql`${table.attempt} between 1 and 100 and jsonb_typeof(${table.target}) = 'object' and ((${table.status} = 'failed' and ${table.failureCode} is not null) or (${table.status} <> 'failed' and ${table.failureCode} is null))`,
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
    operationId: uuid('operation_id'),
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
    foreignKey({
      columns: [table.conversationId, table.operationId],
      foreignColumns: [agentOperations.conversationId, agentOperations.id],
      name: 'conversation_messages_operation_scope_fk',
    }).onDelete('restrict'),
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
 * 通用 Agent Operation 本轮实际读取的来源白名单。网页正文先落为不可变
 * AssetVersion，再由这里冻结本轮编号和公开定位；搜索摘要不能直接进入该表。
 */
export const operationSources = pgTable(
  'operation_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id').notNull(),
    assetVersionId: uuid('asset_version_id').notNull(),
    kind: text('kind').notNull(),
    ordinal: integer('ordinal').notNull(),
    label: text('label').notNull(),
    locatorUrl: text('locator_url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.operationId],
      foreignColumns: [agentOperations.id],
      name: 'operation_sources_operation_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.assetVersionId],
      foreignColumns: [assetVersions.id],
      name: 'operation_sources_asset_version_fk',
    }).onDelete('restrict'),
    uniqueIndex('operation_sources_operation_ordinal_unique').on(
      table.operationId,
      table.ordinal,
    ),
    uniqueIndex('operation_sources_operation_url_unique').on(
      table.operationId,
      table.locatorUrl,
    ),
    index('operation_sources_asset_version_idx').on(table.assetVersionId),
    check(
      'operation_sources_kind_check',
      sql`${table.kind} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'operation_sources_ordinal_check',
      sql`${table.ordinal} between 1 and 99`,
    ),
    check(
      'operation_sources_public_shape_check',
      sql`char_length(${table.label}) between 1 and 400 and char_length(${table.locatorUrl}) between 8 and 2048 and ${table.locatorUrl} ~* '^https?://'`,
    ),
  ],
);

/** 通用消息只引用同一 Operation 已冻结的来源，不接受浏览器直写 URL/Asset。 */
export const conversationMessageCitations = pgTable(
  'conversation_message_citations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assistantMessageId: uuid('assistant_message_id').notNull(),
    operationSourceId: uuid('operation_source_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('conversation_message_citations_source_fk_idx').on(
      table.operationSourceId,
    ),
    foreignKey({
      columns: [table.assistantMessageId],
      foreignColumns: [conversationMessages.id],
      name: 'conversation_citations_message_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.operationSourceId],
      foreignColumns: [operationSources.id],
      name: 'conversation_citations_source_fk',
    }).onDelete('cascade'),
    uniqueIndex('conversation_message_citations_message_source_unique').on(
      table.assistantMessageId,
      table.operationSourceId,
    ),
    /* 按消息读取引用复用 conversation_message_citations_message_source_unique：
       assistant_message_id 是它的左前缀，单列副本没有额外读取价值。 */
  ],
);
