import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ChatLifecycleError,
  DrizzleChatRepository,
  LearningSessionOwnershipError,
} from './chat-repository';
import {
  DrizzleLearningSessionRepository,
  LearningSessionNotFoundError,
} from './learning-session-repository';
import {
  DrizzleModelRunRepository,
  ModelRunLifecycleError,
} from './model-run-repository';
import * as schema from './schema';
import { DrizzleTeachingTurnLedger } from './turn-ledger-repository';

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

const studentId = 'conversation-student';
const sessionId = '50000000-0000-4000-8000-000000000001';
const knowledgeNodeId = 'cat-dog-classification';

const completeArtifact = {
  schemaVersion: '1',
  artifactId: 'conversation-quiz',
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

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

const scope = {
  studentId,
  gradeBand: 'middle_school',
  courseSlug: 'cat-dog-ai',
  knowledgeNodeId,
};

async function seedSession(
  overrides: Partial<typeof schema.lessonSessions.$inferInsert> = {},
) {
  const now = new Date('2026-07-15T02:00:00.000Z');
  await getDatabase()
    .insert(schema.lessonSessions)
    .values({
      id: sessionId,
      ...scope,
      state: 'EXPLAIN',
      status: 'active',
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
}

async function createTurn(
  clientMessageId = 'client-message-1',
  text = '猫和狗的图像特征有什么不同？',
  now = new Date('2026-07-15T02:01:00.000Z'),
) {
  const ledger = await new DrizzleTeachingTurnLedger(
    getDatabase(),
  ).beginOrReplay({
    sessionId,
    trustedStudentId: studentId,
    clientMessageId,
    text,
    traceId: `trace-${clientMessageId}`,
    modelAlias: 'primary',
    promptVersion: 'turn-v1',
    promptHash: 'a'.repeat(64),
    provider: 'fixture',
    now,
  });
  return {
    ...ledger.turn,
    replayed: ledger.replayed,
    answerRun: ledger.answerRun,
  };
}

function modelRunInput(
  turn: Awaited<ReturnType<typeof createTurn>>,
  phase: 'answer' | 'synthesis' = 'answer',
) {
  return {
    sessionId,
    trustedStudentId: studentId,
    operationId: turn.turnId,
    assistantMessageId: turn.assistantMessage.id,
    turnId: turn.turnId,
    phase,
    traceId:
      phase === 'answer'
        ? turn.answerRun.traceId
        : `trace-${turn.turnId}-${phase}`,
    taskAlias: 'teaching.turn' as const,
    modelAlias: 'primary',
    promptVersion: 'turn-v1',
    promptHash: 'a'.repeat(64),
    provider: 'fixture',
  };
}

describeWithDatabase('对话与Model Run账本', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table
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

  it('只有完成最终模型阶段且具有正文时才能完成老师消息', async () => {
    await seedSession();
    const chat = new DrizzleChatRepository(getDatabase());
    const runs = new DrizzleModelRunRepository(getDatabase());
    const turn = await createTurn();
    const answer = await runs.createOrGetTeachingRun(modelRunInput(turn));
    await runs.markRunning({
      sessionId,
      trustedStudentId: studentId,
      runId: answer.run.id,
    });
    await runs.settle({
      sessionId,
      trustedStudentId: studentId,
      runId: answer.run.id,
      status: 'succeeded',
      providerResult: { finishReason: 'tool_calls' },
    });
    await chat.markAssistantStreaming({
      sessionId,
      trustedStudentId: studentId,
      assistantMessageId: turn.assistantMessage.id,
      leaseId: turn.assistantMessage.leaseId!,
      now: new Date('2026-07-15T02:01:01.000Z'),
    });
    await chat.appendAssistantDelta({
      sessionId,
      trustedStudentId: studentId,
      assistantMessageId: turn.assistantMessage.id,
      leaseId: turn.assistantMessage.leaseId!,
      delta: '正在查询……',
      now: new Date('2026-07-15T02:01:02.000Z'),
    });

    await expect(
      chat.settleAssistantMessage({
        sessionId,
        trustedStudentId: studentId,
        assistantMessageId: turn.assistantMessage.id,
        status: 'completed',
        leaseId: turn.assistantMessage.leaseId!,
      }),
    ).rejects.toBeInstanceOf(ChatLifecycleError);

    const synthesis = await runs.createOrGetTeachingRun(
      modelRunInput(turn, 'synthesis'),
    );
    await expect(
      chat.settleAssistantMessage({
        sessionId,
        trustedStudentId: studentId,
        assistantMessageId: turn.assistantMessage.id,
        status: 'completed',
        leaseId: turn.assistantMessage.leaseId!,
      }),
    ).rejects.toBeInstanceOf(ChatLifecycleError);
    await runs.markRunning({
      sessionId,
      trustedStudentId: studentId,
      runId: synthesis.run.id,
    });
    await runs.settle({
      sessionId,
      trustedStudentId: studentId,
      runId: synthesis.run.id,
      status: 'succeeded',
      providerResult: { finishReason: 'stop' },
    });
    await expect(
      chat.settleAssistantMessage({
        sessionId,
        trustedStudentId: studentId,
        assistantMessageId: turn.assistantMessage.id,
        status: 'completed',
        leaseId: turn.assistantMessage.leaseId!,
      }),
    ).resolves.toMatchObject({
      transitioned: true,
      message: { status: 'completed' },
    });
  });

  it('终态条件更新保证first-terminal-write-wins', async () => {
    await seedSession();
    const chat = new DrizzleChatRepository(getDatabase());
    const runs = new DrizzleModelRunRepository(getDatabase());
    const turn = await createTurn();
    const answer = await runs.createOrGetTeachingRun(modelRunInput(turn));
    await runs.markRunning({
      sessionId,
      trustedStudentId: studentId,
      runId: answer.run.id,
    });
    await runs.settle({
      sessionId,
      trustedStudentId: studentId,
      runId: answer.run.id,
      status: 'succeeded',
      providerResult: { finishReason: 'stop' },
    });
    await chat.markAssistantStreaming({
      sessionId,
      trustedStudentId: studentId,
      assistantMessageId: turn.assistantMessage.id,
      leaseId: turn.assistantMessage.leaseId!,
      now: new Date('2026-07-15T02:01:01.000Z'),
    });
    await chat.appendAssistantDelta({
      sessionId,
      trustedStudentId: studentId,
      assistantMessageId: turn.assistantMessage.id,
      leaseId: turn.assistantMessage.leaseId!,
      delta: '最终回答',
      now: new Date('2026-07-15T02:01:02.000Z'),
    });

    const outcomes = await Promise.all([
      chat.settleAssistantMessage({
        sessionId,
        trustedStudentId: studentId,
        assistantMessageId: turn.assistantMessage.id,
        status: 'completed',
        leaseId: turn.assistantMessage.leaseId!,
      }),
      chat.settleAssistantMessage({
        sessionId,
        trustedStudentId: studentId,
        assistantMessageId: turn.assistantMessage.id,
        status: 'failed',
        failureCode: 'provider_unavailable',
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.transitioned)).toHaveLength(1);
    expect(
      new Set(outcomes.map((outcome) => outcome.message.status)),
    ).toHaveLength(1);
  });

  it('只把服务端显式取消后的aborted映射为cancelled', async () => {
    await seedSession();
    const chat = new DrizzleChatRepository(getDatabase());
    const runs = new DrizzleModelRunRepository(getDatabase());
    const turn = await createTurn();
    const answer = await runs.createOrGetTeachingRun(modelRunInput(turn));

    await expect(
      runs.settle({
        sessionId,
        trustedStudentId: studentId,
        runId: answer.run.id,
        status: 'cancelled',
        errorCode: 'aborted',
      }),
    ).rejects.toBeInstanceOf(ModelRunLifecycleError);
    await chat.requestAssistantCancellation({
      sessionId,
      trustedStudentId: studentId,
      assistantMessageId: turn.assistantMessage.id,
    });
    await expect(
      runs.settle({
        sessionId,
        trustedStudentId: studentId,
        runId: answer.run.id,
        status: 'cancelled',
        errorCode: 'aborted',
      }),
    ).resolves.toMatchObject({
      transitioned: true,
      run: { status: 'cancelled' },
    });
    await expect(
      chat.settleAssistantMessage({
        sessionId,
        trustedStudentId: studentId,
        assistantMessageId: turn.assistantMessage.id,
        status: 'cancelled',
        failureCode: 'aborted',
      }),
    ).resolves.toMatchObject({
      transitioned: true,
      message: { status: 'cancelled' },
    });

    const interruptedTurn = await createTurn(
      'client-message-interrupted',
      '断线问题',
      new Date('2026-07-15T02:02:00.000Z'),
    );
    const interruptedRun = await runs.createOrGetTeachingRun(
      modelRunInput(interruptedTurn),
    );
    await expect(
      runs.settle({
        sessionId,
        trustedStudentId: studentId,
        runId: interruptedRun.run.id,
        status: 'interrupted',
        errorCode: 'upstream_disconnected',
      }),
    ).resolves.toMatchObject({ run: { status: 'interrupted' } });
  });

  it('历史cursor稳定分页且拒绝跨学生和非法cursor', async () => {
    await seedSession();
    const chat = new DrizzleChatRepository(getDatabase());
    const firstTurn = await createTurn('client-history-1', '问题一');
    await chat.settleAssistantMessage({
      sessionId,
      trustedStudentId: studentId,
      assistantMessageId: firstTurn.assistantMessage.id,
      status: 'interrupted',
      failureCode: 'test_history_boundary',
      now: new Date('2026-07-15T02:01:30.000Z'),
    });
    await createTurn(
      'client-history-2',
      '问题二',
      new Date('2026-07-15T02:02:00.000Z'),
    );
    const first = await chat.listHistory({
      sessionId,
      trustedStudentId: studentId,
      limit: 3,
    });
    expect(first.messages).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await chat.listHistory({
      sessionId,
      trustedStudentId: studentId,
      after: first.nextCursor,
      limit: 3,
    });
    expect(second.messages).toHaveLength(1);
    expect(
      new Set(
        [...first.messages, ...second.messages].map((message) => message.id),
      ).size,
    ).toBe(4);
    await expect(
      chat.listHistory({ sessionId, trustedStudentId: 'forged-student' }),
    ).rejects.toBeInstanceOf(LearningSessionOwnershipError);
    await expect(
      chat.listHistory({
        sessionId,
        trustedStudentId: studentId,
        after: {
          createdAt: '2026-07-15T02:00:00.000Z',
          id: 'not-a-uuid',
        },
      }),
    ).rejects.toBeInstanceOf(ChatLifecycleError);
  });

  it('Runtime最近历史返回最新窗口并恢复时间顺序', async () => {
    await seedSession();
    const chat = new DrizzleChatRepository(getDatabase());
    const firstTurn = await createTurn(
      'client-recent-1',
      '较早问题',
      new Date('2026-07-15T02:01:00.000Z'),
    );
    await chat.settleAssistantMessage({
      sessionId,
      trustedStudentId: studentId,
      assistantMessageId: firstTurn.assistantMessage.id,
      status: 'interrupted',
      failureCode: 'fixture_interrupted',
      now: new Date('2026-07-15T02:01:30.000Z'),
    });
    await createTurn(
      'client-recent-2',
      '最新问题',
      new Date('2026-07-15T02:02:00.000Z'),
    );

    const recent = await chat.listRecentHistory({
      sessionId,
      trustedStudentId: studentId,
      limit: 2,
    });

    expect(recent).toHaveLength(2);
    expect(new Set(recent.map((message) => message.content))).toEqual(
      new Set(['', '最新问题']),
    );
    expect(
      recent.map((message) => new Date(message.createdAt).getTime()),
    ).toEqual(
      [...recent]
        .map((message) => new Date(message.createdAt).getTime())
        .sort((left, right) => left - right),
    );
    await expect(
      chat.listRecentHistory({
        sessionId,
        trustedStudentId: 'forged-student',
      }),
    ).rejects.toBeInstanceOf(LearningSessionOwnershipError);
  });

  it('新建、归档、恢复和课程级最近列表保持单active及所有权', async () => {
    const sessions = new DrizzleLearningSessionRepository(getDatabase());
    const first = await sessions.bootstrap({ ...scope, completeArtifact });
    const firstBeforeResume = await getDatabase()
      .select()
      .from(schema.lessonSessions)
      .then((rows) => rows[0]!.lastActivityAt.toISOString());
    const second = await sessions.startNew({ ...scope, completeArtifact });
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(
      await getDatabase().select().from(schema.lessonSessions),
    ).toMatchObject([
      { id: first.sessionId, status: 'archived' },
      { id: second.sessionId, status: 'active' },
    ]);

    await sessions.resume(scope, first.sessionId);
    const rowsAfterResume = await getDatabase()
      .select()
      .from(schema.lessonSessions);
    expect(rowsAfterResume).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.sessionId, status: 'active' }),
        expect.objectContaining({ id: second.sessionId, status: 'archived' }),
      ]),
    );
    expect(
      rowsAfterResume
        .find((row) => row.id === first.sessionId)
        ?.lastActivityAt.toISOString(),
    ).toBe(firstBeforeResume);

    await getDatabase().insert(schema.lessonSessions).values({
      studentId,
      gradeBand: scope.gradeBand,
      courseSlug: scope.courseSlug,
      knowledgeNodeId: 'another-node',
      state: 'EXPLAIN',
      status: 'active',
    });
    const recent = await sessions.listOwnedRecent(
      {
        studentId,
        gradeBand: scope.gradeBand,
        courseSlug: scope.courseSlug,
      },
      { limit: 10 },
    );
    expect(
      new Set(recent.sessions.map((session) => session.knowledgeNodeId)),
    ).toEqual(new Set([knowledgeNodeId, 'another-node']));

    await expect(
      sessions.resume(
        { ...scope, studentId: 'forged-student' },
        second.sessionId,
      ),
    ).rejects.toBeInstanceOf(LearningSessionNotFoundError);
    await expect(
      sessions.listOwnedRecent(
        {
          studentId,
          gradeBand: scope.gradeBand,
          courseSlug: scope.courseSlug,
        },
        {
          before: {
            lastActivityAt: '2026-07-15T02:00:00.000Z',
            id: 'not-a-uuid',
          },
        },
      ),
    ).rejects.toThrow('会话列表 cursor ID 无效');
  });

  it('部分唯一索引对NULL knowledgeNodeId也只允许一个active', async () => {
    const values = (id: string) => ({
      id,
      studentId: 'null-node-student',
      gradeBand: 'middle_school',
      courseSlug: 'null-node-course',
      knowledgeNodeId: null,
      state: 'EXPLAIN',
      status: 'active',
    });
    const outcomes = await Promise.allSettled([
      getDatabase()
        .insert(schema.lessonSessions)
        .values(values('60000000-0000-4000-8000-000000000001')),
      getDatabase()
        .insert(schema.lessonSessions)
        .values(values('60000000-0000-4000-8000-000000000002')),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await getDatabase().select().from(schema.lessonSessions),
    ).toHaveLength(1);
  });
});
