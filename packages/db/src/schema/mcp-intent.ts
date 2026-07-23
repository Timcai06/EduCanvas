import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  agentOperations,
  personalAgents,
  platformUsers,
  toolCalls,
} from '../schema';

/** MCP高风险Adapter自有的短期密文意图；公共continuation只引用resumeRef。 */
export const mcpToolIntents = pgTable(
  'mcp_tool_intents',
  {
    resumeRef: text('resume_ref').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    toolCallId: uuid('tool_call_id')
      .notNull()
      .references(() => toolCalls.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => personalAgents.id, { onDelete: 'cascade' }),
    serverId: text('server_id').notNull(),
    remoteToolName: text('remote_tool_name').notNull(),
    modelToolName: text('model_tool_name').notNull(),
    capability: text('capability').notNull(),
    risk: text('risk').notNull(),
    effect: text('effect').notNull(),
    semanticsHash: text('semantics_hash').notNull(),
    status: text('status').notNull().default('prepared'),
    keyVersion: text('key_version'),
    nonce: text('nonce'),
    ciphertext: text('ciphertext'),
    authTag: text('auth_tag'),
    payloadHash: text('payload_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    preparedAt: timestamp('prepared_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    dispatchStartedAt: timestamp('dispatch_started_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('mcp_tool_intents_tool_call_unique').on(table.toolCallId),
    index('mcp_tool_intents_status_expiry_idx').on(
      table.status,
      table.expiresAt,
      table.preparedAt,
    ),
    check(
      'mcp_tool_intents_identity_check',
      sql`${table.resumeRef} ~ '^mcp\\.intent:[a-f0-9]{64}$' and char_length(${table.serverId}) between 1 and 64 and char_length(${table.remoteToolName}) between 1 and 128 and char_length(${table.modelToolName}) between 1 and 64 and char_length(${table.capability}) between 1 and 64`,
    ),
    check(
      'mcp_tool_intents_policy_check',
      sql`${table.risk} in ('l2', 'l3') and ${table.effect} = 'write' and ${table.capability} = 'external.mcp.invoke' and ${table.semanticsHash} ~ '^[a-f0-9]{64}$' and ${table.payloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'mcp_tool_intents_status_check',
      sql`${table.status} in ('prepared', 'dispatching', 'completed', 'failed', 'outcome_unknown')`,
    ),
    check(
      'mcp_tool_intents_cipher_check',
      sql`((${table.status} = 'prepared' and ${table.keyVersion} = 'v1' and ${table.nonce} is not null and ${table.ciphertext} is not null and ${table.authTag} is not null) or (${table.status} <> 'prepared' and ${table.keyVersion} is null and ${table.nonce} is null and ${table.ciphertext} is null and ${table.authTag} is null)) and (${table.nonce} is null or char_length(${table.nonce}) between 16 and 24) and (${table.authTag} is null or char_length(${table.authTag}) between 20 and 32) and (${table.ciphertext} is null or char_length(${table.ciphertext}) between 1 and 350000)`,
    ),
    check(
      'mcp_tool_intents_lifecycle_check',
      sql`(${table.status} = 'prepared' and ${table.dispatchStartedAt} is null and ${table.settledAt} is null) or (${table.status} = 'dispatching' and ${table.dispatchStartedAt} is not null and ${table.settledAt} is null) or (${table.status} in ('completed', 'failed', 'outcome_unknown') and ${table.settledAt} is not null)`,
    ),
    check(
      'mcp_tool_intents_time_check',
      sql`${table.expiresAt} > ${table.preparedAt} and (${table.dispatchStartedAt} is null or ${table.dispatchStartedAt} >= ${table.preparedAt}) and (${table.settledAt} is null or ${table.settledAt} >= ${table.preparedAt})`,
    ),
  ],
);
