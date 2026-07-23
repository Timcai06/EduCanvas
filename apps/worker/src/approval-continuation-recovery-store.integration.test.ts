import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import {
  DrizzleOperationContinuationRecoveryRepository,
  DrizzleOperationContinuationRepository,
  agentOperations,
  operationContinuations,
} from '@educanvas/db';
import { eq, sql } from 'drizzle-orm';
import { runOnce } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import {
  connectionString,
  createWaitingApproval,
  database,
  installApprovalContinuationIntegrationHooks,
  now,
} from './approval-continuation.integration-support.js';
import { listContinuationJobs } from './approval-continuation-sigkill.integration-support.js';
import { createContinueOperationTask } from './tasks/continue-operation.js';

const recoveryNow = new Date();
const expiredAt = new Date(recoveryNow.getTime() - 60_000);

async function approveAndClaim() {
  const fixture = await createWaitingApproval();
  await fixture.operations.resolveApproval({
    approvalId: fixture.approvalId,
    actorUserId: fixture.actorId,
    status: 'approved',
    now: new Date(now.getTime() + 1_000),
  });
  const continuations = new DrizzleOperationContinuationRepository(database);
  const claim = await continuations.claimForExecution({
    continuationId: fixture.continuationId,
    ownerId: 'worker:recovery-store-test',
    leaseDurationMs: 60_000,
    now: recoveryNow,
  });
  expect(claim).toMatchObject({ status: 'claimed' });
  return { fixture, continuations };
}

async function expireContinuation(continuationId: string) {
  await database
    .update(operationContinuations)
    .set({ leaseExpiresAt: expiredAt })
    .where(eq(operationContinuations.id, continuationId));
}

describe('Continuation恢复仓储', () => {
  installApprovalContinuationIntegrationHooks();

  it('跳过活跃lease，并发扫描仍只保留一个稳定key的可运行job', async () => {
    const { fixture, continuations } = await approveAndClaim();
    const recovery = new DrizzleOperationContinuationRecoveryRepository(
      database,
    );

    await expect(
      recovery.requeueExpiredForExecution({ limit: 10, now: recoveryNow }),
    ).resolves.toEqual({
      examined: 0,
      requeued: 0,
      generationExhausted: 0,
    });
    await expect(
      recovery.inspectRecoveryHealth({ now: recoveryNow }),
    ).resolves.toMatchObject({ runningActive: 1, runningExpired: 0 });

    await expireContinuation(fixture.continuationId);
    const results = await Promise.all([
      recovery.requeueExpiredForExecution({ limit: 10, now: recoveryNow }),
      recovery.requeueExpiredForExecution({ limit: 10, now: recoveryNow }),
    ]);
    expect(results.map((result) => result.requeued)).toEqual([1, 1]);
    expect(await listContinuationJobs()).toEqual([
      expect.objectContaining({
        key: `operation-continuation:${fixture.continuationId}`,
        payload: { continuationId: fixture.continuationId },
        lockedAt: null,
      }),
    ]);
    await expect(
      continuations.get({
        continuationId: fixture.continuationId,
        actorId: fixture.actorId,
      }),
    ).resolves.toMatchObject({
      status: 'running',
      leaseGeneration: 1,
      leaseExpiresAt: expiredAt.toISOString(),
    });
    await expect(
      recovery.inspectRecoveryHealth({ now: recoveryNow }),
    ).resolves.toMatchObject({
      runningActive: 0,
      runningExpired: 1,
      generationExhausted: 0,
      oldestExpiredAt: expiredAt.toISOString(),
    });
  });

  it('generation达到数据库上限时只告警且不绕过fencing重新入队', async () => {
    const { fixture } = await approveAndClaim();
    await database
      .update(operationContinuations)
      .set({ leaseGeneration: 1_000_000, leaseExpiresAt: expiredAt })
      .where(eq(operationContinuations.id, fixture.continuationId));
    await database.execute(sql`delete from graphile_worker._private_jobs`);
    const recovery = new DrizzleOperationContinuationRecoveryRepository(
      database,
    );

    await expect(
      recovery.requeueExpiredForExecution({ limit: 10, now: recoveryNow }),
    ).resolves.toEqual({
      examined: 0,
      requeued: 0,
      generationExhausted: 1,
    });
    expect(await listContinuationJobs()).toEqual([]);
    await expect(
      recovery.inspectRecoveryHealth({ now: recoveryNow }),
    ).resolves.toMatchObject({
      runningExpired: 1,
      generationExhausted: 1,
    });

    await database
      .update(agentOperations)
      .set({ status: 'completed', completedAt: recoveryNow })
      .where(eq(agentOperations.id, fixture.operationId));
    await expect(
      recovery.inspectRecoveryHealth({ now: recoveryNow }),
    ).resolves.toMatchObject({
      runningExpired: 0,
      generationExhausted: 0,
      terminalOperationStale: 1,
    });
  });

  it('取消请求仍被恢复投递，但claim后在Adapter前原子取消', async () => {
    const { fixture } = await approveAndClaim();
    await expect(
      fixture.operations.requestCancellation({
        operationId: fixture.operationId,
        actorUserId: fixture.actorId,
        now: new Date(recoveryNow.getTime() + 1_000),
      }),
    ).resolves.toEqual({ recorded: true, continuation: 'running' });
    await expireContinuation(fixture.continuationId);
    const recovery = new DrizzleOperationContinuationRecoveryRepository(
      database,
    );
    await expect(
      recovery.requeueExpiredForExecution({ limit: 10, now: recoveryNow }),
    ).resolves.toMatchObject({ requeued: 1 });

    const resumed = vi.fn();
    await runOnce({
      connectionString,
      taskList: {
        [OPERATION_CONTINUATION_TASK]: createContinueOperationTask({
          adapters: [
            {
              source: 'node',
              capabilities: ['filesystem.read_allowlisted'],
              async resume() {
                resumed();
                throw new Error('取消请求不得到达Adapter');
              },
            },
          ],
        }),
      },
    });
    expect(resumed).not.toHaveBeenCalled();
    await expect(
      new DrizzleOperationContinuationRepository(database).get({
        continuationId: fixture.continuationId,
        actorId: fixture.actorId,
      }),
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(
      (
        await fixture.operations.listEvents(
          fixture.operationId,
          -1,
          fixture.actorId,
        )
      ).filter((event) => event.type === 'operation.cancelled'),
    ).toHaveLength(1);
  });
});
