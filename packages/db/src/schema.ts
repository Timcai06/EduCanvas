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
import type {
  GatewayCapabilityManifest,
  GatewayOperationEvent,
} from '@educanvas/gateway-core';

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

// 阶段一模块化单体的现行表集。它同时包含通用 Agent/Asset/RAG 账本和 K12 纵切，
// 物理同库不代表领域同层；目标边界与迁移顺序见 docs/04-data/data-design.md。

/** 正式平台主体；匿名兼容主体也使用服务端派生 ID，不保存原始 bearer。 */
export const platformUsers = pgTable(
  'platform_users',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'platform_users_id_check',
      sql`char_length(${table.id}) between 1 and 160`,
    ),
    check(
      'platform_users_kind_check',
      sql`${table.kind} in ('registered', 'anonymous_compat')`,
    ),
    check(
      'platform_users_status_check',
      sql`${table.status} in ('active', 'suspended', 'deleted')`,
    ),
  ],
);

/** 当前产品模型是一位自然人一个个人 Agent；专业行为通过 Profile/Skill 组合。 */
export const personalAgents = pgTable(
  'personal_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('personal_agents_user_unique').on(table.userId),
    check(
      'personal_agents_status_check',
      sql`${table.status} in ('active', 'suspended')`,
    ),
  ],
);

/** Web 本地账号凭据边界；只保存派生密码材料，不保存明文密码或原始 session token。 */
export const webUserCredentials = pgTable(
  'web_user_credentials',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    usernameNormalized: text('username_normalized').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    passwordParams: jsonb('password_params').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('web_user_credentials_username_unique').on(
      table.usernameNormalized,
    ),
    check(
      'web_user_credentials_username_check',
      sql`${table.usernameNormalized} ~ '^[a-z0-9][a-z0-9_-]{2,31}$'`,
    ),
    check(
      'web_user_credentials_password_material_check',
      sql`${table.passwordHash} ~ '^[A-Za-z0-9_-]{43,128}$' and ${table.passwordSalt} ~ '^[A-Za-z0-9_-]{16,128}$' and jsonb_typeof(${table.passwordParams}) = 'object'`,
    ),
  ],
);

/** Web 个人资料；头像只保存私有对象 key，浏览器通过受控 route 读取。 */
export const webUserProfiles = pgTable(
  'web_user_profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    avatarObjectKey: text('avatar_object_key'),
    avatarMimeType: text('avatar_mime_type'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'web_user_profiles_nickname_check',
      sql`char_length(${table.nickname}) between 1 and 30 and ${table.nickname} !~ '[[:cntrl:]]'`,
    ),
    check(
      'web_user_profiles_avatar_check',
      sql`(${table.avatarObjectKey} is null and ${table.avatarMimeType} is null) or (${table.avatarObjectKey} ~ '^assets/[a-f0-9]{16}/[0-9a-f-]+\\.[a-z0-9]+$' and ${table.avatarMimeType} in ('image/png', 'image/jpeg', 'image/webp'))`,
    ),
  ],
);

/** Web 登录 session；cookie 保存原始 token，数据库只保存 SHA-256 hash。 */
export const webSessions = pgTable(
  'web_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('web_sessions_token_hash_unique').on(table.tokenHash),
    index('web_sessions_user_active_idx').on(
      table.userId,
      table.expiresAt,
      table.revokedAt,
    ),
    check(
      'web_sessions_token_hash_check',
      sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'web_sessions_lifecycle_check',
      sql`${table.expiresAt} > ${table.createdAt} and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt})`,
    ),
  ],
);

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

/** Notebook 协作只共享显式资源，不传播个人 Agent 的私有权限。 */
export const notebookMemberships = pgTable(
  'notebook_memberships',
  {
    notebookId: uuid('notebook_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.notebookId, table.userId] }),
    index('notebook_memberships_user_active_idx').on(
      table.userId,
      table.revokedAt,
      table.notebookId,
    ),
    check(
      'notebook_memberships_role_check',
      sql`${table.role} in ('owner', 'editor', 'contributor', 'viewer')`,
    ),
    check(
      'notebook_memberships_time_check',
      sql`(${table.expiresAt} is null or ${table.expiresAt} > ${table.grantedAt}) and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt})`,
    ),
  ],
);

/** 教师、家长和管理员的范围委托；不能用于主体冒充。 */
export const delegatedGrants = pgTable(
  'delegated_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    granteeUserId: text('grantee_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    subjectUserId: text('subject_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    notebookId: uuid('notebook_id').references(() => spaces.id, {
      onDelete: 'cascade',
    }),
    scopes: text('scopes').array().notNull(),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('delegated_grants_grantee_active_idx').on(
      table.granteeUserId,
      table.expiresAt,
      table.revokedAt,
    ),
    check(
      'delegated_grants_kind_check',
      sql`${table.kind} in ('education.teacher', 'education.guardian', 'platform.operator')`,
    ),
    check(
      'delegated_grants_time_check',
      sql`${table.expiresAt} > ${table.grantedAt} and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt})`,
    ),
    check(
      'delegated_grants_scopes_check',
      sql`cardinality(${table.scopes}) between 1 and 16`,
    ),
  ],
);

export const gatewayChannelAccountBindings = pgTable(
  'gateway_channel_account_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adapterId: text('adapter_id').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => personalAgents.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    activationExpiresAt: timestamp('activation_expires_at', {
      withTimezone: true,
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('gateway_channel_account_external_unique').on(
      table.adapterId,
      table.externalAccountId,
    ),
    check(
      'gateway_channel_account_status_check',
      sql`${table.status} in ('pending', 'active', 'revoked')`,
    ),
    check(
      'gateway_channel_account_text_check',
      sql`char_length(${table.adapterId}) between 1 and 160 and char_length(${table.externalAccountId}) between 1 and 160`,
    ),
    check(
      'gateway_channel_account_activation_check',
      sql`${table.activationExpiresAt} is null or (${table.status} = 'pending' and ${table.activationExpiresAt} > ${table.createdAt})`,
    ),
  ],
);

export const gatewayChannelThreadBindings = pgTable(
  'gateway_channel_thread_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountBindingId: uuid('account_binding_id')
      .notNull()
      .references(() => gatewayChannelAccountBindings.id, {
        onDelete: 'cascade',
      }),
    externalThreadId: text('external_thread_id').notNull(),
    threadKind: text('thread_kind').notNull(),
    notebookId: uuid('notebook_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(
      (): AnyPgColumn => conversations.id,
      {
        onDelete: 'set null',
      },
    ),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('gateway_channel_thread_external_unique').on(
      table.accountBindingId,
      table.externalThreadId,
    ),
    check(
      'gateway_channel_thread_kind_check',
      sql`${table.threadKind} in ('private', 'group')`,
    ),
    check(
      'gateway_channel_thread_status_check',
      sql`${table.status} in ('pending', 'active', 'revoked')`,
    ),
  ],
);

/**
 * 跨客户端交接的短期授权账本。只保存 SHA-256 摘要而不保存 URL 中的原始凭证；
 * PostgreSQL 负责原子消费和到期判断，避免多进程下依赖内存锁或新增 Redis。
 */
export const gatewayHandoffTokens = pgTable(
  'gateway_handoff_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenDigest: text('token_digest').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references((): AnyPgColumn => conversations.id, {
        onDelete: 'cascade',
      }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('gateway_handoff_tokens_digest_unique').on(table.tokenDigest),
    index('gateway_handoff_tokens_user_expiry_idx').on(
      table.userId,
      table.expiresAt,
    ),
    check(
      'gateway_handoff_tokens_digest_check',
      sql`${table.tokenDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'gateway_handoff_tokens_time_check',
      sql`${table.expiresAt} > ${table.issuedAt} and (${table.consumedAt} is null or ${table.consumedAt} >= ${table.issuedAt})`,
    ),
  ],
);

export const gatewayNodePairings = pgTable(
  'gateway_node_pairings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id').notNull().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => personalAgents.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    devicePublicKey: text('device_public_key').notNull(),
    approvedCapabilities: jsonb('approved_capabilities')
      .$type<GatewayCapabilityManifest>()
      .notNull(),
    status: text('status').notNull().default('pending'),
    pairedAt: timestamp('paired_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('gateway_node_pairings_node_unique').on(table.nodeId),
    index('gateway_node_pairings_user_status_idx').on(
      table.userId,
      table.status,
    ),
    check(
      'gateway_node_pairings_status_check',
      sql`${table.status} in ('pending', 'active', 'offline', 'revoked')`,
    ),
    check(
      'gateway_node_pairings_text_check',
      sql`char_length(${table.displayName}) between 1 and 120 and char_length(${table.devicePublicKey}) between 32 and 8192`,
    ),
    check(
      'gateway_node_pairings_capabilities_check',
      sql`jsonb_typeof(${table.approvedCapabilities}) = 'object'`,
    ),
  ],
);

export const gatewayNodeInvocations = pgTable(
  'gateway_node_invocations',
  {
    requestId: text('request_id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').notNull(),
    capability: text('capability').notNull(),
    parameters: jsonb('parameters').$type<unknown>().notNull(),
    nonce: text('nonce').notNull(),
    status: text('status').notNull().default('pending'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    result: jsonb('result').$type<unknown>(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.nodeId],
      foreignColumns: [gatewayNodePairings.nodeId],
      name: 'gateway_node_invocations_node_fk',
    }).onDelete('cascade'),
    uniqueIndex('gateway_node_invocations_node_nonce_unique').on(
      table.nodeId,
      table.nonce,
    ),
    index('gateway_node_invocations_poll_idx').on(
      table.nodeId,
      table.status,
      table.issuedAt,
    ),
    check(
      'gateway_node_invocations_capability_check',
      sql`${table.capability} in ('device.status', 'filesystem.read_allowlisted')`,
    ),
    check(
      'gateway_node_invocations_status_check',
      sql`${table.status} in ('pending', 'completed', 'failed', 'rejected', 'expired')`,
    ),
    check(
      'gateway_node_invocations_time_check',
      sql`${table.expiresAt} > ${table.issuedAt}`,
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
    check(
      'agent_operations_gateway_shape_check',
      sql`(${table.gatewayEnvelopeId} is null and ${table.requestFingerprint} is null and ${table.actorUserId} is null and ${table.agentId} is null and ${table.notebookId} is null) or (${table.gatewayEnvelopeId} is not null and char_length(${table.gatewayEnvelopeId}) between 1 and 160 and ${table.requestFingerprint} ~ '^[a-f0-9]{64}$' and ${table.actorUserId} is not null and ${table.agentId} is not null and ${table.notebookId} is not null)`,
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
    index('gateway_operation_events_resume_idx').on(
      table.operationId,
      table.sequence,
    ),
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
 * 对象存储地址只存在于不可变版本表。通用路径已有一等 Space；K12 迁移期仍以
 * lessonSession.id 映射 spaceId。assets 早于 spaces 创建，当前不加外键以兼容双轨，
 * 待K12完成回填与双读迁移后再收紧Workspace级参照完整性。
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
    check('operation_sources_kind_check', sql`${table.kind} = 'web'`),
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
    index('conversation_message_citations_message_idx').on(
      table.assistantMessageId,
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

/** 模型运行是与可见消息分层的审计记录；兼容旧教学账本并接入统一 Agent Operation。 */
export const modelRuns = pgTable(
  'model_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => lessonSessions.id, {
      onDelete: 'cascade',
    }),
    operationId: uuid('operation_id').notNull(),
    operationKind: text('operation_kind').notNull(),
    agentOperationId: uuid('agent_operation_id').references(
      () => agentOperations.id,
      { onDelete: 'cascade' },
    ),
    assistantMessageId: uuid('assistant_message_id').references(
      () => chatMessages.id,
      { onDelete: 'cascade' },
    ),
    conversationMessageId: uuid('conversation_message_id').references(
      () => conversationMessages.id,
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
    index('model_runs_agent_operation_idx').on(
      table.agentOperationId,
      table.createdAt,
      table.id,
    ),
    check(
      'model_runs_operation_shape_check',
      sql`(${table.operationKind} = 'teaching_turn' and ${table.sessionId} is not null and ${table.agentOperationId} is null and ${table.assistantMessageId} is not null and ${table.conversationMessageId} is null and ${table.turnId} is not null and ${table.operationId} = ${table.turnId} and ${table.taskAlias} = 'teaching.turn') or (${table.operationKind} = 'agent_turn' and ${table.agentOperationId} is not null and ${table.operationId} = ${table.agentOperationId} and ((${table.taskAlias} = 'agent.turn' and ${table.sessionId} is null and ${table.assistantMessageId} is null and ${table.conversationMessageId} is not null and ${table.turnId} is null) or (${table.taskAlias} = 'teaching.turn' and ${table.sessionId} is not null and ${table.assistantMessageId} is not null and ${table.conversationMessageId} is null and ${table.turnId} = ${table.agentOperationId})))`,
    ),
    check(
      'model_runs_phase_check',
      sql`${table.phase} in ('answer', 'synthesis')`,
    ),
    check(
      'model_runs_status_check',
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')`,
    ),
    check('model_runs_attempt_check', sql`${table.attempt} between 1 and 100`),
    check(
      'model_runs_text_check',
      sql`char_length(${table.traceId}) between 1 and 128 and ${table.taskAlias} in ('agent.turn', 'teaching.turn') and ${table.modelAlias} in ('primary', 'fast', 'structured', 'speech') and char_length(${table.promptVersion}) between 1 and 128 and ${table.promptHash} ~ '^[a-f0-9]{64}$' and (${table.provider} is null or char_length(${table.provider}) between 1 and 128) and (${table.providerModelId} is null or char_length(${table.providerModelId}) between 1 and 256) and (${table.modelRevision} is null or char_length(${table.modelRevision}) between 1 and 256) and (${table.providerResponseId} is null or char_length(${table.providerResponseId}) between 1 and 512) and (${table.systemFingerprint} is null or char_length(${table.systemFingerprint}) between 1 and 512) and (${table.finishReason} is null or ${table.finishReason} in ('stop', 'tool_calls', 'length', 'content_filter', 'cancelled', 'error', 'other')) and (${table.errorCode} is null or ${table.errorCode} ~ '^[a-z][a-z0-9._:-]{0,127}$')`,
    ),
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
    sessionId: uuid('session_id').references(() => lessonSessions.id, {
      onDelete: 'cascade',
    }),
    turnId: uuid('turn_id'),
    agentOperationId: uuid('agent_operation_id').references(
      () => agentOperations.id,
      { onDelete: 'cascade' },
    ),
    answerModelRunId: uuid('answer_model_run_id')
      .notNull()
      .references(() => modelRuns.id, { onDelete: 'cascade' }),
    providerToolCallId: text('provider_tool_call_id').notNull(),
    executionId: text('execution_id').notNull(),
    requestHash: text('request_hash').notNull(),
    traceId: text('trace_id').notNull(),
    toolName: text('tool_name'),
    teachingState: text('teaching_state'),
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
    index('tool_calls_agent_operation_idx').on(
      table.agentOperationId,
      table.createdAt,
      table.id,
    ),
    check(
      'tool_calls_scope_check',
      sql`(${table.sessionId} is not null and ${table.turnId} is not null and ${table.teachingState} is not null and ${table.agentOperationId} is null) or (${table.sessionId} is null and ${table.turnId} is null and ${table.teachingState} is null and ${table.agentOperationId} is not null)`,
    ),
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
 * write工具的持久副作用意图与提交证据。只保存稳定key/hash和终态；
 * 原始参数、输出、Credential、外部异常与回执正文禁止进入本表。
 */
export const toolEffects = pgTable(
  'tool_effects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentOperationId: uuid('agent_operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    toolCallId: uuid('tool_call_id')
      .notNull()
      .references(() => toolCalls.id, { onDelete: 'cascade' }),
    effectKey: text('effect_key').notNull(),
    semanticsHash: text('semantics_hash').notNull(),
    // 可空text兼容旧行；只冻结安全稳定ID，不保存Adapter配置或凭据，且无批量查询无需索引。
    reconciliationVerifierId: text('reconciliation_verifier_id'),
    status: text('status').notNull().default('intended'),
    code: text('code'),
    receiptHash: text('receipt_hash'),
    intendedAt: timestamp('intended_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('tool_effects_operation_key_unique').on(
      table.agentOperationId,
      table.effectKey,
    ),
    uniqueIndex('tool_effects_tool_call_unique').on(table.toolCallId),
    index('tool_effects_status_idx').on(
      table.status,
      table.intendedAt,
      table.id,
    ),
    check(
      'tool_effects_text_check',
      sql`${table.effectKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' and ${table.semanticsHash} ~ '^[a-f0-9]{64}$' and (${table.reconciliationVerifierId} is null or ${table.reconciliationVerifierId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$') and (${table.code} is null or ${table.code} ~ '^[a-z][a-z0-9._:-]{0,127}$') and (${table.receiptHash} is null or ${table.receiptHash} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'tool_effects_status_check',
      sql`${table.status} in ('intended', 'committed', 'failed', 'outcome_unknown')`,
    ),
    check(
      'tool_effects_lifecycle_check',
      sql`(${table.status} = 'intended' and ${table.code} is null and ${table.receiptHash} is null and ${table.settledAt} is null) or (${table.status} = 'committed' and ${table.code} is null and ${table.settledAt} is not null) or (${table.status} in ('failed', 'outcome_unknown') and ${table.code} is not null and ${table.receiptHash} is null and ${table.settledAt} is not null)`,
    ),
  ],
);

/**
 * Adapter完成耐久准备、Gateway尚未公开approval.required之间的最小意图。
 * 这里只保存恢复引用与可空W3C父上下文，不提供参数、Prompt、正文、Credential、Secret或结果字段。
 * trace_parent使用text而非JSON：W3C v00长度固定且不允许tracestate/baggage扩展信任边界。
 */
export const toolApprovalIntents = pgTable(
  'tool_approval_intents',
  {
    approvalId: text('approval_id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    protocolVersion: text('protocol_version').notNull(),
    toolCallId: uuid('tool_call_id')
      .notNull()
      .references(() => toolCalls.id, { onDelete: 'cascade' }),
    adapterSource: text('adapter_source').notNull(),
    resumeRef: text('resume_ref').notNull(),
    traceParent: text('trace_parent'),
    status: text('status').notNull().default('prepared'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    preparedAt: timestamp('prepared_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    boundAt: timestamp('bound_at', { withTimezone: true }),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('tool_approval_intents_tool_call_unique').on(table.toolCallId),
    uniqueIndex('tool_approval_intents_adapter_resume_unique').on(
      table.adapterSource,
      table.resumeRef,
    ),
    index('tool_approval_intents_status_expiry_idx').on(
      table.status,
      table.expiresAt,
      table.preparedAt,
    ),
    check(
      'tool_approval_intents_status_check',
      sql`${table.status} in ('prepared', 'bound', 'abandoned')`,
    ),
    check(
      'tool_approval_intents_text_check',
      sql`${table.protocolVersion} = 'educanvas.tool-approval-intent.v1' and char_length(${table.approvalId}) between 1 and 256 and ${table.approvalId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' and ${table.adapterSource} in ('local', 'teaching', 'mcp', 'node') and char_length(${table.resumeRef}) between 1 and 256 and ${table.resumeRef} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'`,
    ),
    check(
      'tool_approval_intents_trace_parent_check',
      sql`${table.traceParent} is null or (char_length(${table.traceParent}) = 55 and ${table.traceParent} ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$' and substring(${table.traceParent} from 4 for 32) <> repeat('0', 32) and substring(${table.traceParent} from 37 for 16) <> repeat('0', 16))`,
    ),
    check(
      'tool_approval_intents_lifecycle_check',
      sql`(${table.status} = 'prepared' and ${table.boundAt} is null and ${table.abandonedAt} is null) or (${table.status} = 'bound' and ${table.boundAt} is not null and ${table.abandonedAt} is null) or (${table.status} = 'abandoned' and ${table.boundAt} is null and ${table.abandonedAt} is not null)`,
    ),
    check(
      'tool_approval_intents_time_check',
      sql`${table.expiresAt} > ${table.preparedAt} and (${table.boundAt} is null or ${table.boundAt} >= ${table.preparedAt}) and (${table.abandonedAt} is null or ${table.abandonedAt} >= ${table.preparedAt})`,
    ),
  ],
);

/**
 * 高风险工具/外部等待的耐久执行游标。只保存稳定业务引用、lease与可空W3C父上下文，
 * 不保存Prompt、消息正文、工具参数、Credential、Secret或副作用结果。trace_parent仅用于观测，不参与业务状态。
 */
export const operationContinuations = pgTable(
  'operation_continuations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    protocolVersion: text('protocol_version').notNull(),
    kind: text('kind').notNull(),
    step: text('step').notNull(),
    approvalId: text('approval_id').notNull(),
    toolCallId: uuid('tool_call_id')
      .notNull()
      .references(() => toolCalls.id, { onDelete: 'cascade' }),
    adapterSource: text('adapter_source').notNull(),
    resumeRef: text('resume_ref').notNull(),
    traceParent: text('trace_parent'),
    status: text('status').notNull().default('waiting_approval'),
    leaseGeneration: integer('lease_generation').notNull().default(0),
    leaseOwnerId: text('lease_owner_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
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
    uniqueIndex('operation_continuations_operation_sequence_unique').on(
      table.operationId,
      table.sequence,
    ),
    uniqueIndex('operation_continuations_active_operation_unique')
      .on(table.operationId)
      .where(sql`${table.status} in ('waiting_approval', 'ready', 'running')`),
    uniqueIndex('operation_continuations_approval_unique').on(table.approvalId),
    uniqueIndex('operation_continuations_tool_call_unique').on(
      table.toolCallId,
    ),
    uniqueIndex('operation_continuations_adapter_resume_unique').on(
      table.adapterSource,
      table.resumeRef,
    ),
    index('operation_continuations_claim_idx').on(
      table.status,
      table.leaseExpiresAt,
      table.updatedAt,
    ),
    check(
      'operation_continuations_kind_check',
      sql`${table.sequence} between 1 and 1000 and ${table.kind} = 'tool_approval' and ${table.step} = 'tool.invoke'`,
    ),
    check(
      'operation_continuations_status_check',
      sql`${table.status} in ('waiting_approval', 'ready', 'running', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      'operation_continuations_text_check',
      sql`${table.protocolVersion} = 'educanvas.operation-continuation.v1' and char_length(${table.approvalId}) between 1 and 256 and ${table.approvalId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' and ${table.adapterSource} in ('local', 'teaching', 'mcp', 'node') and char_length(${table.resumeRef}) between 1 and 256 and ${table.resumeRef} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' and (${table.leaseOwnerId} is null or (char_length(${table.leaseOwnerId}) between 1 and 256 and ${table.leaseOwnerId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')) and (${table.failureCode} is null or ${table.failureCode} ~ '^[a-z][a-z0-9._:-]{0,127}$')`,
    ),
    check(
      'operation_continuations_trace_parent_check',
      sql`${table.traceParent} is null or (char_length(${table.traceParent}) = 55 and ${table.traceParent} ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$' and substring(${table.traceParent} from 4 for 32) <> repeat('0', 32) and substring(${table.traceParent} from 37 for 16) <> repeat('0', 16))`,
    ),
    check(
      'operation_continuations_lease_check',
      sql`${table.leaseGeneration} between 0 and 1000000 and ((${table.status} = 'running' and ${table.leaseGeneration} >= 1 and ${table.leaseOwnerId} is not null and ${table.leaseExpiresAt} is not null and ${table.heartbeatAt} is not null) or (${table.status} <> 'running' and ${table.leaseOwnerId} is null and ${table.leaseExpiresAt} is null and ${table.heartbeatAt} is null))`,
    ),
    check(
      'operation_continuations_terminal_check',
      sql`((${table.status} in ('completed', 'failed', 'cancelled')) = (${table.completedAt} is not null)) and ((${table.status} = 'failed') = (${table.failureCode} is not null))`,
    ),
    check(
      'operation_continuations_time_check',
      sql`${table.updatedAt} >= ${table.createdAt} and (${table.completedAt} is null or ${table.completedAt} >= ${table.createdAt})`,
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

/**
 * Artifact 一等公民（ADR-0012）。身份与信任层级在本表,内容进不可变版本表。
 * `trustTier` 使用 ADR-0010 的层级词汇:tier1=判分型白名单,tier2=沙箱探索型,
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
      'artifacts_archive_shape_check',
      sql`(${table.status} = 'archived') = (${table.archivedAt} is not null)`,
    ),
  ],
);

/**
 * 产物生成任务账本(ADR-0012)。graphile_worker 表是队列实现细节,本表才是
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
    index('artifact_generation_jobs_artifact_created_idx').on(
      table.artifactId,
      table.createdAt,
      table.id,
    ),
    index('artifact_generation_jobs_status_created_idx').on(
      table.status,
      table.createdAt,
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
 * 不可变产物版本(ADR-0012)。结构化产物内容进 `content`(JSONB),媒体产物进
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
    generationJobId: uuid('generation_job_id').references(
      () => artifactGenerationJobs.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('artifact_versions_artifact_version_unique').on(
      table.artifactId,
      table.version,
    ),
    uniqueIndex('artifact_versions_generation_job_unique')
      .on(table.generationJobId)
      .where(sql`${table.generationJobId} is not null`),
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
