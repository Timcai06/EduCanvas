import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { DrizzleAgentToolCallRepository } from './agent-tool-call-repository';
import {
  DrizzleOperationContinuationRepository,
  OperationContinuationConflictError,
  OperationContinuationLifecycleError,
  OperationContinuationOwnershipError,
} from './operation-continuation-repository';
import {
  createFixture,
  describeWithDatabase,
  getDatabase,
  registerContinuationIntegrationHooks,
  waitingInput,
} from './operation-continuation-repository.integration.support';
import * as schema from './schema';

describeWithDatabase('Operation continuation等待态与审批推进', () => {
  registerContinuationIntegrationHooks();

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
});
