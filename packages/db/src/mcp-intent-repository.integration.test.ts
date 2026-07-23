import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleAgentModelRunRepository } from './agent-model-run-repository';
import { DrizzleAgentToolCallRepository } from './agent-tool-call-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import {
  DrizzleMcpIntentRepository,
  McpIntentOwnershipError,
} from './mcp-intent-repository';
import { DrizzleMcpIntentReconciler } from './mcp-intent-reconciler';
import * as schema from './schema';
import { mcpToolIntents } from './schema/mcp-intent';

const url = process.env.TEST_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;
const connection = url ? postgres(url, { max: 2 }) : null;
const database = connection ? drizzle(connection, { schema }) : null;

function db() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

async function createFixture() {
  const actorId = 'user:mcp-intent-owner';
  await db()
    .insert(schema.platformUsers)
    .values({ id: actorId, kind: 'registered' });
  const [agent] = await db()
    .insert(schema.personalAgents)
    .values({ userId: actorId })
    .returning();
  if (!agent) throw new Error('测试Agent创建失败');
  const conversation = await new DrizzlePlatformConversationRepository(
    db(),
  ).create({
    ownerSubjectId: actorId,
    spaceKind: 'notebook',
    spaceTitle: 'MCP密文意图测试',
  });
  const operationId = randomUUID();
  const assistantMessageId = randomUUID();
  await db()
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
    });
  await db().insert(schema.conversationMessages).values({
    id: assistantMessageId,
    conversationId: conversation.id,
    operationId,
    role: 'assistant',
    status: 'streaming',
    content: '',
    parts: [],
  });
  const run = await new DrizzleAgentModelRunRepository(db()).createOrGet({
    operationId,
    actorId,
    assistantMessageId,
    phase: 'answer',
    taskAlias: 'agent.turn',
    modelAlias: 'primary',
    promptVersion: 'mcp-intent-v1',
    promptHash: 'b'.repeat(64),
  });
  const call = await new DrizzleAgentToolCallRepository(db()).createOrGet({
    operationId,
    actorId,
    answerModelRunId: run.run.id,
    providerToolCallId: 'provider-call:mcp-intent',
    executionId: `execution:${operationId}`,
    toolName: 'publishNotes',
    exposure: 'model',
    effect: 'write',
    arguments: { private: '不得进入公共账本' },
  });
  return { actorId, agentId: agent.id, operationId, toolCallId: call.call.id };
}

function intentInput(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  expiresAt = new Date(Date.now() + 10 * 60_000).toISOString(),
) {
  return {
    metadata: {
      resumeRef: `mcp.intent:${'c'.repeat(64)}`,
      operationId: fixture.operationId,
      toolCallId: fixture.toolCallId,
      actorId: fixture.actorId,
      agentId: fixture.agentId,
      serverId: 'study-tools',
      remoteToolName: 'publish',
      modelToolName: 'publishNotes',
      capability: 'external.mcp.invoke' as const,
      risk: 'l2' as const,
      effect: 'write' as const,
      semanticsHash: 'd'.repeat(64),
      expiresAt,
    },
    sealedPayload: {
      keyVersion: 'v1' as const,
      nonce: Buffer.alloc(12, 1).toString('base64'),
      ciphertext: Buffer.from('opaque ciphertext').toString('base64'),
      authTag: Buffer.alloc(16, 2).toString('base64'),
      payloadHash: createHash('sha256').update('payload').digest('hex'),
    },
  };
}

describeWithDatabase('MCP Adapter密文意图仓储', () => {
  beforeAll(async () => {
    await migrate(db(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });
  beforeEach(async () => {
    await db().execute(
      sql`truncate table platform_users restart identity cascade`,
    );
  });
  afterAll(async () => connection?.end({ timeout: 5 }));

  it('幂等准备后在外呼前擦除密文，并拒绝跨Actor读取', async () => {
    const fixture = await createFixture();
    const repository = new DrizzleMcpIntentRepository(db());
    const input = intentInput(fixture);
    const resumeRef = input.metadata.resumeRef;
    expect((await repository.prepare(input)).replayed).toBe(false);
    expect((await repository.prepare(input)).replayed).toBe(true);
    await expect(
      repository.getForResume({
        resumeRef,
        operationId: fixture.operationId,
        toolCallId: fixture.toolCallId,
        actorId: 'user:other',
        agentId: fixture.agentId,
        capability: 'notes.publish',
      }),
    ).rejects.toBeInstanceOf(McpIntentOwnershipError);

    const dispatch = await repository.markDispatching({
      resumeRef,
      operationId: fixture.operationId,
      actorId: fixture.actorId,
    });
    expect(dispatch).toMatchObject({
      transitioned: true,
      intent: { status: 'dispatching', sealedPayload: null },
    });
    const [stored] = await db().select().from(mcpToolIntents);
    expect(stored).toMatchObject({
      keyVersion: null,
      nonce: null,
      ciphertext: null,
      authTag: null,
    });
    expect(
      await repository.settle({
        resumeRef,
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        status: 'outcome_unknown',
      }),
    ).toMatchObject({
      transitioned: true,
      intent: { status: 'outcome_unknown' },
    });
  });

  it('有界维护只擦除过期prepared密文', async () => {
    const fixture = await createFixture();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await new DrizzleMcpIntentRepository(db()).prepare(
      intentInput(fixture, expiresAt),
    );
    expect(
      await new DrizzleMcpIntentReconciler(db()).abandonExpiredPrepared({
        now: new Date(new Date(expiresAt).getTime() + 1),
        limit: 1,
      }),
    ).toBe(1);
    const [stored] = await db().select().from(mcpToolIntents);
    expect(stored).toMatchObject({
      status: 'failed',
      keyVersion: null,
      nonce: null,
      ciphertext: null,
      authTag: null,
    });
  });
});
