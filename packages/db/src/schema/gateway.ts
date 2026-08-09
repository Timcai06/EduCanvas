import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { GatewayCapabilityManifest } from '@educanvas/gateway-core';
import { personalAgents, platformUsers } from './identity';
import { spaces } from './workspace';
import { agentOperations, conversations } from './conversation';

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
    index('gateway_channel_thread_bindings_conversation_fk_idx').on(
      table.conversationId,
    ),
    index('gateway_channel_thread_bindings_notebook_fk_idx').on(
      table.notebookId,
    ),
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
    index('gateway_handoff_tokens_conversation_fk_idx').on(
      table.conversationId,
    ),
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
    index('gateway_node_invocations_operation_fk_idx').on(table.operationId),
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
      // D03：capability 的唯一权威是 gatewayCapabilityNames Registry；当前接线
      // 白名单由 nodes.ts refine 限定，DB 只保留格式约束。
      sql`${table.capability} ~ '^[a-z][a-z0-9._]{0,63}$'`,
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
