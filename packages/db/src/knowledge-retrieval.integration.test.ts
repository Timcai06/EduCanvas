import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ANONYMOUS_SUBJECT_RETENTION_MS,
  DrizzleAnonymousDataLifecycleService,
} from './anonymous-data-lifecycle';
import {
  CitationCandidateInvalidError,
  CitationConflictError,
  DrizzleKnowledgeRetrievalRepository,
  KnowledgeSourceScopeError,
} from './knowledge-retrieval-repository';
import {
  DrizzleKnowledgeSourceRepository,
  KnowledgeDocumentConflictError,
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
  ? postgres(testDatabaseUrl, { max: 12 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;
const baseTime = new Date('2026-07-15T10:00:00.000Z');

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

function anonymousSubject(character: string): string {
  return `anon:v1:${character.repeat(64)}`;
}

async function seedSession(input: {
  studentId: string;
  gradeBand?: string;
  courseSlug: string;
  suffix: string;
  lastActivityAt?: Date;
}) {
  const sessionId = randomUUID();
  const timestamp = input.lastActivityAt ?? baseTime;
  await getDatabase()
    .insert(schema.lessonSessions)
    .values({
      id: sessionId,
      studentId: input.studentId,
      gradeBand: input.gradeBand ?? 'middle_school',
      courseSlug: input.courseSlug,
      knowledgeNodeId: `node-${input.suffix}`,
      state: 'EXPLAIN',
      lastActivityAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  return sessionId;
}

async function seedTurn(sessionId: string, suffix: string) {
  const turnId = randomUUID();
  const studentMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  await getDatabase()
    .insert(schema.chatMessages)
    .values([
      {
        id: studentMessageId,
        sessionId,
        turnId,
        clientMessageId: `client-${suffix}`,
        requestHash: hashKnowledgeText(`question-${suffix}`),
        role: 'student',
        status: 'completed',
        content: `question-${suffix}`,
        completedAt: baseTime,
        createdAt: baseTime,
      },
      {
        id: assistantMessageId,
        sessionId,
        turnId,
        role: 'assistant',
        status: 'completed',
        content: `answer-${suffix}`,
        completedAt: baseTime,
        createdAt: baseTime,
      },
    ]);
  return { turnId, assistantMessageId };
}

async function createReadySource(input: {
  gradeBand?: string;
  courseSlug: string;
  sourceKey: string;
  title: string;
  documentLabel: string;
  chunks: readonly {
    content: string;
    heading?: string;
    pageStart?: number;
    pageEnd?: number;
  }[];
}) {
  const sources = new DrizzleKnowledgeSourceRepository(getDatabase());
  const source = await sources.createOrGetSource({
    gradeBand: input.gradeBand ?? 'middle_school',
    courseSlug: input.courseSlug,
    sourceKey: input.sourceKey,
    title: input.title,
    sourceType: 'pdf',
    now: baseTime,
  });
  const document = await sources.ingestDocument({
    sourceId: source.source.id,
    contentHash: hashKnowledgeText(input.documentLabel),
    objectKey: `courses/${input.courseSlug}/${input.documentLabel}.pdf`,
    parserVersion: 'pdf-text-v1',
    outcome: { status: 'ready', chunks: input.chunks },
    now: baseTime,
  });
  return { source: source.source, document: document.document };
}

describeWithDatabase('K1审核资料、FTS与服务端引用', () => {
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
        knowledge_chunks,
        knowledge_documents,
        knowledge_sources,
        turn_safety_decisions,
        tool_calls,
        model_runs,
        chat_messages,
        canvas_artifact_grading_keys,
        canvas_artifacts,
        learning_events,
        mastery_states,
        lesson_sessions
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('同一hash摄取幂等，失败显式可见，新ready版本只切换发布状态', async () => {
    const sources = new DrizzleKnowledgeSourceRepository(getDatabase());
    const sourceInput = {
      gradeBand: 'middle_school',
      courseSlug: 'ai-basics',
      sourceKey: 'approved-textbook',
      title: '人工智能基础教材',
      sourceType: 'pdf' as const,
      now: baseTime,
    };
    const createdSources = await Promise.all([
      sources.createOrGetSource(sourceInput),
      sources.createOrGetSource(sourceInput),
    ]);
    expect(createdSources.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    const sourceId = createdSources[0]!.source.id;
    const firstInput = {
      sourceId,
      contentHash: hashKnowledgeText('document-v1'),
      objectKey: 'courses/ai-basics/document-v1.pdf',
      parserVersion: 'pdf-text-v1',
      outcome: {
        status: 'ready' as const,
        chunks: [
          {
            content: '猫 特征 可以 帮助 图像 分类',
            heading: '图像分类',
            pageStart: 3,
            pageEnd: 3,
          },
        ],
      },
      now: baseTime,
    };
    await expect(sources.ingestDocument(firstInput)).resolves.toMatchObject({
      replayed: false,
      document: { version: 1, parseStatus: 'ready' },
    });
    await expect(sources.ingestDocument(firstInput)).resolves.toMatchObject({
      replayed: true,
      document: { version: 1 },
    });
    await expect(
      sources.ingestDocument({
        ...firstInput,
        outcome: {
          status: 'ready',
          chunks: [{ content: '同hash却改变解析内容' }],
        },
      }),
    ).rejects.toBeInstanceOf(KnowledgeDocumentConflictError);
    await expect(
      sources.ingestDocument({
        sourceId,
        contentHash: hashKnowledgeText('document-failed'),
        objectKey: 'courses/ai-basics/document-failed.pdf',
        parserVersion: 'pdf-text-v1',
        outcome: { status: 'parse_failed', failureCode: 'PDF_PARSE_FAILED' },
        now: new Date(baseTime.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({
      document: { version: 2, parseStatus: 'parse_failed' },
    });
    await expect(
      sources.ingestDocument({
        sourceId,
        contentHash: hashKnowledgeText('document-v2'),
        objectKey: 'courses/ai-basics/document-v2.pdf',
        parserVersion: 'pdf-text-v1',
        outcome: {
          status: 'ready',
          chunks: [{ content: '新版 机器 学习 教材' }],
        },
        now: new Date(baseTime.getTime() + 2_000),
      }),
    ).resolves.toMatchObject({
      document: { version: 3, parseStatus: 'ready' },
    });
    expect(await sources.listDocuments(sourceId)).toMatchObject([
      { version: 3, parseStatus: 'ready' },
      {
        version: 2,
        parseStatus: 'parse_failed',
        failureCode: 'PDF_PARSE_FAILED',
      },
      { version: 1, parseStatus: 'superseded' },
    ]);

    const [firstChunk] = await getDatabase()
      .select()
      .from(schema.knowledgeChunks);
    await expect(
      getDatabase()
        .update(schema.knowledgeChunks)
        .set({ content: '禁止改写' })
        .where(eq(schema.knowledgeChunks.id, firstChunk!.id)),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      getDatabase()
        .insert(schema.knowledgeChunks)
        .values({
          documentId: firstChunk!.documentId,
          chunkIndex: 999,
          contentHash: hashKnowledgeText('invalid-half-page-range'),
          content: '页码范围不能只提供一端',
          pageStart: null,
          pageEnd: 5,
        }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('空资料快照也留下完成事实，后续绑定不会改写同一Turn', async () => {
    const ready = await createReadySource({
      courseSlug: 'empty-snapshot-course',
      sourceKey: 'empty-snapshot-source',
      title: '空快照测试教材',
      documentLabel: 'empty-snapshot-v1',
      chunks: [{ content: '冻结 后 不可 改写' }],
    });
    const studentId = anonymousSubject('9');
    const sessionId = await seedSession({
      studentId,
      courseSlug: 'empty-snapshot-course',
      suffix: 'empty-snapshot',
    });
    const firstTurn = await seedTurn(sessionId, 'empty-snapshot-first');
    const retrieval = new DrizzleKnowledgeRetrievalRepository(getDatabase());

    await expect(
      retrieval.freezeTurnSourceVersions({
        trustedStudentId: studentId,
        sessionId,
        turnId: firstTurn.turnId,
      }),
    ).resolves.toEqual([]);
    expect(await getDatabase().$count(schema.turnSourceSnapshots)).toBe(1);

    await retrieval.setSessionSourceBinding({
      trustedStudentId: studentId,
      sessionId,
      sourceId: ready.source.id,
      enabled: true,
      mutationId: 'bind-after-empty-freeze',
    });
    await expect(
      retrieval.freezeTurnSourceVersions({
        trustedStudentId: studentId,
        sessionId,
        turnId: firstTurn.turnId,
      }),
    ).resolves.toEqual([]);
    expect(await getDatabase().$count(schema.turnSourceVersions)).toBe(0);

    const secondTurn = await seedTurn(sessionId, 'empty-snapshot-second');
    await expect(
      retrieval.freezeTurnSourceVersions({
        trustedStudentId: studentId,
        sessionId,
        turnId: secondTurn.turnId,
      }),
    ).resolves.toMatchObject([{ documentId: ready.document.id }]);
    expect(await getDatabase().$count(schema.turnSourceSnapshots)).toBe(2);
  });

  it('课程范围、FTS候选和citation白名单共同拒绝跨课程及伪造版本/chunk/candidate', async () => {
    const courseA = await createReadySource({
      courseSlug: 'course-a',
      sourceKey: 'source-a',
      title: '课程A教材',
      documentLabel: 'course-a-v1',
      chunks: [
        {
          content: '猫 特征 图像 分类',
          heading: '课程A',
          pageStart: 1,
          pageEnd: 1,
        },
      ],
    });
    const courseB = await createReadySource({
      courseSlug: 'course-b',
      sourceKey: 'source-b',
      title: '课程B教材',
      documentLabel: 'course-b-v1',
      chunks: [
        {
          content: '猫 特征 课程B私有内容',
          heading: '课程B',
          pageStart: 2,
          pageEnd: 2,
        },
      ],
    });
    const studentA = anonymousSubject('1');
    const sessionA = await seedSession({
      studentId: studentA,
      courseSlug: 'course-a',
      suffix: 'course-a',
    });
    const turnA = await seedTurn(sessionA, 'course-a');
    const retrieval = new DrizzleKnowledgeRetrievalRepository(getDatabase());
    await expect(
      retrieval.setSessionSourceBinding({
        trustedStudentId: studentA,
        sessionId: sessionA,
        sourceId: courseB.source.id,
        enabled: true,
        mutationId: 'bind-cross-course',
      }),
    ).rejects.toBeInstanceOf(KnowledgeSourceScopeError);
    await expect(
      retrieval.setSessionSourceBinding({
        trustedStudentId: studentA,
        sessionId: sessionA,
        sourceId: courseA.source.id,
        enabled: true,
        mutationId: 'bind-course-a',
      }),
    ).resolves.toMatchObject({ replayed: false });
    await expect(
      retrieval.setSessionSourceBinding({
        trustedStudentId: studentA,
        sessionId: sessionA,
        sourceId: courseA.source.id,
        enabled: true,
        mutationId: 'bind-course-a',
      }),
    ).resolves.toMatchObject({ replayed: true });
    await retrieval.freezeTurnSourceVersions({
      trustedStudentId: studentA,
      sessionId: sessionA,
      turnId: turnA.turnId,
    });
    const resultA = await retrieval.retrieveFts({
      trustedStudentId: studentA,
      sessionId: sessionA,
      turnId: turnA.turnId,
      query: '猫 特征',
      limit: 10,
      traceId: 'trace-course-a',
    });
    expect(resultA.candidates).toHaveLength(1);
    expect(resultA.candidates[0]).toMatchObject({
      sourceId: courseA.source.id,
      documentId: courseA.document.id,
      rank: 1,
    });

    const studentB = anonymousSubject('2');
    const sessionB = await seedSession({
      studentId: studentB,
      courseSlug: 'course-b',
      suffix: 'course-b',
    });
    const turnB = await seedTurn(sessionB, 'course-b');
    await retrieval.setSessionSourceBinding({
      trustedStudentId: studentB,
      sessionId: sessionB,
      sourceId: courseB.source.id,
      enabled: true,
      mutationId: 'bind-course-b',
    });
    await retrieval.freezeTurnSourceVersions({
      trustedStudentId: studentB,
      sessionId: sessionB,
      turnId: turnB.turnId,
    });
    const resultB = await retrieval.retrieveFts({
      trustedStudentId: studentB,
      sessionId: sessionB,
      turnId: turnB.turnId,
      query: '猫 特征',
      limit: 10,
      traceId: 'trace-course-b',
    });
    expect(resultB.candidates).toHaveLength(1);

    const [snapshotA] = await getDatabase()
      .select()
      .from(schema.turnSourceVersions)
      .where(eq(schema.turnSourceVersions.turnId, turnA.turnId));
    const [chunkB] = await getDatabase()
      .select()
      .from(schema.knowledgeChunks)
      .where(eq(schema.knowledgeChunks.documentId, courseB.document.id));
    await expect(
      getDatabase()
        .insert(schema.retrievalCandidates)
        .values({
          sessionId: sessionA,
          turnId: turnA.turnId,
          turnSourceVersionId: snapshotA!.id,
          chunkId: chunkB!.id,
          documentId: snapshotA!.documentId,
          retriever: 'fixture',
          retrieverVersion: 'fixture-v1',
          rank: 1,
          score: 0.5,
          queryHash: 'f'.repeat(64),
          traceId: 'trace-forged',
        }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(
      retrieval.persistMessageCitations({
        trustedStudentId: studentA,
        sessionId: sessionA,
        turnId: turnA.turnId,
        assistantMessageId: turnA.assistantMessageId,
        candidateIds: [resultB.candidates[0]!.candidateId],
      }),
    ).rejects.toBeInstanceOf(CitationCandidateInvalidError);
    expect(await getDatabase().$count(schema.messageCitations)).toBe(0);

    const persisted = await retrieval.persistMessageCitations({
      trustedStudentId: studentA,
      sessionId: sessionA,
      turnId: turnA.turnId,
      assistantMessageId: turnA.assistantMessageId,
      candidateIds: [resultA.candidates[0]!.candidateId],
    });
    expect(persisted).toMatchObject({
      replayed: false,
      citations: [{ sourceId: courseA.source.id, availability: 'available' }],
    });
    await expect(
      retrieval.persistMessageCitations({
        trustedStudentId: studentA,
        sessionId: sessionA,
        turnId: turnA.turnId,
        assistantMessageId: turnA.assistantMessageId,
        candidateIds: [resultA.candidates[0]!.candidateId],
      }),
    ).resolves.toMatchObject({ replayed: true });
  });

  it('实际引用子集保留正文稀疏编号，重放时同时校验候选与ordinal', async () => {
    const ready = await createReadySource({
      courseSlug: 'citation-subset-course',
      sourceKey: 'citation-subset-source',
      title: '引用子集教材',
      documentLabel: 'citation-subset-v1',
      chunks: [
        { content: '引用 证据 第一段', pageStart: 1, pageEnd: 1 },
        { content: '引用 证据 第二段', pageStart: 2, pageEnd: 2 },
      ],
    });
    const studentId = anonymousSubject('7');
    const sessionId = await seedSession({
      studentId,
      courseSlug: 'citation-subset-course',
      suffix: 'citation-subset',
    });
    const turn = await seedTurn(sessionId, 'citation-subset');
    const retrieval = new DrizzleKnowledgeRetrievalRepository(getDatabase());
    await retrieval.setSessionSourceBinding({
      trustedStudentId: studentId,
      sessionId,
      sourceId: ready.source.id,
      enabled: true,
      mutationId: 'bind-citation-subset',
    });
    await retrieval.freezeTurnSourceVersions({
      trustedStudentId: studentId,
      sessionId,
      turnId: turn.turnId,
    });
    const result = await retrieval.retrieveFts({
      trustedStudentId: studentId,
      sessionId,
      turnId: turn.turnId,
      query: '引用 证据',
      limit: 10,
      traceId: 'trace-citation-subset',
    });
    expect(result.candidates).toHaveLength(2);

    const candidateId = result.candidates[1]!.candidateId;
    await expect(
      retrieval.persistMessageCitations({
        trustedStudentId: studentId,
        sessionId,
        turnId: turn.turnId,
        assistantMessageId: turn.assistantMessageId,
        candidateIds: [candidateId],
        markers: [2],
      }),
    ).resolves.toMatchObject({
      replayed: false,
      citations: [{ candidateId, ordinal: 2 }],
    });
    await expect(
      retrieval.persistMessageCitations({
        trustedStudentId: studentId,
        sessionId,
        turnId: turn.turnId,
        assistantMessageId: turn.assistantMessageId,
        candidateIds: [candidateId],
        markers: [2],
      }),
    ).resolves.toMatchObject({ replayed: true });
    await expect(
      retrieval.persistMessageCitations({
        trustedStudentId: studentId,
        sessionId,
        turnId: turn.turnId,
        assistantMessageId: turn.assistantMessageId,
        candidateIds: [candidateId],
        markers: [1],
      }),
    ).rejects.toBeInstanceOf(CitationConflictError);
  });

  it('换版后旧Turn保持冻结版本，新Turn只检索新版本，历史引用返回tombstone投影', async () => {
    const ready = await createReadySource({
      courseSlug: 'versioned-course',
      sourceKey: 'versioned-source',
      title: '版本化教材',
      documentLabel: 'version-v1',
      chunks: [{ content: '旧版 猫 特征 分类', pageStart: 4, pageEnd: 4 }],
    });
    const studentId = anonymousSubject('3');
    const sessionId = await seedSession({
      studentId,
      courseSlug: 'versioned-course',
      suffix: 'versioned',
    });
    const firstTurn = await seedTurn(sessionId, 'versioned-first');
    const retrieval = new DrizzleKnowledgeRetrievalRepository(getDatabase());
    await retrieval.setSessionSourceBinding({
      trustedStudentId: studentId,
      sessionId,
      sourceId: ready.source.id,
      enabled: true,
      mutationId: 'bind-versioned-source',
    });
    const firstSnapshot = await retrieval.freezeTurnSourceVersions({
      trustedStudentId: studentId,
      sessionId,
      turnId: firstTurn.turnId,
    });
    expect(firstSnapshot[0]).toMatchObject({ documentVersion: 1 });
    const oldCandidates = await retrieval.retrieveFts({
      trustedStudentId: studentId,
      sessionId,
      turnId: firstTurn.turnId,
      query: '旧版 猫',
      limit: 10,
      traceId: 'trace-old-version',
    });
    expect(oldCandidates.candidates).toHaveLength(1);

    const sources = new DrizzleKnowledgeSourceRepository(getDatabase());
    await sources.ingestDocument({
      sourceId: ready.source.id,
      contentHash: hashKnowledgeText('version-v2'),
      objectKey: 'courses/versioned-course/version-v2.pdf',
      parserVersion: 'pdf-text-v1',
      outcome: {
        status: 'ready',
        chunks: [{ content: '新版 机器 学习 流程', pageStart: 5, pageEnd: 5 }],
      },
    });
    const secondTurn = await seedTurn(sessionId, 'versioned-second');
    const secondSnapshot = await retrieval.freezeTurnSourceVersions({
      trustedStudentId: studentId,
      sessionId,
      turnId: secondTurn.turnId,
    });
    expect(secondSnapshot[0]).toMatchObject({ documentVersion: 2 });
    await expect(
      retrieval.retrieveFts({
        trustedStudentId: studentId,
        sessionId,
        turnId: secondTurn.turnId,
        query: '旧版 猫',
        limit: 10,
        traceId: 'trace-new-no-old',
      }),
    ).resolves.toMatchObject({ candidates: [] });
    await expect(
      retrieval.retrieveFts({
        trustedStudentId: studentId,
        sessionId,
        turnId: secondTurn.turnId,
        query: '新版 机器',
        limit: 10,
        traceId: 'trace-new-version',
      }),
    ).resolves.toMatchObject({
      candidates: [{ documentVersion: 2 }],
    });
    const citation = await retrieval.persistMessageCitations({
      trustedStudentId: studentId,
      sessionId,
      turnId: firstTurn.turnId,
      assistantMessageId: firstTurn.assistantMessageId,
      candidateIds: [oldCandidates.candidates[0]!.candidateId],
    });
    expect(citation.citations[0]).toMatchObject({
      availability: 'superseded',
      text: null,
    });
    await sources.tombstoneSource(ready.source.id);
    await expect(
      retrieval.listOwnedMessageCitations({
        trustedStudentId: studentId,
        sessionId,
        turnId: firstTurn.turnId,
        assistantMessageId: firstTurn.assistantMessageId,
      }),
    ).resolves.toMatchObject([{ availability: 'tombstoned', text: null }]);
    const thirdTurn = await seedTurn(sessionId, 'versioned-third');
    await expect(
      retrieval.freezeTurnSourceVersions({
        trustedStudentId: studentId,
        sessionId,
        turnId: thirdTurn.turnId,
      }),
    ).resolves.toEqual([]);
  });

  it('匿名主体清理删除全部K1选择/快照/候选/引用，但保留共享审核资料', async () => {
    const ready = await createReadySource({
      courseSlug: 'cleanup-course',
      sourceKey: 'cleanup-source',
      title: '共享课程资料',
      documentLabel: 'cleanup-v1',
      chunks: [{ content: '清理 测试 课程 资料' }],
    });
    const studentId = anonymousSubject('4');
    const oldAt = new Date(
      baseTime.getTime() - ANONYMOUS_SUBJECT_RETENTION_MS - 1,
    );
    const sessionId = await seedSession({
      studentId,
      courseSlug: 'cleanup-course',
      suffix: 'cleanup',
      lastActivityAt: oldAt,
    });
    const turn = await seedTurn(sessionId, 'cleanup');
    const retrieval = new DrizzleKnowledgeRetrievalRepository(getDatabase());
    await retrieval.setSessionSourceBinding({
      trustedStudentId: studentId,
      sessionId,
      sourceId: ready.source.id,
      enabled: true,
      mutationId: 'bind-cleanup-source',
      now: oldAt,
    });
    await retrieval.freezeTurnSourceVersions({
      trustedStudentId: studentId,
      sessionId,
      turnId: turn.turnId,
      now: oldAt,
    });
    const candidates = await retrieval.retrieveFts({
      trustedStudentId: studentId,
      sessionId,
      turnId: turn.turnId,
      query: '清理 测试',
      limit: 10,
      traceId: 'trace-cleanup',
      now: oldAt,
    });
    await retrieval.persistMessageCitations({
      trustedStudentId: studentId,
      sessionId,
      turnId: turn.turnId,
      assistantMessageId: turn.assistantMessageId,
      candidateIds: [candidates.candidates[0]!.candidateId],
      now: oldAt,
    });

    await expect(
      new DrizzleAnonymousDataLifecycleService(
        getDatabase(),
      ).purgeExpiredSubjects({ now: baseTime }),
    ).resolves.toMatchObject({
      deletedSubjects: 1,
      deletedRows: {
        message_citations: 1,
        retrieval_candidates: 1,
        turn_source_versions: 1,
        turn_source_snapshots: 1,
        session_source_bindings: 1,
      },
    });
    expect(await getDatabase().$count(schema.messageCitations)).toBe(0);
    expect(await getDatabase().$count(schema.retrievalCandidates)).toBe(0);
    expect(await getDatabase().$count(schema.turnSourceVersions)).toBe(0);
    expect(await getDatabase().$count(schema.turnSourceSnapshots)).toBe(0);
    expect(await getDatabase().$count(schema.sessionSourceBindings)).toBe(0);
    expect(await getDatabase().$count(schema.knowledgeSources)).toBe(1);
    expect(await getDatabase().$count(schema.knowledgeDocuments)).toBe(1);
    expect(await getDatabase().$count(schema.knowledgeChunks)).toBe(1);
  });
});
