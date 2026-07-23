import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ChatLifecycleError,
  ChatMessageIdConflictError,
  DrizzleChatRepository,
  LearningSessionOwnershipError,
  TurnInProgressError,
} from './chat-repository';
import { DrizzleLearningSessionRepository } from './learning-session-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import { MessagePartValidationError } from './message-parts';
import { DrizzleModelRunRepository } from './model-run-repository';
import * as schema from './schema';
import {
  DrizzleTeachingTurnLedger,
  TurnRateLimitError,
  type TeachingTurnLedgerSnapshot,
} from './turn-ledger-repository';
import {
  DrizzleToolCallRepository,
  ToolCallConflictError,
} from './tool-call-repository';
import { DrizzleTurnLeaseRepository } from './turn-lease-repository';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('集成测试拒绝清空非测试数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 12 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

const sessionId = '80000000-0000-4000-8000-000000000001';
const studentId = 'agent-ledger-student';
const scope = {
  studentId,
  gradeBand: 'middle_school',
  courseSlug: 'cat-dog-ai',
  knowledgeNodeId: 'cat-dog-classification',
};
const baseTime = new Date('2026-07-15T03:00:00.000Z');

function at(offsetMs: number): Date {
  return new Date(baseTime.getTime() + offsetMs);
}

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

async function seedSession(): Promise<void> {
  await getDatabase()
    .insert(schema.lessonSessions)
    .values({
      id: sessionId,
      ...scope,
      state: 'EXPLAIN',
      status: 'active',
      createdAt: baseTime,
      updatedAt: baseTime,
      lastActivityAt: baseTime,
    });
}

function beginInput(clientMessageId = 'agent-client-1', now = baseTime) {
  return {
    sessionId,
    trustedStudentId: studentId,
    clientMessageId,
    text: '猫和狗的特征如何帮助图像分类？',
    traceId: `trace-${clientMessageId}`,
    modelAlias: 'primary',
    promptVersion: 'teaching-turn-v1',
    promptHash: 'a'.repeat(64),
    provider: 'fixture',
    contextSnapshot: {
      builderVersion: 'conversation-context-v1',
      includedMessageIds: [],
      selectedAssetVersionIds: [],
      omittedMessageCount: 0,
      characterCount: 0,
    },
    leaseDurationMs: 5_000,
    now,
  };
}

async function completeDirectTurn(
  ledger: TeachingTurnLedgerSnapshot,
  startOffsetMs: number,
): Promise<void> {
  const modelRuns = new DrizzleModelRunRepository(getDatabase());
  const chat = new DrizzleChatRepository(getDatabase());
  const leaseId = ledger.leaseId!;
  await modelRuns.markRunning({
    sessionId,
    trustedStudentId: studentId,
    runId: ledger.answerRun.id,
    now: at(startOffsetMs),
  });
  await chat.markAssistantStreaming({
    sessionId,
    trustedStudentId: studentId,
    assistantMessageId: ledger.turn.assistantMessage.id,
    leaseId,
    now: at(startOffsetMs),
  });
  await chat.appendAssistantDelta({
    sessionId,
    trustedStudentId: studentId,
    assistantMessageId: ledger.turn.assistantMessage.id,
    leaseId,
    delta: '这是基于特征的真实回答。',
    now: at(startOffsetMs + 10),
  });
  await modelRuns.settle({
    sessionId,
    trustedStudentId: studentId,
    runId: ledger.answerRun.id,
    status: 'succeeded',
    providerResult: { finishReason: 'stop' },
    now: at(startOffsetMs + 20),
  });
  await chat.settleAssistantMessage({
    sessionId,
    trustedStudentId: studentId,
    assistantMessageId: ledger.turn.assistantMessage.id,
    leaseId,
    status: 'completed',
    now: at(startOffsetMs + 30),
  });
}

describeWithDatabase('A2/A3/A4 持久账本', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table
        tool_calls,
        turn_context_snapshots,
        model_runs,
        chat_messages,
        agent_operations,
        canvas_artifact_grading_keys,
        canvas_artifacts,
        learning_events,
        mastery_states,
        lesson_sessions,
        conversations,
        spaces,
        personal_agents,
        platform_users
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('原子创建或重放Turn+老师消息+pending answer run', async () => {
    await seedSession();
    const ledger = new DrizzleTeachingTurnLedger(getDatabase());
    const input = beginInput();
    const results = await Promise.all([
      ledger.beginOrReplay(input),
      ledger.beginOrReplay({ ...input, text: `  ${input.text}\r\n` }),
    ]);

    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0]?.turn.turnId).toBe(results[1]?.turn.turnId);
    const contexts = await getDatabase()
      .select()
      .from(schema.turnContextSnapshots);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      turnId: results[0]?.turn.turnId,
      builderVersion: 'conversation-context-v1',
      includedMessageIds: [],
      selectedAssetVersionIds: [],
      omittedMessageCount: 0,
      characterCount: 0,
    });
    expect(results[0]?.answerRun.id).toBe(results[1]?.answerRun.id);
    expect(await getDatabase().select().from(schema.chatMessages)).toHaveLength(
      2,
    );
    expect(await getDatabase().select().from(schema.modelRuns)).toHaveLength(1);
    expect(results[0]?.turn.assistantMessage.status).toBe('pending');
    expect(results[0]?.leaseId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('Gateway教学Turn只附着K12消息并把通用审计留给Turn Application', async () => {
    await getDatabase()
      .insert(schema.platformUsers)
      .values({ id: studentId, kind: 'registered' });
    const [agent] = await getDatabase()
      .insert(schema.personalAgents)
      .values({ userId: studentId })
      .returning();
    if (!agent) throw new Error('测试Agent创建失败');
    const conversation = await new DrizzlePlatformConversationRepository(
      getDatabase(),
    ).create({
      ownerSubjectId: studentId,
      spaceKind: 'course',
      spaceTitle: '统一教学Turn测试',
    });
    const gatewaySessionId = randomUUID();
    await getDatabase()
      .insert(schema.lessonSessions)
      .values({
        id: gatewaySessionId,
        conversationId: conversation.id,
        ...scope,
        state: 'EXPLAIN',
        status: 'active',
        createdAt: baseTime,
        updatedAt: baseTime,
        lastActivityAt: baseTime,
      });
    const operationId = randomUUID();
    const traceId = `trace:${operationId}`;
    const clientMessageId = `client:${operationId}`;
    await getDatabase()
      .insert(schema.agentOperations)
      .values({
        id: operationId,
        gatewayEnvelopeId: `envelope:${operationId}`,
        requestFingerprint: 'f'.repeat(64),
        actorUserId: studentId,
        agentId: agent.id,
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
        kind: 'turn',
        idempotencyKey: clientMessageId,
        traceId,
        status: 'running',
        createdAt: baseTime,
      });
    const input = {
      sessionId: gatewaySessionId,
      trustedStudentId: studentId,
      clientMessageId,
      text: '请解释勾股定理',
      traceId,
      turnId: operationId,
      leaseDurationMs: 5_000,
      now: baseTime,
    };
    const ledger = new DrizzleTeachingTurnLedger(getDatabase());
    const first = await ledger.beginApplicationTurn(input);
    const replay = await ledger.beginApplicationTurn(input);

    expect(first).toMatchObject({
      replayed: false,
      turn: { turnId: operationId },
    });
    expect(replay).toMatchObject({
      replayed: true,
      turn: { turnId: operationId },
    });
    expect(await getDatabase().select().from(schema.chatMessages)).toHaveLength(
      2,
    );
    expect(await getDatabase().select().from(schema.modelRuns)).toHaveLength(0);
    expect(
      await getDatabase().select().from(schema.turnContextSnapshots),
    ).toHaveLength(0);
    await expect(
      ledger.beginApplicationTurn({
        ...input,
        trustedStudentId: 'forged-student',
      }),
    ).rejects.toBeInstanceOf(LearningSessionOwnershipError);
  });

  it('同一clientMessageId不能绑定不同消息内容', async () => {
    await seedSession();
    const ledger = new DrizzleTeachingTurnLedger(getDatabase());
    const input = beginInput('conflicting-client-message');
    await ledger.beginOrReplay(input);

    await expect(
      ledger.beginOrReplay({ ...input, text: '不同正文' }),
    ).rejects.toBeInstanceOf(ChatMessageIdConflictError);
    expect(await getDatabase().select().from(schema.chatMessages)).toHaveLength(
      2,
    );
  });

  it('在Ledger边界拒绝不安全clientMessageId和过长正文', async () => {
    await seedSession();
    const ledger = new DrizzleTeachingTurnLedger(getDatabase());

    await expect(
      ledger.beginOrReplay(beginInput('bad id')),
    ).rejects.toBeInstanceOf(ChatLifecycleError);
    await expect(
      ledger.beginOrReplay(beginInput('x'.repeat(129))),
    ).rejects.toBeInstanceOf(ChatLifecycleError);
    await expect(
      ledger.beginOrReplay({
        ...beginInput('valid-id'),
        text: 'x'.repeat(4_001),
      }),
    ).rejects.toBeInstanceOf(MessagePartValidationError);
    expect(await getDatabase().select().from(schema.chatMessages)).toHaveLength(
      0,
    );
  });

  it('同一active session的不同clientMessageId并发时稳定拒绝第二个Turn', async () => {
    await seedSession();
    const ledger = new DrizzleTeachingTurnLedger(getDatabase());
    const outcomes = await Promise.allSettled([
      ledger.beginOrReplay(beginInput('parallel-a')),
      ledger.beginOrReplay(beginInput('parallel-b')),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(TurnInProgressError),
    });
    expect(await getDatabase().select().from(schema.chatMessages)).toHaveLength(
      2,
    );
    expect(await getDatabase().select().from(schema.modelRuns)).toHaveLength(1);
  });

  it('在PostgreSQL窗口内限流，但幂等重放优先于限流', async () => {
    await seedSession();
    const ledger = new DrizzleTeachingTurnLedger(getDatabase());
    const rateLimit = { maxTurns: 2, windowMs: 60_000 };
    const firstInput = { ...beginInput('rate-1', at(0)), rateLimit };
    const first = await ledger.beginOrReplay(firstInput);
    await completeDirectTurn(first, 100);
    const second = await ledger.beginOrReplay({
      ...beginInput('rate-2', at(10_000)),
      rateLimit,
    });
    await completeDirectTurn(second, 10_100);

    await expect(
      ledger.beginOrReplay({ ...firstInput, now: at(20_000) }),
    ).resolves.toMatchObject({
      replayed: true,
      turn: { turnId: first.turn.turnId },
    });
    await expect(
      ledger.beginOrReplay({
        ...beginInput('rate-3', at(20_000)),
        rateLimit,
      }),
    ).rejects.toMatchObject({
      code: 'turn_rate_limited',
      retryAfterMs: 40_000,
    } satisfies Partial<TurnRateLimitError>);
    await expect(
      ledger.beginOrReplay({
        ...beginInput('rate-3', at(60_001)),
        rateLimit,
      }),
    ).resolves.toMatchObject({ replayed: false });
  });

  it('工具调用双唯一键防止重复执行，且只保存脱敏摘要', async () => {
    await seedSession();
    const turn = await new DrizzleTeachingTurnLedger(
      getDatabase(),
    ).beginOrReplay(beginInput());
    const tools = new DrizzleToolCallRepository(getDatabase());
    const createInput = {
      trustedStudentId: studentId,
      answerModelRunId: turn.answerRun.id,
      providerToolCallId: 'call_get_state_1',
      executionId: 'execution-get-state-1',
      toolName: 'getStudentState',
      teachingState: 'EXPLAIN' as const,
      exposure: 'model' as const,
      effect: 'read' as const,
      arguments: {
        studentSecret: '绝不能入库',
        nested: { token: 'private-token' },
      },
      now: at(100),
    };
    const created = await Promise.all([
      tools.createOrGet(createInput),
      tools.createOrGet(createInput),
    ]);
    expect(created.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    const [stored] = await getDatabase().select().from(schema.toolCalls);
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored?.argumentSummary)).not.toContain('绝不能入库');
    expect(JSON.stringify(stored?.argumentSummary)).not.toContain(
      'private-token',
    );

    await expect(
      tools.createOrGet({
        ...createInput,
        providerToolCallId: 'call_other',
      }),
    ).rejects.toBeInstanceOf(ToolCallConflictError);
    await expect(
      tools.createOrGet({
        ...createInput,
        executionId: 'execution-other',
      }),
    ).rejects.toBeInstanceOf(ToolCallConflictError);

    const toolCallId = created[0]!.call.id;
    const running = await Promise.all([
      tools.markRunning({
        trustedStudentId: studentId,
        toolCallId,
        now: at(200),
      }),
      tools.markRunning({
        trustedStudentId: studentId,
        toolCallId,
        now: at(200),
      }),
    ]);
    expect(running.filter((result) => result.transitioned)).toHaveLength(1);
    const terminal = await Promise.all([
      tools.settle({
        trustedStudentId: studentId,
        toolCallId,
        status: 'succeeded',
        result: { privateResult: '也不能入库' },
        durationMs: 25,
        now: at(225),
      }),
      tools.settle({
        trustedStudentId: studentId,
        toolCallId,
        status: 'failed',
        code: 'HANDLER_ERROR',
        durationMs: 25,
        now: at(225),
      }),
    ]);
    expect(terminal.filter((result) => result.transitioned)).toHaveLength(1);
    expect(new Set(terminal.map((result) => result.call.status))).toHaveLength(
      1,
    );
    expect(JSON.stringify(terminal[0]?.call.resultSummary)).not.toContain(
      '也不能入库',
    );
    await expect(
      tools.createOrGet({ ...createInput, trustedStudentId: 'forged-student' }),
    ).rejects.toBeInstanceOf(LearningSessionOwnershipError);
  });

  it('显式取消只按trusted student+turnId定位，双击Stop幂等', async () => {
    await seedSession();
    const turn = await new DrizzleTeachingTurnLedger(
      getDatabase(),
    ).beginOrReplay(beginInput());
    const chat = new DrizzleChatRepository(getDatabase());

    await expect(
      chat.getOwnedTurnByTurnId({
        trustedStudentId: studentId,
        turnId: turn.turn.turnId,
      }),
    ).resolves.toMatchObject({ turnId: turn.turn.turnId });
    await expect(
      chat.getOwnedTurnByTurnId({
        trustedStudentId: 'forged-student',
        turnId: turn.turn.turnId,
      }),
    ).resolves.toBeNull();
    const first = await chat.requestTurnCancellation({
      trustedStudentId: studentId,
      turnId: turn.turn.turnId,
      now: at(100),
    });
    const second = await chat.requestTurnCancellation({
      trustedStudentId: studentId,
      turnId: turn.turn.turnId,
      now: at(200),
    });
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(second.turn?.assistantMessage.cancelRequestedAt).toBe(
      at(100).toISOString(),
    );
    await expect(
      chat.isTurnCancellationRequested({
        trustedStudentId: studentId,
        turnId: turn.turn.turnId,
      }),
    ).resolves.toBe(true);
  });

  it('cancel-vs-complete竞争仅一个消息终态胜出', async () => {
    await seedSession();
    const ledger = await new DrizzleTeachingTurnLedger(
      getDatabase(),
    ).beginOrReplay(beginInput());
    const chat = new DrizzleChatRepository(getDatabase());
    const runs = new DrizzleModelRunRepository(getDatabase());
    await runs.markRunning({
      sessionId,
      trustedStudentId: studentId,
      runId: ledger.answerRun.id,
      now: at(100),
    });
    await chat.markAssistantStreaming({
      sessionId,
      trustedStudentId: studentId,
      assistantMessageId: ledger.turn.assistantMessage.id,
      leaseId: ledger.leaseId!,
      now: at(100),
    });
    await chat.appendAssistantDelta({
      sessionId,
      trustedStudentId: studentId,
      assistantMessageId: ledger.turn.assistantMessage.id,
      leaseId: ledger.leaseId!,
      delta: '迟到但完整的回答',
      now: at(110),
    });
    await runs.settle({
      sessionId,
      trustedStudentId: studentId,
      runId: ledger.answerRun.id,
      status: 'succeeded',
      providerResult: { finishReason: 'stop' },
      now: at(120),
    });
    await chat.requestTurnCancellation({
      trustedStudentId: studentId,
      turnId: ledger.turn.turnId,
      now: at(130),
    });
    const outcomes = await Promise.all([
      chat.settleAssistantMessage({
        sessionId,
        trustedStudentId: studentId,
        assistantMessageId: ledger.turn.assistantMessage.id,
        leaseId: ledger.leaseId!,
        status: 'completed',
        now: at(140),
      }),
      chat.settleAssistantMessage({
        sessionId,
        trustedStudentId: studentId,
        assistantMessageId: ledger.turn.assistantMessage.id,
        status: 'cancelled',
        failureCode: 'aborted',
        now: at(140),
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.transitioned)).toHaveLength(1);
    expect(
      new Set(outcomes.map((outcome) => outcome.message.status)),
    ).toHaveLength(1);
  });

  it('heartbeat防止早收敛，过期后同步中断消息与未终态run', async () => {
    await seedSession();
    const ledger = await new DrizzleTeachingTurnLedger(
      getDatabase(),
    ).beginOrReplay(beginInput());
    const leases = new DrizzleTurnLeaseRepository(getDatabase());
    const runs = new DrizzleModelRunRepository(getDatabase());
    await runs.createOrGetTeachingRun({
      sessionId,
      trustedStudentId: studentId,
      operationId: ledger.turn.turnId,
      assistantMessageId: ledger.turn.assistantMessage.id,
      turnId: ledger.turn.turnId,
      phase: 'synthesis',
      traceId: 'trace-synthesis',
      taskAlias: 'teaching.turn',
      modelAlias: 'primary',
      promptVersion: 'teaching-turn-v1',
      promptHash: 'b'.repeat(64),
      provider: 'fixture',
    });
    await expect(
      leases.heartbeat({
        trustedStudentId: studentId,
        turnId: ledger.turn.turnId,
        leaseId: ledger.leaseId!,
        leaseDurationMs: 5_000,
        now: at(1_000),
      }),
    ).resolves.toBe(true);
    await expect(leases.convergeExpired({ now: at(5_500) })).resolves.toEqual(
      [],
    );
    await expect(
      leases.convergeExpired({ now: at(6_001) }),
    ).resolves.toMatchObject([{ interruptedModelRuns: 2 }]);
    expect(await getDatabase().select().from(schema.chatMessages)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', status: 'interrupted' }),
      ]),
    );
    expect(await getDatabase().select().from(schema.modelRuns)).toMatchObject([
      { status: 'interrupted' },
      { status: 'interrupted' },
    ]);
    const recent = await new DrizzleLearningSessionRepository(
      getDatabase(),
    ).listOwnedRecent({
      studentId,
      gradeBand: scope.gradeBand,
      courseSlug: scope.courseSlug,
    });
    expect(recent.sessions[0]?.hasInterruptedTurn).toBe(true);
  });

  it('lease-vs-complete竞争遵守first-terminal-write-wins', async () => {
    await seedSession();
    const ledger = await new DrizzleTeachingTurnLedger(
      getDatabase(),
    ).beginOrReplay(beginInput());
    const chat = new DrizzleChatRepository(getDatabase());
    const runs = new DrizzleModelRunRepository(getDatabase());
    const leases = new DrizzleTurnLeaseRepository(getDatabase());
    await runs.markRunning({
      sessionId,
      trustedStudentId: studentId,
      runId: ledger.answerRun.id,
      now: at(100),
    });
    await chat.markAssistantStreaming({
      sessionId,
      trustedStudentId: studentId,
      assistantMessageId: ledger.turn.assistantMessage.id,
      leaseId: ledger.leaseId!,
      now: at(100),
    });
    await chat.appendAssistantDelta({
      sessionId,
      trustedStudentId: studentId,
      assistantMessageId: ledger.turn.assistantMessage.id,
      leaseId: ledger.leaseId!,
      delta: '临界完成回答',
      now: at(110),
    });
    await runs.settle({
      sessionId,
      trustedStudentId: studentId,
      runId: ledger.answerRun.id,
      status: 'succeeded',
      providerResult: { finishReason: 'stop' },
      now: at(4_900),
    });

    const [completion, convergence] = await Promise.all([
      chat.settleAssistantMessage({
        sessionId,
        trustedStudentId: studentId,
        assistantMessageId: ledger.turn.assistantMessage.id,
        leaseId: ledger.leaseId!,
        status: 'completed',
        now: at(5_001),
      }),
      leases.convergeExpired({ now: at(5_001) }),
    ]);
    expect(
      Number(completion.transitioned) + Number(convergence.length === 1),
    ).toBe(1);
    const [assistant] = await getDatabase()
      .select()
      .from(schema.chatMessages)
      .where(
        sql`${schema.chatMessages.id} = ${ledger.turn.assistantMessage.id}`,
      );
    expect(['completed', 'interrupted']).toContain(assistant?.status);
    expect(assistant?.leaseId).toBeNull();
  });
});
