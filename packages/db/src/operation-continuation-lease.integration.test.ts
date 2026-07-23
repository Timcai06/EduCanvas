import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import {
  DrizzleOperationContinuationRepository,
  OperationContinuationConflictError,
  OperationContinuationLifecycleError,
} from './operation-continuation-repository';
import {
  approve,
  createFixture,
  describeWithDatabase,
  getDatabase,
  initialTraceParent,
  registerContinuationIntegrationHooks,
  waitingInput,
} from './operation-continuation-repository.integration.support';
import * as schema from './schema';

describeWithDatabase('Operation continuation lease与取消', () => {
  registerContinuationIntegrationHooks();

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
      traceCarrier: { traceparent: initialTraceParent },
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
      traceCarrier: { traceparent: initialTraceParent },
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
      continuation: {
        status: 'completed',
        traceCarrier: { traceparent: initialTraceParent },
      },
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
