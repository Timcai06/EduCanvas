import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleAgentModelRunRepository } from './agent-model-run-repository';
import { DrizzleAgentToolCallRepository } from './agent-tool-call-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import {
  DrizzleOperationContinuationRepository,
  OperationContinuationConflictError,
  OperationContinuationLifecycleError,
  OperationContinuationOwnershipError,
} from './operation-continuation-repository';
import {
  DrizzleToolApprovalIntentRepository,
  ToolApprovalIntentConflictError,
  ToolApprovalIntentLifecycleError,
  ToolApprovalIntentOwnershipError,
} from './tool-approval-intent-repository';
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

async function createFixture() {
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

function waitingInput(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return {
    operationId: fixture.operationId,
    actorId: fixture.actorId,
    approvalId: fixture.approvalId,
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

function intentInput(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return {
    ...waitingInput(fixture),
    expiresAt: '2026-07-21T12:10:01.000Z',
  };
}

async function approve(fixture: Awaited<ReturnType<typeof createFixture>>) {
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

describeWithDatabase('Operation continuation持久账本', () => {
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

  it('幂等准备最小审批意图并拒绝越权、漂移与超长授权', async () => {
    const fixture = await createFixture();
    const repository = new DrizzleToolApprovalIntentRepository(getDatabase());
    const first = await repository.prepare(intentInput(fixture));
    const replayed = await repository.prepare(intentInput(fixture));

    expect(first).toMatchObject({
      replayed: false,
      intent: {
        protocol: 'educanvas.tool-approval-intent.v1',
        status: 'prepared',
        approvalId: fixture.approvalId,
        work: {
          toolCallId: fixture.toolCallId,
          adapterSource: 'node',
        },
      },
    });
    expect(replayed).toMatchObject({
      replayed: true,
      intent: { approvalId: fixture.approvalId },
    });
    expect(JSON.stringify(first)).not.toContain('不得进入continuation账本');
    await expect(
      repository.prepare({
        ...intentInput(fixture),
        actorId: fixture.otherActorId,
      }),
    ).rejects.toBeInstanceOf(ToolApprovalIntentOwnershipError);
    await expect(
      repository.prepare({
        ...intentInput(fixture),
        approvalId: `approval:drift:${fixture.operationId}`,
      }),
    ).rejects.toBeInstanceOf(ToolApprovalIntentConflictError);
    await expect(
      repository.prepare({
        ...intentInput(fixture),
        approvalId: `approval:long:${fixture.operationId}`,
        work: {
          ...intentInput(fixture).work,
          toolCallId: randomUUID(),
        },
        expiresAt: '2026-07-22T12:00:02.000Z',
      }),
    ).rejects.toBeInstanceOf(ToolApprovalIntentLifecycleError);
  });

  it('以有界批次放弃过期prepared意图且不提前清理', async () => {
    const fixture = await createFixture();
    const repository = new DrizzleToolApprovalIntentRepository(getDatabase());
    await repository.prepare(intentInput(fixture));

    await expect(
      repository.abandonExpiredPrepared({
        now: new Date('2026-07-21T12:10:00.000Z'),
        limit: 1,
      }),
    ).resolves.toBe(0);
    await expect(
      repository.abandonExpiredPrepared({
        now: new Date('2026-07-21T12:10:01.000Z'),
        limit: 1,
      }),
    ).resolves.toBe(1);
    await expect(
      repository.abandonExpiredPrepared({
        now: new Date('2026-07-21T12:11:00.000Z'),
        limit: 1,
      }),
    ).resolves.toBe(0);
    expect(
      await getDatabase()
        .select({
          status: schema.toolApprovalIntents.status,
          abandonedAt: schema.toolApprovalIntents.abandonedAt,
          boundAt: schema.toolApprovalIntents.boundAt,
        })
        .from(schema.toolApprovalIntents),
    ).toEqual([
      {
        status: 'abandoned',
        abandonedAt: new Date('2026-07-21T12:10:01.000Z'),
        boundAt: null,
      },
    ]);
    await expect(
      repository.abandonExpiredPrepared({ limit: 501 }),
    ).rejects.toBeInstanceOf(ToolApprovalIntentLifecycleError);
  });

  it('以Operation幂等创建等待态且只保存稳定引用', async () => {
    const fixture = await createFixture();
    const repository = new DrizzleOperationContinuationRepository(
      getDatabase(),
    );
    const first = await repository.createWaiting(waitingInput(fixture));
    const replayed = await repository.createWaiting(waitingInput(fixture));
    expect(first).toMatchObject({
      replayed: false,
      continuation: {
        operationId: fixture.operationId,
        status: 'waiting_approval',
        approvalId: fixture.approvalId,
        leaseGeneration: 0,
        work: { toolCallId: fixture.toolCallId, adapterSource: 'node' },
      },
    });
    expect(replayed).toMatchObject({
      replayed: true,
      continuation: { operationId: fixture.operationId },
    });
    await expect(
      repository.get({
        continuationId: first.continuation.continuationId,
        actorId: fixture.otherActorId,
      }),
    ).rejects.toBeInstanceOf(OperationContinuationOwnershipError);
    await expect(
      repository.createWaiting({
        ...waitingInput(fixture),
        approvalId: `approval:other:${fixture.operationId}`,
      }),
    ).rejects.toBeInstanceOf(OperationContinuationConflictError);

    const stored = await getDatabase()
      .select()
      .from(schema.operationContinuations);
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain('不得进入continuation账本');
    expect(Object.keys(stored[0] ?? {}).sort()).not.toContain('checkpoint');
  });

  it('只有服务端approved事实能把等待态推进到ready', async () => {
    const fixture = await createFixture();
    const repository = new DrizzleOperationContinuationRepository(
      getDatabase(),
    );
    const waiting = await repository.createWaiting(waitingInput(fixture));
    await getDatabase()
      .insert(schema.gatewayApprovals)
      .values({
        id: fixture.approvalId,
        operationId: fixture.operationId,
        actorUserId: fixture.actorId,
        capability: 'node.write',
        risk: 'l2',
        summary: '等待批准',
        status: 'pending',
        requestedAt: new Date('2026-07-21T12:00:01.000Z'),
        expiresAt: new Date('2026-07-21T12:10:01.000Z'),
      });
    await expect(
      repository.markReady({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        approvalId: fixture.approvalId,
      }),
    ).rejects.toBeInstanceOf(OperationContinuationLifecycleError);
    await getDatabase()
      .update(schema.gatewayApprovals)
      .set({
        status: 'approved',
        decidedByUserId: fixture.actorId,
        decidedAt: new Date('2026-07-21T12:00:02.000Z'),
        expiresAt: new Date('2026-07-21T12:00:02.000Z'),
      })
      .where(eq(schema.gatewayApprovals.id, fixture.approvalId));
    await expect(
      repository.markReady({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        approvalId: fixture.approvalId,
        now: new Date('2026-07-21T12:00:03.000Z'),
      }),
    ).rejects.toBeInstanceOf(OperationContinuationLifecycleError);
    await getDatabase()
      .update(schema.gatewayApprovals)
      .set({ expiresAt: new Date('2026-07-21T12:10:02.000Z') })
      .where(eq(schema.gatewayApprovals.id, fixture.approvalId));
    const ready = await repository.markReady({
      continuationId: waiting.continuation.continuationId,
      actorId: fixture.actorId,
      approvalId: fixture.approvalId,
      now: new Date('2026-07-21T12:00:03.000Z'),
    });
    expect(ready).toMatchObject({
      transitioned: true,
      continuation: { status: 'ready' },
    });
    expect(
      await repository.markReady({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        approvalId: fixture.approvalId,
      }),
    ).toMatchObject({ transitioned: false, continuation: { status: 'ready' } });
  });

  it('同一Operation只允许一个活动等待点但可按序创建后续continuation', async () => {
    const fixture = await createFixture();
    const repository = new DrizzleOperationContinuationRepository(
      getDatabase(),
    );
    const first = await repository.createWaiting(waitingInput(fixture));
    const followUpCall = await new DrizzleAgentToolCallRepository(
      getDatabase(),
    ).createOrGet({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      answerModelRunId: fixture.answerModelRunId,
      providerToolCallId: 'provider-call:continuation:follow-up',
      executionId: `execution:${fixture.operationId}:follow-up`,
      toolName: 'nodeWrite',
      exposure: 'model',
      effect: 'write',
      arguments: { privateText: '第二个等待点也不能进入账本' },
      now: new Date('2026-07-21T12:00:02.000Z'),
    });
    const followUpInput = {
      ...waitingInput(fixture),
      approvalId: `approval:${fixture.operationId}:follow-up`,
      work: {
        ...waitingInput(fixture).work,
        toolCallId: followUpCall.call.id,
        resumeRef: `node-invocation:${fixture.operationId}:follow-up`,
      },
    };
    await expect(
      repository.createWaiting(followUpInput),
    ).rejects.toBeInstanceOf(OperationContinuationConflictError);

    await repository.cancel({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      now: new Date('2026-07-21T12:00:03.000Z'),
    });
    const second = await repository.createWaiting({
      ...followUpInput,
      now: new Date('2026-07-21T12:00:04.000Z'),
    });
    expect(first.continuation.sequence).toBe(1);
    expect(second).toMatchObject({
      replayed: false,
      continuation: {
        operationId: fixture.operationId,
        sequence: 2,
        status: 'waiting_approval',
      },
    });
    expect(second.continuation.continuationId).not.toBe(
      first.continuation.continuationId,
    );
  });

  it('lease generation阻止旧worker在过期重领后继续提交', async () => {
    const fixture = await createFixture();
    const repository = new DrizzleOperationContinuationRepository(
      getDatabase(),
    );
    const waiting = await repository.createWaiting(waitingInput(fixture));
    await approve(fixture);
    await repository.markReady({
      continuationId: waiting.continuation.continuationId,
      actorId: fixture.actorId,
      approvalId: fixture.approvalId,
      now: new Date('2026-07-21T12:00:03.000Z'),
    });
    const first = await repository.claim({
      continuationId: waiting.continuation.continuationId,
      actorId: fixture.actorId,
      ownerId: 'worker:first',
      leaseDurationMs: 30_000,
      now: new Date('2026-07-21T12:00:04.000Z'),
    });
    expect(first).toMatchObject({
      status: 'running',
      leaseOwnerId: 'worker:first',
      leaseGeneration: 1,
    });
    expect(
      await repository.claim({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        ownerId: 'worker:second',
        leaseDurationMs: 30_000,
        now: new Date('2026-07-21T12:00:05.000Z'),
      }),
    ).toBeNull();
    expect(
      await repository.heartbeat({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        ownerId: 'worker:first',
        leaseGeneration: 1,
        leaseDurationMs: 30_000,
        now: new Date('2026-07-21T12:00:20.000Z'),
      }),
    ).toBe(true);
    const reclaimed = await repository.claim({
      continuationId: waiting.continuation.continuationId,
      actorId: fixture.actorId,
      ownerId: 'worker:second',
      leaseDurationMs: 30_000,
      now: new Date('2026-07-21T12:00:51.000Z'),
    });
    expect(reclaimed).toMatchObject({
      status: 'running',
      leaseOwnerId: 'worker:second',
      leaseGeneration: 2,
    });
    expect(
      await repository.heartbeat({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        ownerId: 'worker:first',
        leaseGeneration: 1,
        leaseDurationMs: 30_000,
        now: new Date('2026-07-21T12:00:52.000Z'),
      }),
    ).toBe(false);
    await expect(
      repository.settle({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        ownerId: 'worker:first',
        leaseGeneration: 1,
        status: 'completed',
        now: new Date('2026-07-21T12:00:52.000Z'),
      }),
    ).rejects.toBeInstanceOf(OperationContinuationConflictError);
    expect(
      await repository.settle({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        ownerId: 'worker:second',
        leaseGeneration: 2,
        status: 'completed',
        now: new Date('2026-07-21T12:00:53.000Z'),
      }),
    ).toMatchObject({
      transitioned: true,
      continuation: { status: 'completed' },
    });
  });

  it('取消会原子废止运行lease且保持幂等', async () => {
    const fixture = await createFixture();
    const repository = new DrizzleOperationContinuationRepository(
      getDatabase(),
    );
    const waiting = await repository.createWaiting(waitingInput(fixture));
    await approve(fixture);
    await repository.markReady({
      continuationId: waiting.continuation.continuationId,
      actorId: fixture.actorId,
      approvalId: fixture.approvalId,
      now: new Date('2026-07-21T12:00:03.000Z'),
    });
    await repository.claim({
      continuationId: waiting.continuation.continuationId,
      actorId: fixture.actorId,
      ownerId: 'worker:cancelled',
      leaseDurationMs: 30_000,
      now: new Date('2026-07-21T12:00:04.000Z'),
    });
    await getDatabase()
      .update(schema.agentOperations)
      .set({ cancelRequestedAt: new Date('2026-07-21T12:00:05.000Z') })
      .where(eq(schema.agentOperations.id, fixture.operationId));
    expect(
      await repository.heartbeat({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        ownerId: 'worker:cancelled',
        leaseGeneration: 1,
        leaseDurationMs: 30_000,
        now: new Date('2026-07-21T12:00:05.000Z'),
      }),
    ).toBe(false);
    await expect(
      repository.release({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        ownerId: 'worker:cancelled',
        leaseGeneration: 1,
        now: new Date('2026-07-21T12:00:05.000Z'),
      }),
    ).rejects.toBeInstanceOf(OperationContinuationLifecycleError);
    await expect(
      repository.settle({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        ownerId: 'worker:cancelled',
        leaseGeneration: 1,
        status: 'completed',
        now: new Date('2026-07-21T12:00:05.000Z'),
      }),
    ).rejects.toBeInstanceOf(OperationContinuationLifecycleError);
    expect(
      await repository.cancel({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        now: new Date('2026-07-21T12:00:06.000Z'),
      }),
    ).toMatchObject({
      transitioned: true,
      continuation: {
        status: 'cancelled',
        leaseOwnerId: null,
        completedAt: '2026-07-21T12:00:06.000Z',
      },
    });
    expect(
      await repository.cancel({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
      }),
    ).toMatchObject({ transitioned: false });
    expect(
      await repository.heartbeat({
        continuationId: waiting.continuation.continuationId,
        actorId: fixture.actorId,
        ownerId: 'worker:cancelled',
        leaseGeneration: 1,
        leaseDurationMs: 30_000,
      }),
    ).toBe(false);
  });
});
