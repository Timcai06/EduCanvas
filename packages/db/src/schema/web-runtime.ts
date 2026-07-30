import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { artifacts, artifactVersions, platformUsers, spaces } from '../schema';

/**
 * 持久 Web Runtime 的授权与终态账本。
 *
 * 不保存 Artifact 内容、channel nonce、原始 bootstrap token、Prompt、Source、
 * 浏览器消息、宿主路径或堆栈。Artifact Version 内容继续只存在不可变版本表。
 */
export const webRuntimeRuns = pgTable(
  'web_runtime_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull().defaultRandom(),
    runtimeId: uuid('runtime_id').notNull().defaultRandom(),
    notebookId: uuid('notebook_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    artifactVersionId: uuid('artifact_version_id').notNull(),
    artifactContentHash: text('artifact_content_hash').notNull(),
    requesterSubjectId: text('requester_subject_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    bootstrapTokenHash: text('bootstrap_token_hash'),
    bootstrapExpiresAt: timestamp('bootstrap_expires_at', {
      withTimezone: true,
    }).notNull(),
    status: text('status').notNull().default('running'),
    terminalAuthority: text('terminal_authority')
      .notNull()
      .default('client_observed'),
    failureCode: text('failure_code'),
    bootstrapClaimedAt: timestamp('bootstrap_claimed_at', {
      withTimezone: true,
    }),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('web_runtime_runs_request_unique').on(table.requestId),
    uniqueIndex('web_runtime_runs_runtime_unique').on(table.runtimeId),
    index('web_runtime_runs_notebook_created_idx').on(
      table.notebookId,
      table.createdAt,
      table.id,
    ),
    index('web_runtime_runs_requester_created_idx').on(
      table.requesterSubjectId,
      table.createdAt,
      table.id,
    ),
    index('web_runtime_runs_artifact_version_fk_idx').on(
      table.artifactVersionId,
      table.artifactId,
    ),
    index('web_runtime_runs_artifact_fk_idx').on(table.artifactId),
    foreignKey({
      columns: [table.artifactVersionId, table.artifactId],
      foreignColumns: [artifactVersions.id, artifactVersions.artifactId],
      name: 'web_runtime_runs_artifact_version_scope_fk',
    }).onDelete('cascade'),
    check(
      'web_runtime_runs_hash_check',
      sql`${table.artifactContentHash} ~ '^[a-f0-9]{64}$' and (${table.bootstrapTokenHash} is null or ${table.bootstrapTokenHash} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'web_runtime_runs_status_check',
      sql`${table.status} in ('running', 'succeeded', 'failed', 'cancelled')`,
    ),
    check(
      'web_runtime_runs_authority_check',
      sql`${table.terminalAuthority} = 'client_observed'`,
    ),
    check(
      'web_runtime_runs_terminal_check',
      sql`(${table.status} = 'running' and ${table.completedAt} is null and ${table.failureCode} is null) or (${table.status} = 'succeeded' and ${table.completedAt} is not null and ${table.failureCode} is null) or (${table.status} = 'cancelled' and ${table.completedAt} is not null and ${table.failureCode} is null) or (${table.status} = 'failed' and ${table.completedAt} is not null and ${table.failureCode} in ('runtime_timeout', 'runtime_crashed', 'resource_quota_exceeded', 'execution_failed', 'cancel_race_rejected'))`,
    ),
  ],
);
