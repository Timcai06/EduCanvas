import { prepareArtifact } from '@educanvas/canvas-protocol/server';
import { GradeCanvasSubmissionService } from '@educanvas/teaching-runtime';
import { domainLearningEventSchema } from '@educanvas/teaching-core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleArtifactRepository } from './artifact-repository';
import {
  ANONYMOUS_LEARNING_SESSION_TTL_MS,
  ArtifactContentConflictError,
  DrizzleLearningSessionRepository,
} from './learning-session-repository';
import * as schema from './schema';
import {
  DrizzleTeachingUnitOfWork,
  OptimisticLockError,
} from './teaching-adapters';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error(
      '集成测试数据库名必须以_integration或_test结尾，拒绝清空非测试数据库',
    );
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 10 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

const sessionId = '22222222-2222-4222-8222-222222222222';
const studentId = 'student-integration';
const knowledgeNodeId = 'cat-dog-classification';
const artifactId = 'quiz-integration';

const completeArtifact = {
  schemaVersion: '1',
  artifactId,
  type: 'quiz',
  title: '机器学习小测',
  params: {
    questions: [
      {
        id: 'q1',
        question: '训练数据的作用是什么？',
        options: [
          { id: 'a', text: '提供学习样例' },
          { id: 'b', text: '保证模型永远正确' },
        ],
        correctOptionId: 'a',
      },
    ],
  },
} as const;

const clientEvent = {
  schemaVersion: '1',
  eventId: '11111111-1111-4111-8111-111111111111',
  artifactId,
  occurredAt: '2026-07-15T01:00:00.000Z',
  type: 'quiz_answer_submitted',
  payload: { questionId: 'q1', selectedOptionId: 'a' },
} as const;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

async function seedSessionAndArtifact() {
  const db = getDatabase();
  await db.insert(schema.lessonSessions).values({
    id: sessionId,
    studentId,
    gradeBand: 'middle_school',
    courseSlug: 'cat-dog-ai',
    knowledgeNodeId,
    state: 'PRACTICE',
  });
  const artifacts = new DrizzleArtifactRepository(db);
  await artifacts.save(sessionId, completeArtifact);
  return artifacts;
}

function createService(artifacts: DrizzleArtifactRepository) {
  return new GradeCanvasSubmissionService(
    artifacts,
    new DrizzleTeachingUnitOfWork(getDatabase()),
    () => new Date('2026-07-15T01:00:01.000Z'),
  );
}

describeWithDatabase('Drizzle教学链路集成', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table
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

  it('通过真实事务写入可信事件与掌握度投影', async () => {
    const artifacts = await seedSessionAndArtifact();
    const outcome = await createService(artifacts).execute({
      trustedStudentId: studentId,
      sessionId,
      clientEvent,
      prerequisiteScores: [],
    });

    expect(outcome).toMatchObject({
      ok: true,
      replayed: false,
      event: { sequence: 1, eventType: 'assessment_graded' },
      mastery: { attemptCount: 1, correctCount: 1, version: 1 },
    });
    expect(
      await getDatabase().select().from(schema.learningEvents),
    ).toHaveLength(1);
    expect(
      await getDatabase().select().from(schema.masteryStates),
    ).toMatchObject([{ attemptCount: 1, correctCount: 1, version: 1 }]);
  });

  it('可信学生不匹配时拒绝写入真实事件与掌握度', async () => {
    const artifacts = await seedSessionAndArtifact();
    const outcome = await createService(artifacts).execute({
      trustedStudentId: 'student-forged',
      sessionId,
      clientEvent,
      prerequisiteScores: [],
    });

    expect(outcome).toEqual({ ok: false, code: 'SESSION_NOT_FOUND' });
    expect(
      await getDatabase().select().from(schema.learningEvents),
    ).toHaveLength(0);
    expect(
      await getDatabase().select().from(schema.masteryStates),
    ).toHaveLength(0);
    expect(
      await getDatabase().select().from(schema.lessonSessions),
    ).toMatchObject([{ eventSequence: 0 }]);
  });

  it('事务失败时同时回滚事件与会话序号', async () => {
    await seedSessionAndArtifact();
    const unitOfWork = new DrizzleTeachingUnitOfWork(getDatabase());

    await expect(
      unitOfWork.run(async (transaction) => {
        const sequence = await transaction.events.allocateSequence(sessionId);
        await transaction.events.append(
          domainLearningEventSchema.parse({
            schemaVersion: '1',
            eventId: '33333333-3333-4333-8333-333333333333',
            idempotencyKey: 'integration:rollback',
            studentId,
            sessionId,
            knowledgeNodeId,
            sequence,
            eventType: 'assessment_graded',
            payload: {
              artifactId,
              assessmentType: 'quiz',
              attemptedItems: 1,
              correctItems: 1,
              usedHint: false,
            },
            occurredAt: '2026-07-15T01:00:00.000Z',
            recordedAt: '2026-07-15T01:00:01.000Z',
            source: 'grading_service',
            causationId: 'integration-rollback',
          }),
        );
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(
      await getDatabase().select().from(schema.learningEvents),
    ).toHaveLength(0);
    expect(
      await getDatabase().select().from(schema.lessonSessions),
    ).toMatchObject([{ eventSequence: 0 }]);
  });

  it('乐观锁只允许一个并发掌握度更新成功', async () => {
    await seedSessionAndArtifact();
    const repository = new DrizzleTeachingUnitOfWork(getDatabase());
    await repository.run((transaction) =>
      transaction.mastery.save({
        expectedVersion: 0,
        snapshot: {
          studentId,
          knowledgeNodeId,
          masteryScore: 0.5,
          attemptCount: 1,
          correctCount: 1,
          hintCount: 0,
          activeMisconceptions: [],
          lastPracticedAt: null,
          nextReviewAt: null,
          version: 0,
        },
      }),
    );

    const update = {
      expectedVersion: 1,
      snapshot: {
        studentId,
        knowledgeNodeId,
        masteryScore: 0.7,
        attemptCount: 2,
        correctCount: 2,
        hintCount: 0,
        activeMisconceptions: [],
        lastPracticedAt: null,
        nextReviewAt: null,
        version: 1,
      },
    } as const;
    const results = await Promise.allSettled([
      repository.run((transaction) => transaction.mastery.save(update)),
      repository.run((transaction) => transaction.mastery.save(update)),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(OptimisticLockError),
    });
  });

  it('相同提交并发重试时只计数一次并返回重放结果', async () => {
    const artifacts = await seedSessionAndArtifact();
    const service = createService(artifacts);
    const command = {
      trustedStudentId: studentId,
      sessionId,
      clientEvent,
      prerequisiteScores: [],
    };
    const results = await Promise.allSettled([
      service.execute(command),
      service.execute(command),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const outcomes = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ok: true, replayed: false }),
        expect.objectContaining({ ok: true, replayed: true }),
      ]),
    );
    expect(
      await getDatabase().select().from(schema.learningEvents),
    ).toHaveLength(1);
    expect(
      await getDatabase().select().from(schema.masteryStates),
    ).toMatchObject([{ attemptCount: 1, correctCount: 1 }]);
    expect(
      await getDatabase().select().from(schema.lessonSessions),
    ).toMatchObject([{ eventSequence: 1 }]);
  });

  it('并发bootstrap原子复用同一会话和同一Artifact', async () => {
    const repository = new DrizzleLearningSessionRepository(getDatabase());
    const input = {
      studentId,
      gradeBand: 'middle_school',
      courseSlug: 'cat-dog-ai',
      knowledgeNodeId,
      completeArtifact,
    };
    const [first, second] = await Promise.all([
      repository.bootstrap(input),
      repository.bootstrap(input),
    ]);

    expect(second.sessionId).toBe(first.sessionId);
    expect(
      await getDatabase().select().from(schema.lessonSessions),
    ).toHaveLength(1);
    expect(
      await getDatabase().select().from(schema.canvasArtifacts),
    ).toHaveLength(1);
    expect(
      await getDatabase().select().from(schema.canvasArtifactGradingKeys),
    ).toHaveLength(1);
    await expect(
      repository.getPageSnapshot(input, completeArtifact.artifactId),
    ).resolves.toMatchObject({
      sessionId: first.sessionId,
      studentId,
      artifact: { artifactId: completeArtifact.artifactId },
      mastery: null,
    });
  });

  it('服务端不复用超过匿名有效期的会话', async () => {
    const expiredSessionId = '44444444-4444-4444-8444-444444444444';
    await getDatabase()
      .insert(schema.lessonSessions)
      .values({
        id: expiredSessionId,
        studentId,
        gradeBand: 'middle_school',
        courseSlug: 'cat-dog-ai',
        knowledgeNodeId,
        state: 'PRACTICE',
        createdAt: new Date(
          Date.now() - ANONYMOUS_LEARNING_SESSION_TTL_MS - 60_000,
        ),
      });
    const repository = new DrizzleLearningSessionRepository(getDatabase());
    const input = {
      studentId,
      gradeBand: 'middle_school',
      courseSlug: 'cat-dog-ai',
      knowledgeNodeId,
      completeArtifact,
    };

    await expect(repository.getCurrentOwned(input)).resolves.toBeNull();
    const active = await repository.bootstrap(input);

    expect(active.sessionId).not.toBe(expiredSessionId);
    expect(
      await getDatabase().select().from(schema.lessonSessions),
    ).toHaveLength(2);
  });

  it('同一Artifact ID内容变化时显式拒绝bootstrap覆盖', async () => {
    const repository = new DrizzleLearningSessionRepository(getDatabase());
    const input = {
      studentId,
      gradeBand: 'middle_school',
      courseSlug: 'cat-dog-ai',
      knowledgeNodeId,
      completeArtifact,
    };
    await repository.bootstrap(input);

    await expect(
      repository.bootstrap({
        ...input,
        completeArtifact: { ...completeArtifact, title: '被篡改的标题' },
      }),
    ).rejects.toBeInstanceOf(ArtifactContentConflictError);
    expect(
      await getDatabase().select().from(schema.lessonSessions),
    ).toHaveLength(1);
  });
});
