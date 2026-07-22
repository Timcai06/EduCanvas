import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { DrizzleOperationContinuationRepository } from './operation-continuation-repository';
import {
  createFixture,
  describeWithDatabase,
  getDatabase,
  intentInput,
  registerContinuationIntegrationHooks,
  waitingInput,
} from './operation-continuation-repository.integration.support';
import * as schema from './schema';
import { DrizzleToolApprovalIntentRepository } from './tool-approval-intent-repository';

const invalidTraceParents = [
  '00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01',
  '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
  '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01',
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-03',
];

describeWithDatabase('Continuation trace carrier数据库约束', () => {
  registerContinuationIntegrationHooks();

  it('允许旧记录保持null并在两张账本上拒绝非规范traceparent', async () => {
    const fixture = await createFixture();
    await new DrizzleToolApprovalIntentRepository(getDatabase()).prepare({
      ...intentInput(fixture),
      traceCarrier: null,
    });
    await new DrizzleOperationContinuationRepository(
      getDatabase(),
    ).createWaiting({
      ...waitingInput(fixture),
      traceCarrier: null,
    });

    const [intent] = await getDatabase()
      .select({ traceParent: schema.toolApprovalIntents.traceParent })
      .from(schema.toolApprovalIntents);
    const [continuation] = await getDatabase()
      .select({ traceParent: schema.operationContinuations.traceParent })
      .from(schema.operationContinuations);
    expect(intent).toEqual({ traceParent: null });
    expect(continuation).toEqual({ traceParent: null });

    for (const traceParent of invalidTraceParents) {
      await expect(
        getDatabase()
          .update(schema.toolApprovalIntents)
          .set({ traceParent })
          .where(eq(schema.toolApprovalIntents.approvalId, fixture.approvalId)),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
      await expect(
        getDatabase()
          .update(schema.operationContinuations)
          .set({ traceParent })
          .where(
            eq(schema.operationContinuations.operationId, fixture.operationId),
          ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    }
  });
});
