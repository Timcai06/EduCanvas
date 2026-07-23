import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import { DrizzleAgentModelRunRepository } from './agent-model-run-repository';
import { DrizzleAgentToolCallRepository } from './agent-tool-call-repository';
import { getDb } from './client';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import * as schema from './schema';
import { DrizzleToolEffectRepository } from './tool-effect-repository';

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

export function registerReconciliationIntegrationHooks() {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });
  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table tool_effect_reconciliations, tool_effects, tool_calls,
        model_runs, conversation_messages, agent_operations, conversations,
        spaces, personal_agents, platform_users, lesson_sessions
      restart identity cascade
    `);
  });
  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });
}

export async function createEffectFixture(
  target: ReturnType<typeof getDb>,
  options: {
    status?: 'intended' | 'committed' | 'failed' | 'outcome_unknown';
    reconciliationVerifierId?: string | null;
    legacyToolEffectSchema?: boolean;
  } = {},
) {
  const status = options.status ?? 'outcome_unknown';
  const actorId = `user:effect-reconciliation:${randomUUID()}`;
  const otherActorId = `user:effect-reconciliation-other:${randomUUID()}`;
  await target.insert(schema.platformUsers).values([
    { id: actorId, kind: 'registered' },
    { id: otherActorId, kind: 'registered' },
  ]);
  const [agent] = await target
    .insert(schema.personalAgents)
    .values({ userId: actorId })
    .returning();
  if (!agent) throw new Error('测试Agent创建失败');
  const conversation = await new DrizzlePlatformConversationRepository(
    target,
  ).create({
    ownerSubjectId: actorId,
    spaceKind: 'notebook',
    spaceTitle: 'Effect reconciliation测试',
  });
  const operationId = randomUUID();
  const assistantMessageId = randomUUID();
  const now = new Date('2026-07-22T12:00:00.000Z');
  await target.insert(schema.agentOperations).values({
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
  await target.insert(schema.conversationMessages).values({
    id: assistantMessageId,
    conversationId: conversation.id,
    operationId,
    role: 'assistant',
    status: 'streaming',
    content: '',
    parts: [],
    createdAt: now,
  });
  const run = await new DrizzleAgentModelRunRepository(target).createOrGet({
    operationId,
    actorId,
    assistantMessageId,
    phase: 'answer',
    taskAlias: 'agent.turn',
    modelAlias: 'primary',
    promptVersion: 'effect-reconciliation-v1',
    promptHash: 'b'.repeat(64),
    now,
  });
  const calls = new DrizzleAgentToolCallRepository(target);
  const call = await calls.createOrGet({
    operationId,
    actorId,
    answerModelRunId: run.run.id,
    providerToolCallId: `provider:${operationId}`,
    executionId: `effect:${operationId}`,
    toolName: 'externalWrite',
    exposure: 'model',
    effect: 'write',
    arguments: { privateText: '不得进入决议账本' },
    now,
  });
  await calls.markRunning({ operationId, actorId, toolCallId: call.call.id });
  let effectId: string = randomUUID();
  const effectKey = `effect:${operationId}`;
  const semanticsHash = 'c'.repeat(64);
  const effects = new DrizzleToolEffectRepository(target);
  if (options.legacyToolEffectSchema) {
    if (status !== 'outcome_unknown') {
      throw new Error('旧Schema fixture仅支持outcome_unknown');
    }
    await target.execute(sql`
      insert into tool_effects (
        id, agent_operation_id, tool_call_id, effect_key, semantics_hash,
        status, code, intended_at, settled_at
      ) values (
        ${effectId}, ${operationId}, ${call.call.id}, ${effectKey},
        ${semanticsHash}, 'outcome_unknown', 'write_outcome_unknown',
        ${now.toISOString()}, ${'2026-07-22T12:00:01.000Z'}
      )
    `);
  } else {
    const intended = await effects.intend({
      operationId,
      actorId,
      toolCallId: call.call.id,
      effectKey,
      semanticsHash,
      reconciliationVerifierId: options.reconciliationVerifierId,
      now,
    });
    effectId = intended.effect.id;
    if (status !== 'intended') {
      await effects.settle({
        operationId,
        actorId,
        effectId: intended.effect.id,
        status,
        ...(status === 'committed'
          ? { receiptHash: 'd'.repeat(64) }
          : {
              code:
                status === 'outcome_unknown'
                  ? 'write_outcome_unknown'
                  : 'tool_failed',
            }),
        now: new Date('2026-07-22T12:00:01.000Z'),
      });
    }
  }
  return {
    actorId,
    otherActorId,
    operationId,
    effectId,
    effectKey,
    semanticsHash,
    reconciliationVerifierId: options.reconciliationVerifierId ?? null,
  };
}
