import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeSources,
} from './knowledge';
import { chatMessages, lessonSessions } from './agent-runtime';

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
    /* 最新绑定读取复用 session_source_bindings_session_source_sequence_unique：
       列与顺序完全相同，重复索引只增加写放大。 */
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
    index('retrieval_candidates_snapshot_fk_idx').on(table.turnSourceVersionId),
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
    index('message_citations_candidate_fk_idx').on(table.retrievalCandidateId),
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
