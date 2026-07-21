import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentModelRunConflictError,
  AgentModelRunLifecycleError,
  AgentModelRunOwnershipError,
  DrizzleAgentModelRunRepository,
} from './agent-model-run-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('集成测试拒绝使用非隔离数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 4 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

interface AgentTurnFixture {
  actorId: string;
  otherActorId: string;
  operationId: string;
  assistantMessageId: string;
}

async function createAgentTurnFixture(): Promise<AgentTurnFixture> {
  const actorId = 'user:model-run-owner';
  const otherActorId = 'user:model-run-other';
  await getDatabase()
    .insert(schema.platformUsers)
    .values([
      { id: actorId, kind: 'registered' },
      { id: otherActorId, kind: 'registered' },
    ]);
  const [agent] = await getDatabase()
    .insert(schema.personalAgents)
    .values({ userId: actorId })
    .returning();
  if (!agent) throw new Error('测试Agent创建失败');
  const conversation = await new DrizzlePlatformConversationRepository(
    getDatabase(),
  ).create({
    ownerSubjectId: actorId,
    spaceKind: 'notebook',
    spaceTitle: '模型账本测试',
  });
  const operationId = randomUUID();
  const assistantMessageId = randomUUID();
  const now = new Date('2026-07-21T09:00:00.000Z');
  await getDatabase()
    .insert(schema.agentOperations)
    .values({
      id: operationId,
      gatewayEnvelopeId: `envelope:${operationId}`,
      requestFingerprint: 'a'.repeat(64),
      actorUserId: actorId,
      agentId: agent.id,
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
      kind: 'turn',
      idempotencyKey: `idempotency:${operationId}`,
      traceId: `trace:${operationId}`,
      status: 'running',
      createdAt: now,
    });
  await getDatabase()
    .insert(schema.conversationMessages)
    .values([
      {
        id: randomUUID(),
        conversationId: conversation.id,
        operationId,
        role: 'user',
        status: 'completed',
        content: '请解释这个问题',
        parts: [{ type: 'text', text: '请解释这个问题' }],
        createdAt: now,
        completedAt: now,
      },
      {
        id: assistantMessageId,
        conversationId: conversation.id,
        operationId,
        role: 'assistant',
        status: 'streaming',
        content: '',
        parts: [],
        createdAt: now,
      },
    ]);
  return { actorId, otherActorId, operationId, assistantMessageId };
}

describeWithDatabase('统一Agent Model Run账本', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table model_runs, conversation_messages, agent_operations,
        conversations, spaces, personal_agents, platform_users, lesson_sessions
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('以operation/phase/attempt幂等记录通用模型运行且不保存Prompt正文', async () => {
    const fixture = await createAgentTurnFixture();
    const repository = new DrizzleAgentModelRunRepository(getDatabase());
    const promptHash = 'b'.repeat(64);
    const created = await repository.createOrGet({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      assistantMessageId: fixture.assistantMessageId,
      phase: 'answer',
      modelAlias: 'primary',
      promptVersion: 'agent-general-v2',
      promptHash,
      provider: 'openai-compatible',
      now: new Date('2026-07-21T09:00:01.000Z'),
    });
    expect(created).toMatchObject({
      replayed: false,
      run: {
        operationId: fixture.operationId,
        assistantMessageId: fixture.assistantMessageId,
        taskAlias: 'agent.turn',
        traceId: `trace:${fixture.operationId}`,
        status: 'pending',
      },
    });
    const replayed = await repository.createOrGet({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      assistantMessageId: fixture.assistantMessageId,
      phase: 'answer',
      modelAlias: 'primary',
      promptVersion: 'agent-general-v2',
      promptHash,
      provider: 'openai-compatible',
    });
    expect(replayed).toMatchObject({
      replayed: true,
      run: { id: created.run.id },
    });
    await expect(
      repository.createOrGet({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        assistantMessageId: fixture.assistantMessageId,
        phase: 'answer',
        modelAlias: 'primary',
        promptVersion: 'agent-general-v2',
        promptHash: 'c'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(AgentModelRunConflictError);

    const [stored] = await getDatabase()
      .select()
      .from(schema.modelRuns)
      .where(eq(schema.modelRuns.id, created.run.id));
    expect(stored).toMatchObject({
      sessionId: null,
      operationKind: 'agent_turn',
      agentOperationId: fixture.operationId,
      assistantMessageId: null,
      conversationMessageId: fixture.assistantMessageId,
      promptHash,
    });
    expect(JSON.stringify(stored)).not.toContain('请解释这个问题');
    expect(await getDatabase().select().from(schema.lessonSessions)).toEqual(
      [],
    );
  });

  it('每次生命周期操作重新验证Actor并保持唯一终态', async () => {
    const fixture = await createAgentTurnFixture();
    const repository = new DrizzleAgentModelRunRepository(getDatabase());
    const created = await repository.createOrGet({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      assistantMessageId: fixture.assistantMessageId,
      phase: 'answer',
      modelAlias: 'primary',
      promptVersion: 'agent-general-v2',
      promptHash: 'd'.repeat(64),
    });
    await expect(
      repository.markRunning({
        operationId: fixture.operationId,
        actorId: fixture.otherActorId,
        runId: created.run.id,
      }),
    ).rejects.toBeInstanceOf(AgentModelRunOwnershipError);

    const running = await repository.markRunning({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      runId: created.run.id,
      now: new Date('2026-07-21T09:00:02.000Z'),
    });
    expect(running).toMatchObject({
      transitioned: true,
      run: { status: 'running' },
    });
    const settled = await repository.settle({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      runId: created.run.id,
      status: 'succeeded',
      providerResult: {
        provider: 'openai-compatible',
        providerModelId: 'deepseek-chat',
        finishReason: 'stop',
        latencyMs: 120,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheHitTokens: 0,
          reasoningTokens: 0,
        },
      },
      now: new Date('2026-07-21T09:00:03.000Z'),
    });
    expect(settled).toMatchObject({
      transitioned: true,
      run: { status: 'succeeded', inputTokens: 10, outputTokens: 20 },
    });
    const repeated = await repository.settle({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      runId: created.run.id,
      status: 'succeeded',
    });
    expect(repeated).toMatchObject({
      transitioned: false,
      run: { status: 'succeeded' },
    });
    expect(
      await repository.listByOperation({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
      }),
    ).toMatchObject([{ id: created.run.id, status: 'succeeded' }]);
    await expect(
      repository.listByOperation({
        operationId: fixture.operationId,
        actorId: fixture.otherActorId,
      }),
    ).rejects.toBeInstanceOf(AgentModelRunOwnershipError);
  });

  it('没有服务端取消记录时拒绝把Provider abort写成cancelled', async () => {
    const fixture = await createAgentTurnFixture();
    const repository = new DrizzleAgentModelRunRepository(getDatabase());
    const created = await repository.createOrGet({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      assistantMessageId: fixture.assistantMessageId,
      phase: 'answer',
      modelAlias: 'primary',
      promptVersion: 'agent-general-v2',
      promptHash: 'e'.repeat(64),
    });
    await expect(
      repository.settle({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        runId: created.run.id,
        status: 'cancelled',
        errorCode: 'aborted',
      }),
    ).rejects.toBeInstanceOf(AgentModelRunLifecycleError);

    await getDatabase()
      .update(schema.agentOperations)
      .set({ cancelRequestedAt: new Date('2026-07-21T09:00:04.000Z') })
      .where(eq(schema.agentOperations.id, fixture.operationId));
    const cancelled = await repository.settle({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      runId: created.run.id,
      status: 'cancelled',
      errorCode: 'aborted',
      now: new Date('2026-07-21T09:00:05.000Z'),
    });
    expect(cancelled).toMatchObject({
      transitioned: true,
      run: { status: 'cancelled', errorCode: 'aborted' },
    });
  });
});
