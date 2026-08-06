import { randomUUID } from 'node:crypto';
import { PLATFORM_EMBEDDING_DIMENSIONS } from '@educanvas/agent-core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleKnowledgeEmbeddingRepository } from './knowledge-embedding-repository';
import {
  DrizzleKnowledgeHybridRetrieval,
  HYBRID_LEXICAL_FALLBACK_VERSION,
  HYBRID_RETRIEVER,
  HYBRID_RETRIEVER_VERSION,
  LEXICAL_RETRIEVER,
  type EmbeddingIdentity,
} from './knowledge-hybrid-retrieval';
import { DrizzleKnowledgeRetrievalRepository } from './knowledge-retrieval-repository';
import {
  DrizzleKnowledgeSourceRepository,
  hashKnowledgeText,
} from './knowledge-source-repository';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('集成测试拒绝清空非隔离数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 8 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;
const baseTime = new Date('2026-07-27T10:00:00.000Z');

const IDENTITY: EmbeddingIdentity = {
  embeddingModel: 'embed-fixture',
  embeddingModelVersion: '2026-05-01',
  instruction: 'passage:v1',
};

/**
 * 固定的正交单位向量。相关性证据必须来自可复算的固定 fixture：随机向量只能
 * 证明「代码跑通了」，证明不了排序是否符合预期。
 */
function basisVector(axis: number): number[] {
  const vector = new Array<number>(PLATFORM_EMBEDDING_DIMENSIONS).fill(0);
  vector[axis] = 1;
  return vector;
}

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

async function seedSessionAndTurn(input: {
  studentId: string;
  courseSlug: string;
}) {
  const sessionId = randomUUID();
  const turnId = randomUUID();
  await getDatabase().insert(schema.lessonSessions).values({
    id: sessionId,
    studentId: input.studentId,
    gradeBand: 'middle_school',
    courseSlug: input.courseSlug,
    knowledgeNodeId: 'node-hybrid',
    state: 'EXPLAIN',
    lastActivityAt: baseTime,
    createdAt: baseTime,
    updatedAt: baseTime,
  });
  await getDatabase()
    .insert(schema.chatMessages)
    .values({
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
  return { sessionId, turnId };
}

/**
 * 三个切块的固定语料：
 * - lexical：与查询词面完全重叠，纯 FTS 必然命中；
 * - semantic：与查询无任何词面重叠，只有向量能找到；
 * - unrelated：两路都不该命中。
 */
const CORPUS = [
  { label: 'lexical', content: '反向 传播 通过 误差 更新 权重', axis: 5 },
  { label: 'semantic', content: '梯度 下降 让 损失 逐步 变小', axis: 0 },
  { label: 'unrelated', content: '光合 作用 发生 在 叶绿体', axis: 9 },
] as const;

/** 查询向量与 semantic 切块同向：向量路必须把它排在第一。 */
const QUERY = '反向 传播 更新 权重';
const QUERY_VECTOR = basisVector(0);

async function seedCorpus(courseSlug: string, sessionId: string) {
  const sources = new DrizzleKnowledgeSourceRepository(getDatabase());
  const source = await sources.createOrGetSource({
    gradeBand: 'middle_school',
    courseSlug,
    sourceKey: `textbook-${courseSlug}`,
    title: '深度学习入门',
    sourceType: 'pdf',
    now: baseTime,
  });
  const document = await sources.ingestDocument({
    sourceId: source.source.id,
    contentHash: hashKnowledgeText(`document-${courseSlug}`),
    objectKey: `courses/${courseSlug}/textbook.pdf`,
    parserVersion: 'pdf-text-v1',
    outcome: {
      status: 'ready',
      chunks: CORPUS.map((entry) => ({ content: entry.content })),
    },
    now: baseTime,
  });

  await new DrizzleKnowledgeRetrievalRepository(
    getDatabase(),
  ).setSessionSourceBinding({
    trustedStudentId: (
      await getDatabase()
        .select({ studentId: schema.lessonSessions.studentId })
        .from(schema.lessonSessions)
        .where(sql`${schema.lessonSessions.id} = ${sessionId}`)
        .limit(1)
    )[0]!.studentId,
    sessionId,
    sourceId: source.source.id,
    enabled: true,
    mutationId: `bind-${randomUUID().slice(0, 8)}`,
    now: baseTime,
  });
  return { sourceId: source.source.id, documentId: document.document.id };
}

async function writeCorpusEmbeddings(
  documentId: string,
  overrides: {
    identity?: EmbeddingIdentity;
    contentHashOverride?: string;
    only?: readonly string[];
  } = {},
) {
  const chunks = await getDatabase()
    .select({
      id: schema.knowledgeChunks.id,
      chunkIndex: schema.knowledgeChunks.chunkIndex,
      contentHash: schema.knowledgeChunks.contentHash,
    })
    .from(schema.knowledgeChunks)
    .where(sql`${schema.knowledgeChunks.documentId} = ${documentId}`)
    .orderBy(schema.knowledgeChunks.chunkIndex);

  const selected = chunks.filter(
    (chunk) =>
      overrides.only === undefined ||
      overrides.only.includes(CORPUS[chunk.chunkIndex]!.label),
  );
  await new DrizzleKnowledgeEmbeddingRepository(getDatabase()).createOrGetRun({
    documentId,
    identity: overrides.identity ?? IDENTITY,
  });
  await new DrizzleKnowledgeEmbeddingRepository(getDatabase()).writeEmbeddings({
    documentId,
    identity: overrides.identity ?? IDENTITY,
    chunkingVersion: 'pdf-text-v1',
    embeddings: selected.map((chunk) => ({
      chunkId: chunk.id,
      chunkContentHash: overrides.contentHashOverride ?? chunk.contentHash,
      vector: basisVector(CORPUS[chunk.chunkIndex]!.axis),
    })),
    now: baseTime,
  });
}

async function freezeAndRetrieve(input: {
  studentId: string;
  sessionId: string;
  turnId: string;
  queryEmbedding?: readonly number[] | null;
  identity?: EmbeddingIdentity | null;
  limit?: number;
}) {
  await new DrizzleKnowledgeRetrievalRepository(
    getDatabase(),
  ).freezeTurnSourceVersions({
    trustedStudentId: input.studentId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    now: baseTime,
  });
  return new DrizzleKnowledgeHybridRetrieval(getDatabase()).retrieveHybrid({
    trustedStudentId: input.studentId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    query: QUERY,
    limit: input.limit ?? 5,
    traceId: 'trace-hybrid',
    queryEmbedding: input.queryEmbedding ?? null,
    embeddingIdentity: input.identity === undefined ? IDENTITY : input.identity,
    now: baseTime,
  });
}

const labelsOf = (candidates: readonly { text: string }[]) =>
  candidates.map(
    (candidate) =>
      CORPUS.find((entry) => entry.content === candidate.text)?.label ??
      'unknown',
  );

describeWithDatabase('pgvector 混合检索', () => {
  const studentId = `anon:v1:${'h'.repeat(64)}`;

  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
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
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('未提供查询向量时退回纯 FTS 并诚实标记 retriever', async () => {
    const { sessionId, turnId } = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-fallback',
    });
    await seedCorpus('dl-fallback', sessionId);

    const result = await freezeAndRetrieve({
      studentId,
      sessionId,
      turnId,
      /* 调用方什么都没提供：向量与身份都缺 → not_configured，而不是
         身份缺失导致的 invalid_configuration（半配置）。 */
      identity: null,
    });

    expect(result.retriever).toBe(LEXICAL_RETRIEVER);
    expect(result.retrieverVersion).toBe(HYBRID_LEXICAL_FALLBACK_VERSION);
    expect(result.vectorApplied).toBe(false);
    expect(result.degradationReason).toBe('not_configured');
    expect(labelsOf(result.candidates)).toEqual(['lexical']);
  });

  it('只有查询向量没有身份时标记 invalid_configuration 并退回词法', async () => {
    const { sessionId, turnId } = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-half-config',
    });
    await seedCorpus('dl-half-config', sessionId);

    const result = await freezeAndRetrieve({
      studentId,
      sessionId,
      turnId,
      queryEmbedding: QUERY_VECTOR,
      identity: null,
    });

    expect(result.retriever).toBe(LEXICAL_RETRIEVER);
    expect(result.vectorApplied).toBe(false);
    expect(result.degradationReason).toBe('invalid_configuration');
    expect(labelsOf(result.candidates)).toEqual(['lexical']);
  });

  it('向量路补回纯词法找不到的语义相关切块', async () => {
    const { sessionId, turnId } = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-hybrid',
    });
    const { documentId } = await seedCorpus('dl-hybrid', sessionId);
    await writeCorpusEmbeddings(documentId);

    const result = await freezeAndRetrieve({
      studentId,
      sessionId,
      turnId,
      queryEmbedding: QUERY_VECTOR,
    });

    expect(result.retriever).toBe(HYBRID_RETRIEVER);
    expect(result.retrieverVersion).toBe(HYBRID_RETRIEVER_VERSION);
    expect(result.vectorApplied).toBe(true);
    const labels = labelsOf(result.candidates);
    /* 两路各自的第一名都必须进入结果，这正是 RRF 相对单路排序的价值。 */
    expect(labels.slice(0, 2).sort()).toEqual(['lexical', 'semantic']);
    expect(result.candidates.map((candidate) => candidate.rank)).toEqual([
      1, 2, 3,
    ]);
    expect(
      result.candidates.every(
        (candidate) => candidate.score > 0 && candidate.score <= 1,
      ),
    ).toBe(true);
  });

  it('重放同一查询返回相同排序且不重复写入候选', async () => {
    const { sessionId, turnId } = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-replay',
    });
    const { documentId } = await seedCorpus('dl-replay', sessionId);
    await writeCorpusEmbeddings(documentId);

    const first = await freezeAndRetrieve({
      studentId,
      sessionId,
      turnId,
      queryEmbedding: QUERY_VECTOR,
    });
    const second = await freezeAndRetrieve({
      studentId,
      sessionId,
      turnId,
      queryEmbedding: QUERY_VECTOR,
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(labelsOf(second.candidates)).toEqual(labelsOf(first.candidates));
    const [rows] = await getDatabase().execute<{ count: number }>(
      sql`select count(*)::int as count from retrieval_candidates where turn_id = ${turnId}`,
    );
    expect(rows).toMatchObject({ count: first.candidates.length });
  });

  it('跨模型版本与跨指令的向量不参与排序', async () => {
    const { sessionId, turnId } = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-upgrade',
    });
    const { documentId } = await seedCorpus('dl-upgrade', sessionId);
    await writeCorpusEmbeddings(documentId, {
      identity: { ...IDENTITY, embeddingModelVersion: '2026-01-01' },
    });

    const result = await freezeAndRetrieve({
      studentId,
      sessionId,
      turnId,
      queryEmbedding: QUERY_VECTOR,
    });

    /* 向量路仍然执行了，只是旧版本向量全部落选，结果收敛为纯词法命中；
       语料有嵌入但身份不匹配（模型升级后未重嵌入）是长期隐性降级，必须
       以 invalid_configuration 标记。 */
    expect(result.vectorApplied).toBe(true);
    expect(result.degradationReason).toBe('invalid_configuration');
    expect(labelsOf(result.candidates)).toEqual(['lexical']);
  });

  it('语料完全未嵌入时标记 corpus_not_embedded 并按词法回退，FTS 结果仍可用', async () => {
    const { sessionId, turnId } = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-no-embed',
    });
    await seedCorpus('dl-no-embed', sessionId);
    /* 不写任何 embedding：模拟语料入库后嵌入管线从未运行。 */

    const result = await freezeAndRetrieve({
      studentId,
      sessionId,
      turnId,
      queryEmbedding: QUERY_VECTOR,
    });

    expect(result.retriever).toBe(LEXICAL_RETRIEVER);
    expect(result.retrieverVersion).toBe(HYBRID_LEXICAL_FALLBACK_VERSION);
    expect(result.vectorApplied).toBe(false);
    expect(result.degradationReason).toBe('corpus_not_embedded');
    /* 用户仍获得 FTS 结果（Q02 要求：降级不断供）。 */
    expect(labelsOf(result.candidates)).toEqual(['lexical']);
  });

  it('内容漂移的陈旧向量被排除，不以旧语义参与打分', async () => {
    const { sessionId, turnId } = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-drift',
    });
    const { documentId } = await seedCorpus('dl-drift', sessionId);
    await writeCorpusEmbeddings(documentId, {
      contentHashOverride: 'b'.repeat(64),
    });

    const result = await freezeAndRetrieve({
      studentId,
      sessionId,
      turnId,
      queryEmbedding: QUERY_VECTOR,
    });

    expect(labelsOf(result.candidates)).toEqual(['lexical']);
  });

  it('维度不符的查询向量退回纯 FTS，不截断也不补零', async () => {
    const { sessionId, turnId } = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-dimension',
    });
    const { documentId } = await seedCorpus('dl-dimension', sessionId);
    await writeCorpusEmbeddings(documentId);

    const result = await freezeAndRetrieve({
      studentId,
      sessionId,
      turnId,
      queryEmbedding: new Array<number>(8).fill(1),
    });

    expect(result.retriever).toBe(LEXICAL_RETRIEVER);
    expect(result.vectorApplied).toBe(false);
    expect(result.degradationReason).toBe('invalid_dimensions');
    expect(labelsOf(result.candidates)).toEqual(['lexical']);
  });

  it('权限先于召回：未冻结进本轮的文档即使向量最近也不会被返回', async () => {
    const otherStudent = `anon:v1:${'k'.repeat(64)}`;
    const mine = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-scope-mine',
    });
    const theirs = await seedSessionAndTurn({
      studentId: otherStudent,
      courseSlug: 'dl-scope-theirs',
    });
    await seedCorpus('dl-scope-mine', mine.sessionId);
    const foreign = await seedCorpus('dl-scope-theirs', theirs.sessionId);
    await writeCorpusEmbeddings(foreign.documentId);

    const result = await freezeAndRetrieve({
      studentId,
      sessionId: mine.sessionId,
      turnId: mine.turnId,
      queryEmbedding: QUERY_VECTOR,
    });

    /* 另一名学生课程里的 semantic 切块向量与查询完全同向，但它没有被冻结进
       本轮快照，因此连进入候选池的机会都没有。 */
    expect(labelsOf(result.candidates)).toEqual(['lexical']);

    await expect(
      freezeAndRetrieve({
        studentId,
        sessionId: theirs.sessionId,
        turnId: theirs.turnId,
        queryEmbedding: QUERY_VECTOR,
      }),
    ).rejects.toMatchObject({ code: 'knowledge_turn_not_found' });
  });

  it('limit 收敛候选数量且名次连续', async () => {
    const { sessionId, turnId } = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-limit',
    });
    const { documentId } = await seedCorpus('dl-limit', sessionId);
    await writeCorpusEmbeddings(documentId);

    const result = await freezeAndRetrieve({
      studentId,
      sessionId,
      turnId,
      queryEmbedding: QUERY_VECTOR,
      limit: 2,
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.rank)).toEqual([
      1, 2,
    ]);
  });

  it('部分嵌入不破坏检索：只嵌入一部分切块仍返回可用结果', async () => {
    const { sessionId, turnId } = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-partial',
    });
    const { documentId } = await seedCorpus('dl-partial', sessionId);
    await writeCorpusEmbeddings(documentId, { only: ['semantic'] });

    const result = await freezeAndRetrieve({
      studentId,
      sessionId,
      turnId,
      queryEmbedding: QUERY_VECTOR,
    });

    expect(result.vectorApplied).toBe(true);
    expect(labelsOf(result.candidates).sort()).toEqual(['lexical', 'semantic']);
  });

  it('向量查询超时后回滚到savepoint并在同一事务写入FTS候选', async () => {
    const { sessionId, turnId } = await seedSessionAndTurn({
      studentId,
      courseSlug: 'dl-timeout',
    });
    const { documentId } = await seedCorpus('dl-timeout', sessionId);
    await writeCorpusEmbeddings(documentId);

    const blocker = postgres(testDatabaseUrl!, { max: 1 });
    let releaseLock!: () => void;
    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTask = blocker.begin(async (transaction) => {
      await transaction.unsafe(
        'lock table knowledge_chunk_embeddings in access exclusive mode',
      );
      markLocked();
      await release;
    });

    try {
      await locked;
      const result = await freezeAndRetrieve({
        studentId,
        sessionId,
        turnId,
        queryEmbedding: QUERY_VECTOR,
      });

      expect(result.retriever).toBe(LEXICAL_RETRIEVER);
      expect(result.vectorApplied).toBe(false);
      expect(result.degradationReason).toBe('vector_query_timeout');
      expect(labelsOf(result.candidates)).toEqual(['lexical']);
    } finally {
      releaseLock();
      await lockTask;
      await blocker.end({ timeout: 5 });
    }
  });
});
