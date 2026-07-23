import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  DrizzleToolApprovalIntentRepository,
  ToolApprovalIntentConflictError,
  ToolApprovalIntentLifecycleError,
  ToolApprovalIntentOwnershipError,
} from './tool-approval-intent-repository';
import {
  createFixture,
  describeWithDatabase,
  getDatabase,
  initialTraceParent,
  intentInput,
  registerContinuationIntegrationHooks,
} from './operation-continuation-repository.integration.support';
import * as schema from './schema';

describeWithDatabase('Tool approval intent持久账本', () => {
  registerContinuationIntegrationHooks();

  it('幂等准备最小审批意图并拒绝越权、漂移与超长授权', async () => {
    const fixture = await createFixture();
    const repository = new DrizzleToolApprovalIntentRepository(getDatabase());
    const first = await repository.prepare(intentInput(fixture));
    const replayed = await repository.prepare({
      ...intentInput(fixture),
      traceCarrier: {
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00',
      },
    });

    expect(first).toMatchObject({
      replayed: false,
      intent: {
        protocol: 'educanvas.tool-approval-intent.v1',
        status: 'prepared',
        approvalId: fixture.approvalId,
        traceCarrier: { traceparent: initialTraceParent },
        work: {
          toolCallId: fixture.toolCallId,
          adapterSource: 'node',
        },
      },
    });
    expect(replayed).toMatchObject({
      replayed: true,
      intent: {
        approvalId: fixture.approvalId,
        traceCarrier: { traceparent: initialTraceParent },
      },
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
});
