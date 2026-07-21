import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleAgentModelRunRepository } from './agent-model-run-repository';
import {
  AgentToolCallConflictError,
  AgentToolCallLifecycleError,
  AgentToolCallOwnershipError,
  DrizzleAgentToolCallRepository,
} from './agent-tool-call-repository';
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

interface AgentToolFixture {
  actorId: string;
  otherActorId: string;
  operationId: string;
  answerModelRunId: string;
}

async function createAgentToolFixture(): Promise<AgentToolFixture> {
  const actorId = 'user:tool-call-owner';
  const otherActorId = 'user:tool-call-other';
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
    spaceTitle: 'Tool Call账本测试',
  });
  const operationId = randomUUID();
  const assistantMessageId = randomUUID();
  const now = new Date('2026-07-21T11:00:00.000Z');
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
  await getDatabase().insert(schema.conversationMessages).values({
    id: assistantMessageId,
    conversationId: conversation.id,
    operationId,
    role: 'assistant',
    status: 'streaming',
    content: '',
    parts: [],
    createdAt: now,
  });
  const modelRun = await new DrizzleAgentModelRunRepository(
    getDatabase(),
  ).createOrGet({
    operationId,
    actorId,
    assistantMessageId,
    phase: 'answer',
    taskAlias: 'agent.turn',
    modelAlias: 'primary',
    promptVersion: 'agent-general-v2',
    promptHash: 'b'.repeat(64),
    now,
  });
  return {
    actorId,
    otherActorId,
    operationId,
    answerModelRunId: modelRun.run.id,
  };
}

describeWithDatabase('统一Agent Tool Call账本', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table tool_calls, model_runs, conversation_messages,
        agent_operations, conversations, spaces, personal_agents,
        platform_users, lesson_sessions
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('以双唯一键幂等记录调用且不保存参数或结果正文', async () => {
    const fixture = await createAgentToolFixture();
    const repository = new DrizzleAgentToolCallRepository(getDatabase());
    const input = {
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      answerModelRunId: fixture.answerModelRunId,
      providerToolCallId: 'call_web_search_1',
      executionId: 'execution-web-search-1',
      toolName: 'webSearch',
      exposure: 'model' as const,
      effect: 'read' as const,
      arguments: {
        query: '不能入库的查询正文',
        credential: 'private-token',
      },
      now: new Date('2026-07-21T11:00:01.000Z'),
    };
    const calls = await Promise.all([
      repository.createOrGet(input),
      repository.createOrGet(input),
    ]);
    expect(calls.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    const call = calls[0]!.call;
    const running = await repository.markRunning({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      toolCallId: call.id,
      now: new Date('2026-07-21T11:00:02.000Z'),
    });
    expect(running).toMatchObject({
      transitioned: true,
      call: { status: 'running' },
    });
    const settled = await repository.settle({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      toolCallId: call.id,
      status: 'succeeded',
      durationMs: 12,
      result: { content: '不能入库的工具结果', token: 'result-secret' },
      now: new Date('2026-07-21T11:00:03.000Z'),
    });
    expect(settled).toMatchObject({
      transitioned: true,
      call: { status: 'succeeded', durationMs: 12 },
    });
    expect(
      await repository.listByOperation({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
      }),
    ).toHaveLength(1);

    const [stored] = await getDatabase().select().from(schema.toolCalls);
    expect(stored).toMatchObject({
      sessionId: null,
      turnId: null,
      teachingState: null,
      agentOperationId: fixture.operationId,
    });
    expect(JSON.stringify(stored)).not.toContain('不能入库');
    expect(JSON.stringify(stored)).not.toContain('private-token');
    expect(JSON.stringify(stored)).not.toContain('result-secret');
  });

  it('双唯一键冲突与跨Actor生命周期操作都fail closed', async () => {
    const fixture = await createAgentToolFixture();
    const repository = new DrizzleAgentToolCallRepository(getDatabase());
    const input = {
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      answerModelRunId: fixture.answerModelRunId,
      providerToolCallId: 'call_echo_1',
      executionId: 'execution-echo-1',
      toolName: 'echoText',
      exposure: 'model' as const,
      effect: 'read' as const,
      arguments: { text: 'hello' },
    };
    const created = await repository.createOrGet(input);
    await expect(
      repository.createOrGet({
        ...input,
        providerToolCallId: 'call_echo_other',
      }),
    ).rejects.toBeInstanceOf(AgentToolCallConflictError);
    await expect(
      repository.createOrGet({ ...input, executionId: 'execution-echo-other' }),
    ).rejects.toBeInstanceOf(AgentToolCallConflictError);
    await expect(
      repository.markRunning({
        operationId: fixture.operationId,
        actorId: fixture.otherActorId,
        toolCallId: created.call.id,
      }),
    ).rejects.toBeInstanceOf(AgentToolCallOwnershipError);
    await expect(
      repository.listByOperation({
        operationId: fixture.operationId,
        actorId: fixture.otherActorId,
      }),
    ).rejects.toBeInstanceOf(AgentToolCallOwnershipError);
  });

  it('只有write调用可进入outcome_unknown且终态Operation不能补写', async () => {
    const fixture = await createAgentToolFixture();
    const repository = new DrizzleAgentToolCallRepository(getDatabase());
    const base = {
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      answerModelRunId: fixture.answerModelRunId,
      toolName: 'persistNote',
      exposure: 'model' as const,
      arguments: { note: 'private' },
    };
    const read = await repository.createOrGet({
      ...base,
      providerToolCallId: 'call_read_1',
      executionId: 'execution-read-1',
      effect: 'read',
    });
    await repository.markRunning({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      toolCallId: read.call.id,
    });
    await expect(
      repository.settle({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        toolCallId: read.call.id,
        status: 'outcome_unknown',
        code: 'write_outcome_unknown',
        durationMs: 10,
      }),
    ).rejects.toBeInstanceOf(AgentToolCallLifecycleError);

    const write = await repository.createOrGet({
      ...base,
      providerToolCallId: 'call_write_1',
      executionId: 'execution-write-1',
      effect: 'write',
    });
    await repository.markRunning({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      toolCallId: write.call.id,
    });
    await expect(
      repository.settle({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        toolCallId: write.call.id,
        status: 'outcome_unknown',
        code: 'write_outcome_unknown',
        durationMs: 10,
      }),
    ).resolves.toMatchObject({
      transitioned: true,
      call: { status: 'outcome_unknown' },
    });

    await getDatabase()
      .update(schema.agentOperations)
      .set({
        status: 'completed',
        completedAt: new Date('2026-07-21T11:01:00.000Z'),
      })
      .where(eq(schema.agentOperations.id, fixture.operationId));
    await expect(
      repository.createOrGet({
        ...base,
        providerToolCallId: 'call_late_1',
        executionId: 'execution-late-1',
        effect: 'read',
      }),
    ).rejects.toBeInstanceOf(AgentToolCallLifecycleError);
  });
});
