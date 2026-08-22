import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { agentOperations } from './conversation';

/**
 * Deep Research 的最小恢复事实。来源和引用仍由 operation_sources 与
 * conversation_message_citations 作为唯一账本；这里仅保存研究过程的有界游标。
 */
export const researchCheckpoints = pgTable(
  'research_checkpoints',
  {
    operationId: uuid('operation_id')
      .primaryKey()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    protocolVersion: text('protocol_version').notNull(),
    phase: text('phase').notNull(),
    completedQueries: jsonb('completed_queries')
      .$type<string[]>()
      .notNull()
      .default([]),
    candidateUrls: jsonb('candidate_urls')
      .$type<string[]>()
      .notNull()
      .default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'research_checkpoints_protocol_version_check',
      sql`${table.protocolVersion} = 'educanvas.research-checkpoint.v1'`,
    ),
    check(
      'research_checkpoints_phase_check',
      sql`${table.phase} in ('planning', 'searching', 'reading', 'synthesizing')`,
    ),
    check(
      'research_checkpoints_completed_queries_check',
      sql`jsonb_typeof(${table.completedQueries}) = 'array' and jsonb_array_length(${table.completedQueries}) between 0 and 5`,
    ),
    check(
      'research_checkpoints_candidate_urls_check',
      sql`jsonb_typeof(${table.candidateUrls}) = 'array' and jsonb_array_length(${table.candidateUrls}) between 0 and 15`,
    ),
  ],
);
