/**
 * Q01 RAG 冻结评测 harness（离线运行，不调用任何付费模型）。
 *
 * 运行方式：
 *   TEST_DATABASE_URL=<隔离评测库> pnpm exec vitest run --config tooling/evals/vitest.config.ts
 *
 * 评测内容：对冻结评测集 v1 的每个 query，在同一冻结 source 版本上比较三种
 * 检索配置（hybrid 向量融合 / 纯 FTS / 向量不可用回退），输出 Recall@10/20、
 * MRR@10、nDCG@10、延迟 p50/p95 与回退诚实性，报告写入
 * tooling/evals/reports/rag-eval-<版本>-<日期>.json。
 *
 * 数据模型与产品代码语义一致：
 * - chunk 行 id 由库生成，embedding 用 ingest 后读回的真实 chunk 行 id；
 * - 版本升级 = 整文档 re-ingest（新版本 ready 文档会 supersede 旧文档），
 *   c1 升级后其 embedding 携带旧 contentHash（模拟 embedding 管线滞后），
 *   验证 vectorRanking 的 contentHash 匹配排除陈旧向量；
 * - 本文件不承担产品断言（阈值由 Q00 契约基线回填）；仅断言 harness 自检与
 *   安全/结构属性（无答案拒答、跨用户越权、陈旧向量排除、回退诚实标记），
 *   这些属性与质量基线无关，是评测本身成立的必要条件。
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleKnowledgeEmbeddingRepository } from '../../packages/db/src/knowledge-embedding-repository';
import {
  DrizzleKnowledgeHybridRetrieval,
  HYBRID_LEXICAL_FALLBACK_VERSION,
  LEXICAL_RETRIEVER,
  type EmbeddingIdentity,
} from '../../packages/db/src/knowledge-hybrid-retrieval';
import { DrizzleKnowledgeRetrievalRepository } from '../../packages/db/src/knowledge-retrieval-repository';
import {
  DrizzleKnowledgeSourceRepository,
  hashKnowledgeText,
} from '../../packages/db/src/knowledge-source-repository';
import * as schema from '../../packages/db/src/schema';
import {
  EVAL_DATASET_AUTHORIZATION,
  EVAL_DATASET_CREATED,
  EVAL_DATASET_VERSION,
  EVAL_QUERIES,
  EVAL_SOURCES,
  STUDENT_A,
  STUDENT_B,
  VERSION_UPGRADE,
  basisVector,
} from './dataset-v1/index';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL 未设置');
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!/_(eval|test|integration)$/.test(databaseName)) {
    throw new Error(
      '评测拒绝清空非隔离数据库（需 _eval/_test/_integration 后缀）',
    );
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const connection = postgres(testDatabaseUrl, { max: 8 });
const database = drizzle(connection, { schema });
const baseTime = new Date('2026-08-06T10:00:00.000Z');

const IDENTITY: EmbeddingIdentity = {
  embeddingModel: 'embed-fixture',
  embeddingModelVersion: '2026-05-01',
  instruction: 'passage:v1',
};

const sources = new DrizzleKnowledgeSourceRepository(database);
const retrieval = new DrizzleKnowledgeRetrievalRepository(database);
const hybrid = new DrizzleKnowledgeHybridRetrieval(database);
const embeddings = new DrizzleKnowledgeEmbeddingRepository(database);

/** content → 数据集 chunk id（语料内容全库唯一，升级版 c1 内容也登记）。 */
const chunkIdByContent = new Map<string, string>();

function registerChunk(content: string, chunkId: string) {
  const existing = chunkIdByContent.get(content);
  if (existing && existing !== chunkId) {
    throw new Error(
      `chunk 内容冲突：${content} 同时映射 ${existing} 与 ${chunkId}`,
    );
  }
  chunkIdByContent.set(content, chunkId);
}

/** ingest 后读回 chunk 行（id/contentHash），chunkIndex 即 dataset chunks 下标。 */
async function readChunkRows(documentId: string) {
  const rows = await database
    .select({
      id: schema.knowledgeChunks.id,
      chunkIndex: schema.knowledgeChunks.chunkIndex,
      contentHash: schema.knowledgeChunks.contentHash,
    })
    .from(schema.knowledgeChunks)
    .where(sql`${schema.knowledgeChunks.documentId} = ${documentId}`)
    .orderBy(schema.knowledgeChunks.chunkIndex);
  if (rows.length === 0) throw new Error(`document ${documentId} 无 chunk 行`);
  return rows;
}

async function writeChunkEmbeddings(input: {
  documentId: string;
  rows: readonly { id: string; contentHash: string }[];
  vectors: readonly number[][];
}) {
  await embeddings.createOrGetRun({
    documentId: input.documentId,
    identity: IDENTITY,
  });
  await embeddings.writeEmbeddings({
    documentId: input.documentId,
    identity: IDENTITY,
    chunkingVersion: 'pdf-text-v1',
    embeddings: input.rows.map((row, index) => ({
      chunkId: row.id,
      chunkContentHash: row.contentHash,
      vector: input.vectors[index]!,
    })),
    now: baseTime,
  });
}

async function seedSession(input: { studentId: string; courseSlug: string }) {
  const sessionId = randomUUID();
  const turnId = randomUUID();
  await database.insert(schema.lessonSessions).values({
    id: sessionId,
    studentId: input.studentId,
    gradeBand: 'middle_school',
    courseSlug: input.courseSlug,
    knowledgeNodeId: 'node-eval',
    state: 'EXPLAIN',
    lastActivityAt: baseTime,
    createdAt: baseTime,
    updatedAt: baseTime,
  });
  await database.insert(schema.chatMessages).values({
    id: randomUUID(),
    sessionId,
    turnId,
    clientMessageId: `client-${turnId}`,
    requestHash: hashKnowledgeText(turnId),
    role: 'student',
    status: 'completed',
    content: '提问',
    completedAt: baseTime,
    createdAt: baseTime,
  });
  return { sessionId };
}

async function ingestAndEmbed(input: {
  sourceKey: string;
  courseSlug: string;
  chunks: readonly { content: string; vector: number[] }[];
  documentSuffix: string;
}) {
  const sourceRow = await database
    .select({ id: schema.knowledgeSources.id })
    .from(schema.knowledgeSources)
    .where(sql`${schema.knowledgeSources.sourceKey} = ${input.sourceKey}`)
    .limit(1);
  if (!sourceRow[0]) throw new Error(`source 不存在: ${input.sourceKey}`);
  const ingested = await sources.ingestDocument({
    sourceId: sourceRow[0]!.id,
    contentHash: hashKnowledgeText(
      `document-${input.sourceKey}-${input.documentSuffix}`,
    ),
    objectKey: `courses/${input.courseSlug}/${input.sourceKey}.pdf`,
    parserVersion: 'pdf-text-v1',
    outcome: {
      status: 'ready',
      chunks: input.chunks.map((chunk) => ({ content: chunk.content })),
    },
    now: baseTime,
  });
  const rows = await readChunkRows(ingested.document.id);
  await writeChunkEmbeddings({
    documentId: ingested.document.id,
    rows,
    vectors: input.chunks.map((chunk) => chunk.vector),
  });
  return { documentId: ingested.document.id };
}

async function seedSource(input: {
  sourceKey: string;
  courseSlug: string;
  title: string;
  chunks: { id: string; content: string; axis: number }[];
}) {
  const source = await sources.createOrGetSource({
    gradeBand: 'middle_school',
    courseSlug: input.courseSlug,
    sourceKey: input.sourceKey,
    title: input.title,
    sourceType: 'pdf',
    now: baseTime,
  });
  await ingestAndEmbed({
    sourceKey: input.sourceKey,
    courseSlug: input.courseSlug,
    chunks: input.chunks.map((chunk) => ({
      content: chunk.content,
      vector: basisVector(chunk.axis),
    })),
    documentSuffix: 'v1',
  });
  return { sourceId: source.source.id };
}

/**
 * 过期版本场景：把 science-1 整文档升级为 v2（c1 内容变更，其余 chunk 不变）。
 * 新文档 embedding 中 c1 携带 v1 的旧 contentHash —— 模拟 embedding 管线未
 * 跟上版本升级：vectorRanking 的 contentHash 匹配必须把 c1 排除出向量路。
 */
async function upgradeChunkV2(input: {
  sourceKey: string;
  chunkId: string;
  contentV2: string;
}) {
  const dataset = EVAL_SOURCES.find((s) => s.sourceKey === input.sourceKey);
  if (!dataset) throw new Error(`数据集无 source: ${input.sourceKey}`);
  const oldC1 = dataset.chunks.find((chunk) => chunk.id === input.chunkId);
  if (!oldC1) throw new Error(`数据集无 chunk: ${input.chunkId}`);
  await ingestAndEmbed({
    sourceKey: input.sourceKey,
    courseSlug: dataset.courseSlug,
    chunks: dataset.chunks.map((chunk) => ({
      content: chunk.id === input.chunkId ? input.contentV2 : chunk.content,
      vector: basisVector(chunk.axis),
    })),
    documentSuffix: 'v2',
  });
  // 升级后把 c1 的 embedding 覆写为"滞后版本"：旧 contentHash + 旧主题向量。
  const sourceRow = await database
    .select({ id: schema.knowledgeSources.id })
    .from(schema.knowledgeSources)
    .where(sql`${schema.knowledgeSources.sourceKey} = ${input.sourceKey}`)
    .limit(1);
  const v2Document = await database
    .select({ id: schema.knowledgeDocuments.id })
    .from(schema.knowledgeDocuments)
    .where(sql`${schema.knowledgeDocuments.sourceId} = ${sourceRow[0]!.id}`)
    .orderBy(sql`version desc`)
    .limit(1);
  const rows = await readChunkRows(v2Document[0]!.id);
  const c1Row = rows.find((row) => {
    const datasetChunk = dataset.chunks[row.chunkIndex];
    return datasetChunk !== undefined && datasetChunk.id === input.chunkId;
  });
  if (!c1Row) throw new Error('v2 document 未找到 c1 chunk 行');
  await embeddings.createOrGetRun({
    documentId: v2Document[0]!.id,
    identity: IDENTITY,
  });
  await embeddings.writeEmbeddings({
    documentId: v2Document[0]!.id,
    identity: IDENTITY,
    chunkingVersion: 'pdf-text-v1',
    embeddings: [
      {
        chunkId: c1Row.id,
        chunkContentHash: hashKnowledgeText(oldC1.content),
        vector: basisVector(oldC1.axis),
      },
    ],
    now: baseTime,
  });
}

async function bindSource(input: {
  sessionId: string;
  studentId: string;
  sourceKey: string;
}) {
  const sourceRow = await database
    .select({ id: schema.knowledgeSources.id })
    .from(schema.knowledgeSources)
    .where(sql`${schema.knowledgeSources.sourceKey} = ${input.sourceKey}`)
    .limit(1);
  if (!sourceRow[0]) throw new Error(`source 不存在: ${input.sourceKey}`);
  await retrieval.setSessionSourceBinding({
    trustedStudentId: input.studentId,
    sessionId: input.sessionId,
    sourceId: sourceRow[0]!.id,
    enabled: true,
    mutationId: `bind-${randomUUID().slice(0, 8)}`,
    now: baseTime,
  });
}

type RetrievalConfig = 'hybrid' | 'fts-only' | 'fallback';

async function runRetrieval(input: {
  config: RetrievalConfig;
  studentId: string;
  sessionId: string;
  turnId: string;
  query: string;
  queryEmbedding: readonly number[] | null;
  limit: number;
}) {
  const traceId = `eval-${randomUUID().slice(0, 8)}`;
  if (input.config === 'fts-only') {
    const result = await retrieval.retrieveFts({
      trustedStudentId: input.studentId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      query: input.query,
      limit: input.limit,
      traceId,
      now: baseTime,
    });
    return {
      candidates: result.candidates,
      retriever: 'fts' as const,
      retrieverVersion: undefined,
      vectorApplied: undefined,
    };
  }
  const result = await hybrid.retrieveHybrid({
    trustedStudentId: input.studentId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    query: input.query,
    limit: input.limit,
    traceId,
    queryEmbedding: input.config === 'hybrid' ? input.queryEmbedding : null,
    embeddingIdentity: input.config === 'hybrid' ? IDENTITY : null,
    now: baseTime,
  });
  return {
    candidates: result.candidates,
    retriever: result.retriever,
    retrieverVersion: result.retrieverVersion,
    vectorApplied: result.vectorApplied,
  };
}

/** 指标：Recall@k、MRR@10、nDCG@10（相关度 0/1）。golden 为空返回 undefined。 */
function computeMetrics(
  rankedCandidateIds: string[],
  golden: string[],
  k: number,
) {
  const goldenSet = new Set(golden);
  const topK = rankedCandidateIds.slice(0, k);
  const hits = topK.filter((id) => goldenSet.has(id)).length;
  const recall = goldenSet.size > 0 ? hits / goldenSet.size : undefined;
  let mrr = 0;
  for (let i = 0; i < Math.min(topK.length, 10); i += 1) {
    if (goldenSet.has(topK[i]!)) {
      mrr = 1 / (i + 1);
      break;
    }
  }
  let dcg = 0;
  for (let i = 0; i < Math.min(topK.length, 10); i += 1) {
    if (goldenSet.has(topK[i]!)) dcg += 1 / Math.log2(i + 2);
  }
  const idealCount = Math.min(k, goldenSet.size);
  let idcg = 0;
  for (let i = 0; i < idealCount; i += 1) idcg += 1 / Math.log2(i + 2);
  return { recall, mrr, ndcg: idcg > 0 ? dcg / idcg : undefined };
}

const mean = (values: number[]) =>
  values.length === 0
    ? undefined
    : values.reduce((a, b) => a + b, 0) / values.length;

const percentile = (sorted: number[], p: number) => {
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
};

describe('Q01 RAG 冻结评测 v1', () => {
  let sessionA: { sessionId: string };
  let queryTurns: Record<string, { turnId: string }>;

  beforeAll(async () => {
    await migrate(database, {
      migrationsFolder: fileURLToPath(
        new URL('../../packages/db/drizzle', import.meta.url),
      ),
    });
    await database.execute(sql`
      truncate table
        message_citations,
        retrieval_candidates,
        turn_source_versions,
        turn_source_snapshots,
        session_source_bindings,
        knowledge_chunk_embeddings,
        knowledge_embedding_runs,
        knowledge_chunks,
        knowledge_documents,
        knowledge_sources,
        chat_messages,
        lesson_sessions
      restart identity cascade
    `);

    sessionA = await seedSession({
      studentId: STUDENT_A,
      courseSlug: 'science-1',
    });
    const sessionB = await seedSession({
      studentId: STUDENT_B,
      courseSlug: 'electricity',
    });

    for (const source of EVAL_SOURCES) {
      for (const chunk of source.chunks) registerChunk(chunk.content, chunk.id);
      await seedSource({
        sourceKey: source.sourceKey,
        courseSlug: source.courseSlug,
        title: source.title,
        chunks: source.chunks,
      });
    }
    // 升级 c1 到 v2（过期版本场景）：新文档 embedding 中 c1 携带旧 contentHash。
    registerChunk(VERSION_UPGRADE.contentV2, VERSION_UPGRADE.chunkId);
    await upgradeChunkV2(VERSION_UPGRADE);

    for (const source of EVAL_SOURCES.filter(
      (s) => s.ownerStudent === 'studentA',
    )) {
      await bindSource({
        sessionId: sessionA.sessionId,
        studentId: STUDENT_A,
        sourceKey: source.sourceKey,
      });
    }
    await bindSource({
      sessionId: sessionB.sessionId,
      studentId: STUDENT_B,
      sourceKey: 'textbook-electricity',
    });

    // 每个 query 一个 turn：freeze 该 turn 的 source 版本后三种配置在同一冻结集上比较。
    queryTurns = {};
    for (const entry of EVAL_QUERIES) {
      const turnId = randomUUID();
      await database.insert(schema.chatMessages).values({
        id: randomUUID(),
        sessionId: sessionA.sessionId,
        turnId,
        clientMessageId: `client-${turnId}`,
        requestHash: hashKnowledgeText(turnId),
        role: 'student',
        status: 'completed',
        content: entry.query,
        completedAt: baseTime,
        createdAt: baseTime,
      });
      await retrieval.freezeTurnSourceVersions({
        trustedStudentId: STUDENT_A,
        sessionId: sessionA.sessionId,
        turnId,
        now: baseTime,
      });
      queryTurns[entry.id] = { turnId };
    }
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('harness 自检：词法路拒答/越权为空，向量路不泄漏其他学生内容，陈旧向量被排除', async () => {
    const sourceCount = await database
      .select({ id: schema.knowledgeSources.id })
      .from(schema.knowledgeSources);
    expect(sourceCount.length).toBe(EVAL_SOURCES.length);

    // studentA 可见的 chunk 集合（越权检查用）。
    const visibleChunkIds = new Set<string>();
    for (const source of EVAL_SOURCES.filter(
      (s) => s.ownerStudent === 'studentA',
    )) {
      for (const chunk of source.chunks) visibleChunkIds.add(chunk.id);
    }
    visibleChunkIds.add(VERSION_UPGRADE.chunkId);

    // 无答案（q4）与跨用户越权（q8）：
    // - 词法路（纯 FTS 与诚实回退）必须拒答 —— 检索层词法契约；
    // - hybrid 路按产品设计（ADR-0015：绝不返回空结果冒充「没有相关内容」，
    //   向量路无绝对相似度阈值）必然返回不相关候选：断言候选非空、且全部
    //   来自 studentA 本人可见语料（不泄漏 q8 的 electricity 内容）。
    for (const entry of EVAL_QUERIES.filter((q) => q.expectEmpty)) {
      for (const config of ['fts-only', 'fallback'] as const) {
        const result = await runRetrieval({
          config,
          studentId: STUDENT_A,
          sessionId: sessionA.sessionId,
          turnId: queryTurns[entry.id]!.turnId,
          query: entry.query,
          queryEmbedding: basisVector(entry.queryAxis),
          limit: 20,
        });
        expect(result.candidates.length, `${entry.id} ${config} 应拒答`).toBe(
          0,
        );
      }
      const hybridResult = await runRetrieval({
        config: 'hybrid',
        studentId: STUDENT_A,
        sessionId: sessionA.sessionId,
        turnId: queryTurns[entry.id]!.turnId,
        query: entry.query,
        queryEmbedding: basisVector(entry.queryAxis),
        limit: 20,
      });
      const ids = hybridResult.candidates.map((candidate) =>
        chunkIdByContent.get(candidate.text),
      );
      expect(
        hybridResult.candidates.length,
        `${entry.id} hybrid 按设计返回非空（无阈值）`,
      ).toBeGreaterThan(0);
      for (const id of ids) {
        expect(
          visibleChunkIds.has(id!),
          `${entry.id} hybrid 候选不得来自其他学生语料`,
        ).toBe(true);
      }
    }

    // q10 零词面重叠，仅向量路能命中 c3：c3 在 → 向量路工作；c1 不在 → 陈旧向量被排除。
    const q10 = EVAL_QUERIES.find((entry) => entry.id === 'q10')!;
    const result = await runRetrieval({
      config: 'hybrid',
      studentId: STUDENT_A,
      sessionId: sessionA.sessionId,
      turnId: queryTurns['q10']!.turnId,
      query: q10.query,
      queryEmbedding: basisVector(q10.queryAxis),
      limit: 20,
    });
    const ids = result.candidates.map((candidate) =>
      chunkIdByContent.get(candidate.text),
    );
    expect(ids).toContain('c3');
    expect(ids).not.toContain('c1');

    // q7 注入场景：答案 c8 必须排第一，注入 chunk（c9）不得高于答案。
    const q7 = EVAL_QUERIES.find((entry) => entry.id === 'q7')!;
    const q7Result = await runRetrieval({
      config: 'hybrid',
      studentId: STUDENT_A,
      sessionId: sessionA.sessionId,
      turnId: queryTurns['q7']!.turnId,
      query: q7.query,
      queryEmbedding: basisVector(q7.queryAxis),
      limit: 20,
    });
    const q7Ids = q7Result.candidates.map((candidate) =>
      chunkIdByContent.get(candidate.text),
    );
    expect(q7Ids[0], 'q7 答案 c8 必须排第一').toBe('c8');
    expect(q7Ids.indexOf('c9'), '注入 chunk c9 不得高于答案').toBeGreaterThan(
      q7Ids.indexOf('c8'),
    );

    // q6 过期版本场景的确定性守卫：v2 内容（c1）在词法路必须排第一。
    // 若 c1 与 a1 的 ts_rank_cd 并列（同 chunkIndex 0），决胜会落到 uuid，
    // 运行间排序翻转（曾实测 MRR 在 1.0/0.5 间抖动）——该并列类已被数据集
    // 修订记录第 2 条消除，本断言防止回归。
    for (const config of ['fts-only', 'fallback'] as const) {
      const q6Result = await runRetrieval({
        config,
        studentId: STUDENT_A,
        sessionId: sessionA.sessionId,
        turnId: queryTurns['q6']!.turnId,
        query: EVAL_QUERIES.find((entry) => entry.id === 'q6')!.query,
        queryEmbedding: basisVector(
          EVAL_QUERIES.find((entry) => entry.id === 'q6')!.queryAxis,
        ),
        limit: 20,
      });
      const q6Ids = q6Result.candidates.map((candidate) =>
        chunkIdByContent.get(candidate.text),
      );
      expect(
        q6Ids[0],
        `q6 ${config} 的 v2 内容 c1 必须排第一（无 uuid 平局）`,
      ).toBe('c1');
    }
  });

  it('生成冻结评测报告并验证回退诚实标记', async () => {
    const runsPerQuery = 5;
    /* 延迟按检索器配置分组采集（2026-08-07 修正：v1-08-06 报告曾把三种配置
       的计时混入单一分位，无法支撑 "hybrid-only" 的发布延迟基线；重提后
       latencyMsByRetriever 逐配置给出 p50/p95，hybrid-only 基线取 hybrid 分位）。 */
    const latenciesByConfig: Record<
      'hybrid' | 'fts-only' | 'fallback',
      number[]
    > = { hybrid: [], 'fts-only': [], fallback: [] };
    const report: {
      dataset: { version: string; created: string; authorization: string };
      generatedAt: string;
      retrievers: Record<string, unknown>;
      perQuery: unknown[];
      latencyMsByRetriever: Record<
        string,
        { p50?: number; p95?: number; samples: number }
      >;
      fallbackHonesty: {
        retriever: string;
        version: string;
        matchesFts: boolean;
      };
      findings: {
        ftsAndSemantics: string;
        noAnswerHybridBehavior: {
          id: string;
          ftsCandidateCount: number;
          hybridCandidateCount: number;
          note: string;
        }[];
      };
      limitSweep?: Record<string, { meanRecall: number | undefined }>;
    } = {
      dataset: {
        version: EVAL_DATASET_VERSION,
        created: EVAL_DATASET_CREATED,
        authorization: EVAL_DATASET_AUTHORIZATION,
      },
      generatedAt: new Date().toISOString(),
      retrievers: {},
      perQuery: [],
      latencyMsByRetriever: {},
      fallbackHonesty: { retriever: '', version: '', matchesFts: false },
      findings: {
        ftsAndSemantics:
          'FTS 使用 websearch_to_tsquery(simple)，未加引号词项为全词 AND：查询含任一语料外词项即整句零命中（部分重叠/真实同义词必然失配）。v1 查询词表因此全部取自语料词项（见数据集修订记录）',
        noAnswerHybridBehavior: EVAL_QUERIES.filter(
          (entry) => entry.expectEmpty,
        ).map((entry) => ({
          id: entry.id,
          ftsCandidateCount: 0,
          hybridCandidateCount: 0,
          note: '',
        })),
      },
    };

    const aggregate = {
      hybrid: {
        recall10: [] as number[],
        recall20: [] as number[],
        mrr: [] as number[],
        ndcg: [] as number[],
      },
      'fts-only': {
        recall10: [] as number[],
        recall20: [] as number[],
        mrr: [] as number[],
        ndcg: [] as number[],
      },
      fallback: {
        recall10: [] as number[],
        recall20: [] as number[],
        mrr: [] as number[],
        ndcg: [] as number[],
      },
    };

    for (const entry of EVAL_QUERIES) {
      const perConfig: Record<string, unknown> = {};
      for (const config of ['hybrid', 'fts-only', 'fallback'] as const) {
        const candidateIds: string[] = [];
        let lastResult: Awaited<ReturnType<typeof runRetrieval>> | undefined;
        for (let i = 0; i < runsPerQuery; i += 1) {
          const started = performance.now();
          const result = await runRetrieval({
            config,
            studentId: STUDENT_A,
            sessionId: sessionA.sessionId,
            turnId: queryTurns[entry.id]!.turnId,
            query: entry.query,
            queryEmbedding: basisVector(entry.queryAxis),
            limit: 20,
          });
          latenciesByConfig[config]!.push(performance.now() - started);
          lastResult = result;
        }
        candidateIds.length = 0;
        for (const candidate of lastResult!.candidates) {
          const id = chunkIdByContent.get(candidate.text);
          if (id) candidateIds.push(id);
        }
        const metrics10 = computeMetrics(candidateIds, entry.golden, 10);
        const metrics20 = computeMetrics(candidateIds, entry.golden, 20);
        perConfig[config] = {
          topIds: candidateIds,
          recall10: metrics10.recall,
          mrr10: metrics10.mrr,
          ndcg10: metrics10.ndcg,
          recall20: metrics20.recall,
          retriever: lastResult!.retriever,
          retrieverVersion: lastResult!.retrieverVersion,
          vectorApplied: lastResult!.vectorApplied,
        };
        if (entry.golden.length > 0) {
          const agg = aggregate[config];
          agg.recall10.push(metrics10.recall ?? 0);
          agg.recall20.push(metrics20.recall ?? 0);
          agg.mrr.push(metrics10.mrr);
          agg.ndcg.push(metrics10.ndcg ?? 0);
        }
      }
      report.perQuery.push({
        id: entry.id,
        scenario: entry.scenario,
        golden: entry.golden,
        perConfig,
      });
    }

    // 不同 limit 配置（hybrid，计划 Q01 比较维度）：limit ∈ {5, 10, 20}。
    const limitAggregate: Record<number, number[]> = { 5: [], 10: [], 20: [] };
    for (const entry of EVAL_QUERIES) {
      const perLimit: Record<number, { recall?: number }> = {};
      for (const limit of [5, 10, 20]) {
        const result = await runRetrieval({
          config: 'hybrid',
          studentId: STUDENT_A,
          sessionId: sessionA.sessionId,
          turnId: queryTurns[entry.id]!.turnId,
          query: entry.query,
          queryEmbedding: basisVector(entry.queryAxis),
          limit,
        });
        const ids = result.candidates.map((candidate) =>
          chunkIdByContent.get(candidate.text),
        );
        const metrics = computeMetrics(ids, entry.golden, limit);
        perLimit[limit] = { recall: metrics.recall };
        if (entry.golden.length > 0)
          limitAggregate[limit]!.push(metrics.recall ?? 0);
      }
      const row = report.perQuery.find(
        (r) => (r as { id: string }).id === entry.id,
      ) as {
        perLimit: Record<number, { recall?: number }>;
      };
      row.perLimit = perLimit;
    }
    report.limitSweep = {
      meanRecallByLimit: Object.fromEntries(
        Object.entries(limitAggregate).map(([limit, recalls]) => [
          limit,
          { meanRecall: mean(recalls) },
        ]),
      ),
    };

    // 基线发现：语料外查询（q4/q8）的 hybrid 行为 —— 向量路无绝对相似度阈值，
    // 返回距离平局的候选（ADR-0015 明确"绝不返回空结果冒充没有相关内容"），
    // 拒答语义由上层 agent 层承担。这是检索层基线事实，不是缺陷。
    report.findings.noAnswerHybridBehavior = EVAL_QUERIES.filter(
      (entry) => entry.expectEmpty,
    ).map((entry) => {
      const row = report.perQuery.find(
        (r) => (r as { id: string }).id === entry.id,
      ) as {
        perConfig: Record<string, { topIds: string[] }>;
      };
      return {
        id: entry.id,
        ftsCandidateCount: 0,
        hybridCandidateCount: row.perConfig.hybrid!.topIds.length,
        note: 'hybrid 向量路无阈值，返回距离平局候选；词法路拒答；拒答语义由上层 agent 层承担',
      };
    });

    // 回退诚实性：fallback 配置必须如实标记 LEXICAL 回退，且与纯 FTS 等价。
    const q1Row = report.perQuery.find(
      (row) => (row as { id: string }).id === 'q1',
    ) as {
      perConfig: Record<
        string,
        { retriever: string; retrieverVersion: string; topIds: string[] }
      >;
    };
    const fallbackEntry = q1Row.perConfig.fallback!;
    const ftsEntry = q1Row.perConfig['fts-only']!;
    report.fallbackHonesty = {
      retriever: fallbackEntry.retriever,
      version: fallbackEntry.retrieverVersion ?? '',
      matchesFts:
        fallbackEntry.retriever === LEXICAL_RETRIEVER &&
        fallbackEntry.retrieverVersion === HYBRID_LEXICAL_FALLBACK_VERSION &&
        JSON.stringify(fallbackEntry.topIds) ===
          JSON.stringify(ftsEntry.topIds),
    };
    expect(
      report.fallbackHonesty.matchesFts,
      'fallback 应诚实标记 LEXICAL 并与 FTS 等价',
    ).toBe(true);

    report.latencyMsByRetriever = Object.fromEntries(
      Object.entries(latenciesByConfig).map(([name, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return [
          name,
          {
            p50: percentile(sorted, 0.5),
            p95: percentile(sorted, 0.95),
            samples: values.length,
          },
        ];
      }),
    );
    report.retrievers = Object.fromEntries(
      Object.entries(aggregate).map(([name, values]) => [
        name,
        {
          meanRecall10: mean(values.recall10),
          meanRecall20: mean(values.recall20),
          meanMRR10: mean(values.mrr),
          meanNDCG10: mean(values.ndcg),
        },
      ]),
    );

    const reportsDir = fileURLToPath(new URL('./reports', import.meta.url));
    mkdirSync(reportsDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const reportPath = `${reportsDir}/rag-eval-${EVAL_DATASET_VERSION}-${date}.json`;
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    // console 摘要（报告是评测产出，摘要便于人工评审）。
    console.log('\n===== Q01 RAG 评测摘要 =====');
    console.log(
      `数据集 v${report.dataset.version}（${report.dataset.created}）`,
    );
    console.log(`报告: ${reportPath}`);
    for (const [name, values] of Object.entries(report.retrievers)) {
      const v = values as Record<string, number | undefined>;
      console.log(
        `${name.padEnd(9)} recall@10=${v.meanRecall10?.toFixed(3)} recall@20=${v.meanRecall20?.toFixed(3)} mrr@10=${v.meanMRR10?.toFixed(3)} ndcg@10=${v.meanNDCG10?.toFixed(3)}`,
      );
    }
    for (const [name, values] of Object.entries(report.latencyMsByRetriever)) {
      console.log(
        `延迟(${name}) p50=${values.p50?.toFixed(1)}ms p95=${values.p95?.toFixed(1)}ms (n=${values.samples})`,
      );
    }
    console.log(
      `fallback 诚实标记: retriever=${report.fallbackHonesty.retriever} version=${report.fallbackHonesty.version} matchesFts=${report.fallbackHonesty.matchesFts}`,
    );
    console.log('==============================');
  });
});
