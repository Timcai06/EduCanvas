import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleAgentModelRunRepository } from './agent-model-run-repository';
import { DrizzleAgentToolCallRepository } from './agent-tool-call-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import * as schema from './schema';
import {
  DrizzleToolEffectRepository,
  ToolEffectConflictError,
  ToolEffectOwnershipError,
} from './tool-effect-repository';

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

async function createFixture() {
  const actorId = 'user:effect-owner';
  const otherActorId = 'user:effect-other';
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
    spaceTitle: 'Effect账本测试',
  });
  const operationId = randomUUID();
  const assistantMessageId = randomUUID();
  const now = new Date('2026-07-21T12:00:00.000Z');
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
  const run = await new DrizzleAgentModelRunRepository(
    getDatabase(),
  ).createOrGet({
    operationId,
    actorId,
    assistantMessageId,
    phase: 'answer',
    taskAlias: 'agent.turn',
    modelAlias: 'primary',
    promptVersion: 'agent-v2',
    promptHash: 'b'.repeat(64),
    now,
  });
  const calls = new DrizzleAgentToolCallRepository(getDatabase());
  const write = await calls.createOrGet({
    operationId,
    actorId,
    answerModelRunId: run.run.id,
    providerToolCallId: 'call_write_effect',
    executionId: 'execution-write-effect',
    toolName: 'persistNote',
    exposure: 'model',
    effect: 'write',
    arguments: { secret: '不应进入effect账本' },
    now,
  });
  await calls.markRunning({
    operationId,
    actorId,
    toolCallId: write.call.id,
    now,
  });
  const read = await calls.createOrGet({
    operationId,
    actorId,
    answerModelRunId: run.run.id,
    providerToolCallId: 'call_read_effect',
    executionId: 'execution-read-effect',
    toolName: 'lookup',
    exposure: 'model',
    effect: 'read',
    arguments: {},
    now,
  });
  await calls.markRunning({
    operationId,
    actorId,
    toolCallId: read.call.id,
    now,
  });
  return {
    actorId,
    otherActorId,
    operationId,
    writeToolCallId: write.call.id,
    readToolCallId: read.call.id,
  };
}

describeWithDatabase('Tool Effect持久账本', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table tool_effects, tool_calls, model_runs,
        conversation_messages, agent_operations, conversations, spaces,
        personal_agents, platform_users, lesson_sessions
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('write调用先幂等记录intention再形成唯一提交终态', async () => {
    const fixture = await createFixture();
    const repository = new DrizzleToolEffectRepository(getDatabase());
    const input = {
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      toolCallId: fixture.writeToolCallId,
      effectKey: 'execution-write-effect',
      semanticsHash: 'c'.repeat(64),
      reconciliationVerifierId: 'mcp.receipt-query:v1',
      now: new Date('2026-07-21T12:00:01.000Z'),
    };
    const results = await Promise.all([
      repository.intend(input),
      repository.intend(input),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    const effect = results[0]!.effect;
    const committed = await repository.settle({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      effectId: effect.id,
      status: 'committed',
      receiptHash: 'd'.repeat(64),
      now: new Date('2026-07-21T12:00:02.000Z'),
    });
    expect(committed).toMatchObject({
      transitioned: true,
      effect: {
        status: 'committed',
        receiptHash: 'd'.repeat(64),
        reconciliationVerifierId: 'mcp.receipt-query:v1',
      },
    });
    await expect(
      repository.settle({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        effectId: effect.id,
        status: 'failed',
        code: 'tool_failed',
      }),
    ).rejects.toBeInstanceOf(ToolEffectConflictError);
    expect(
      await repository.get({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        effectKey: input.effectKey,
      }),
    ).toMatchObject({ id: effect.id, status: 'committed' });

    const stored = await getDatabase().select().from(schema.toolEffects);
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain('不应进入effect账本');
  });

  it('拒绝跨Actor、read调用和effectKey语义漂移', async () => {
    const fixture = await createFixture();
    const repository = new DrizzleToolEffectRepository(getDatabase());
    const intended = await repository.intend({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      toolCallId: fixture.writeToolCallId,
      effectKey: 'execution-write-effect',
      semanticsHash: 'e'.repeat(64),
      reconciliationVerifierId: 'mcp.receipt-query:v1',
    });
    await expect(
      repository.intend({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        toolCallId: fixture.writeToolCallId,
        effectKey: 'execution-write-effect',
        semanticsHash: 'f'.repeat(64),
        reconciliationVerifierId: 'mcp.receipt-query:v1',
      }),
    ).rejects.toBeInstanceOf(ToolEffectConflictError);
    await expect(
      repository.intend({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        toolCallId: fixture.writeToolCallId,
        effectKey: 'execution-write-effect',
        semanticsHash: 'e'.repeat(64),
        reconciliationVerifierId: 'mcp.other-verifier:v1',
      }),
    ).rejects.toBeInstanceOf(ToolEffectConflictError);
    await expect(
      repository.intend({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        toolCallId: fixture.readToolCallId,
        effectKey: 'execution-read-effect',
        semanticsHash: 'f'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(ToolEffectOwnershipError);
    await expect(
      repository.settle({
        operationId: fixture.operationId,
        actorId: fixture.otherActorId,
        effectId: intended.effect.id,
        status: 'failed',
        code: 'tool_failed',
      }),
    ).rejects.toBeInstanceOf(ToolEffectOwnershipError);
  });
});
