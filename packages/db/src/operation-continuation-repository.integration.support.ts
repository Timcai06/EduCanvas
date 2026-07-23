import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import { DrizzleAgentModelRunRepository } from './agent-model-run-repository';
import { DrizzleAgentToolCallRepository } from './agent-tool-call-repository';
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
export const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 4 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

export function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

export function registerContinuationIntegrationHooks() {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table operation_continuations, tool_approval_intents,
        gateway_approvals, tool_effects,
        tool_calls, model_runs, conversation_messages, agent_operations,
        conversations, spaces, personal_agents, platform_users, lesson_sessions
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });
}

export async function createFixture() {
  const actorId = 'user:continuation-owner';
  const otherActorId = 'user:continuation-other';
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
    spaceTitle: 'Continuation账本测试',
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
    promptVersion: 'continuation-v1',
    promptHash: 'b'.repeat(64),
    now,
  });
  const call = await new DrizzleAgentToolCallRepository(
    getDatabase(),
  ).createOrGet({
    operationId,
    actorId,
    answerModelRunId: run.run.id,
    providerToolCallId: 'provider-call:continuation',
    executionId: `execution:${operationId}`,
    toolName: 'nodeWrite',
    exposure: 'model',
    effect: 'write',
    arguments: { privateText: '不得进入continuation账本' },
    now,
  });
  return {
    actorId,
    otherActorId,
    operationId,
    answerModelRunId: run.run.id,
    toolCallId: call.call.id,
    approvalId: `approval:${operationId}`,
  };
}

export type ContinuationFixture = Awaited<ReturnType<typeof createFixture>>;

export const initialTraceParent =
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

export function waitingInput(fixture: ContinuationFixture) {
  return {
    operationId: fixture.operationId,
    actorId: fixture.actorId,
    approvalId: fixture.approvalId,
    traceCarrier: { traceparent: initialTraceParent },
    work: {
      kind: 'tool_invocation' as const,
      step: 'tool.invoke' as const,
      toolCallId: fixture.toolCallId,
      adapterSource: 'node' as const,
      resumeRef: `node-invocation:${fixture.operationId}`,
    },
    now: new Date('2026-07-21T12:00:01.000Z'),
  };
}

export function intentInput(fixture: ContinuationFixture) {
  return {
    ...waitingInput(fixture),
    expiresAt: '2026-07-21T12:10:01.000Z',
  };
}

export async function approve(fixture: ContinuationFixture) {
  await getDatabase()
    .insert(schema.gatewayApprovals)
    .values({
      id: fixture.approvalId,
      operationId: fixture.operationId,
      actorUserId: fixture.actorId,
      capability: 'node.write',
      risk: 'l2',
      summary: '写入受控测试节点',
      status: 'approved',
      requestedAt: new Date('2026-07-21T12:00:01.000Z'),
      expiresAt: new Date('2026-07-21T12:10:01.000Z'),
      decidedByUserId: fixture.actorId,
      decidedAt: new Date('2026-07-21T12:00:02.000Z'),
    });
}
