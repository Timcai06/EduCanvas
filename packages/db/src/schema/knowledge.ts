import {
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
import { chatMessages, lessonSessions } from './agent-runtime';

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

/**
 * pgvector 定长向量列。
 *
 * 维度写死在列类型里是 pgvector 建索引的前提，也让「换模型换维度」必须经过一次
 * 显式迁移与全量重嵌入，而不是靠改配置悄悄产生不可比较的混合空间。平台维度常量
 * 在 `@educanvas/agent-core` 的 `PLATFORM_EMBEDDING_DIMENSIONS`，两处必须一致。
 *
 * 驱动侧以 pgvector 的文本字面量 `[a,b,c]` 传输：postgres-js 没有向量类型编码器，
 * 文本形式是唯一稳定且不依赖驱动扩展的表示。
 */
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${dimensions})`,
    toDriver: (value: number[]) => `[${value.join(',')}]`,
    fromDriver: (value: string) => JSON.parse(value) as number[],
  })(name);

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
      sql`${table.sourceType} ~ '^[a-z][a-z0-9_]{0,63}$'`,
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

/**
 * 平台向量维度。与 `@educanvas/agent-core` 的 `PLATFORM_EMBEDDING_DIMENSIONS`
 * 同值；此处不 import 常量，是为了让 Schema 与迁移 SQL 保持自包含可读。
 */
const EMBEDDING_DIMENSIONS = 1536;

/**
 * 切块向量派生表（ADR-0015）。
 *
 * chunk 仍是不可变内容事实，向量只是它的派生物：删除全部向量不改变任何引用、
 * 判分或历史候选，只让检索退回纯 FTS。因此本表可以被整表重建，而
 * `knowledge_chunks` 不可以。
 *
 * 唯一键包含模型、版本和指令：同一 chunk 在不同模型/版本/指令下的向量可以共存，
 * 使模型升级成为「先写新向量、再切读、最后清旧向量」的可回滚过程，而不是一次
 * 破坏性覆盖。
 *
 * `chunkContentHash` 冗余自 chunk：它让「向量对应的文本是否已经变了」成为一次
 * 等值比较，而不需要重新读正文；内容漂移的向量会被检索直接排除。
 */
export const knowledgeChunkEmbeddings = pgTable(
  'knowledge_chunk_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /* 只声明复合外键：它已蕴含 chunk_id 的引用完整性，再加一条单列外键只会
       产生同一约束的两份检查开销。 */
    chunkId: uuid('chunk_id').notNull(),
    /** 冗余文档 ID，供复合外键证明向量与 chunk 属于同一文档。 */
    documentId: uuid('document_id').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    embeddingModelVersion: text('embedding_model_version').notNull(),
    dimensions: integer('dimensions').notNull(),
    /** 用途与指令版本，例如 `passage:v1`；与 query 侧指令必须配套使用。 */
    instruction: text('instruction').notNull(),
    /** 切块版本取自 knowledge_documents.parser_version；切块规则变化即换空间。 */
    chunkingVersion: text('chunking_version').notNull(),
    chunkContentHash: text('chunk_content_hash').notNull(),
    embedding: vector('embedding', EMBEDDING_DIMENSIONS).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_chunk_embeddings_identity_unique').on(
      table.chunkId,
      table.embeddingModel,
      table.embeddingModelVersion,
      table.instruction,
    ),
    index('knowledge_chunk_embeddings_document_idx').on(
      table.documentId,
      table.embeddingModel,
      table.embeddingModelVersion,
    ),
    /* HNSW + cosine：检索侧统一用 `<=>`，与写入时的归一化假设保持一致。
       lists/probes 类参数属于 IVF，HNSW 无需预先知道数据规模，更适合会持续
       增量摄取的教材库。 */
    index('knowledge_chunk_embeddings_hnsw_idx').using(
      'hnsw',
      sql`${table.embedding} vector_cosine_ops`,
    ),
    foreignKey({
      columns: [table.chunkId, table.documentId],
      foreignColumns: [knowledgeChunks.id, knowledgeChunks.documentId],
      name: 'knowledge_chunk_embeddings_chunk_document_fk',
    }).onDelete('cascade'),
    check(
      'knowledge_chunk_embeddings_dimensions_check',
      sql`${table.dimensions} = ${sql.raw(String(EMBEDDING_DIMENSIONS))}`,
    ),
    check(
      'knowledge_chunk_embeddings_hash_check',
      sql`${table.chunkContentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'knowledge_chunk_embeddings_identity_shape_check',
      sql`${table.embeddingModel} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$' and ${table.embeddingModelVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' and ${table.instruction} ~ '^[a-z]+:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' and ${table.chunkingVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'`,
    ),
  ],
);

/**
 * 文档级向量化运行账本（ADR-0015）。
 *
 * 没有它，一个持续失败的文档只会表现为「检索结果比预期少」——混合检索会安静地
 * 退回 FTS，运维看不到任何信号。本表让每个 (文档, 向量身份) 的终态可查询，
 * 并给重试与回填一个明确的边界。
 *
 * 它只记录状态与计数，不保存教材正文、查询原文或供应商响应。
 */
export const knowledgeEmbeddingRuns = pgTable(
  'knowledge_embedding_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    embeddingModel: text('embedding_model').notNull(),
    embeddingModelVersion: text('embedding_model_version').notNull(),
    instruction: text('instruction').notNull(),
    status: text('status').notNull().default('queued'),
    /** 已成功写入向量的 chunk 数；用于回填进度与部分成功的诚实表达。 */
    embeddedChunkCount: integer('embedded_chunk_count').notNull().default(0),
    totalChunkCount: integer('total_chunk_count').notNull(),
    failureCode: text('failure_code'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_embedding_runs_identity_unique').on(
      table.documentId,
      table.embeddingModel,
      table.embeddingModelVersion,
      table.instruction,
    ),
    index('knowledge_embedding_runs_status_updated_idx').on(
      table.status,
      table.updatedAt,
      table.id,
    ),
    check(
      'knowledge_embedding_runs_status_check',
      sql`${table.status} in ('queued', 'running', 'ready', 'failed')`,
    ),
    check(
      'knowledge_embedding_runs_count_check',
      sql`${table.totalChunkCount} >= 0 and ${table.embeddedChunkCount} between 0 and ${table.totalChunkCount}`,
    ),
    check(
      'knowledge_embedding_runs_failure_shape_check',
      sql`(${table.status} = 'failed' and ${table.failureCode} ~ '^[a-z][a-z0-9_]{0,127}$') or (${table.status} <> 'failed' and ${table.failureCode} is null)`,
    ),
    check(
      'knowledge_embedding_runs_lifecycle_shape_check',
      sql`(${table.status} = 'queued' and ${table.startedAt} is null and ${table.completedAt} is null) or (${table.status} = 'running' and ${table.startedAt} is not null and ${table.completedAt} is null) or (${table.status} in ('ready', 'failed') and ${table.startedAt} is not null and ${table.completedAt} is not null)`,
    ),
    check(
      'knowledge_embedding_runs_identity_shape_check',
      sql`${table.embeddingModel} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$' and ${table.embeddingModelVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' and ${table.instruction} ~ '^[a-z]+:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'`,
    ),
  ],
);
