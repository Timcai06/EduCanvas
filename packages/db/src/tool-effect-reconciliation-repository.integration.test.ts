import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import * as schema from './schema';
import { toolEffectReconciliations } from './schema/tool-effect-reconciliation';
import {
  ToolEffectReconciliationConflictError,
  ToolEffectReconciliationLifecycleError,
  ToolEffectReconciliationOwnershipError,
  DrizzleToolEffectReconciliationRepository,
} from './tool-effect-reconciliation-repository';
import {
  createEffectFixture,
  describeWithDatabase,
  getDatabase,
  registerReconciliationIntegrationHooks,
} from './tool-effect-reconciliation.integration.support';

function committedInput(
  fixture: Awaited<ReturnType<typeof createEffectFixture>>,
  source: 'manual' | 'adapter' = 'manual',
) {
  return {
    operationId: fixture.operationId,
    actorId: fixture.actorId,
    effectId: fixture.effectId,
    expectedEffectKey: fixture.effectKey,
    expectedSemanticsHash: fixture.semanticsHash,
    resolution: 'confirmed_committed' as const,
    source,
    resolverId:
      source === 'adapter' ? 'mcp.receipt-query:v1' : 'operator:reviewer-1',
    evidenceHash: 'e'.repeat(64),
    receiptHash: 'f'.repeat(64),
    now: new Date('2026-07-22T12:00:02.000Z'),
  };
}

describeWithDatabase('Tool Effect追加式决议仓储', () => {
  registerReconciliationIntegrationHooks();

  it('记录同值决议后幂等读取且不改写原Effect', async () => {
    const fixture = await createEffectFixture(getDatabase());
    const repository = new DrizzleToolEffectReconciliationRepository(
      getDatabase(),
    );
    const input = committedInput(fixture);
    const first = await repository.record(input);
    const replayed = await repository.record({
      ...input,
      now: new Date('2026-07-22T12:00:03.000Z'),
    });

    expect(first).toMatchObject({
      recorded: true,
      reconciliation: {
        effectId: fixture.effectId,
        operationId: fixture.operationId,
        effectKey: fixture.effectKey,
        semanticsHash: fixture.semanticsHash,
        resolution: 'confirmed_committed',
        receiptHash: 'f'.repeat(64),
        resolvedAt: '2026-07-22T12:00:02.000Z',
      },
    });
    expect(replayed).toEqual({ ...first, recorded: false });
    await expect(
      repository.get({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        effectId: fixture.effectId,
      }),
    ).resolves.toEqual(first.reconciliation);
    expect(
      await getDatabase()
        .select({ status: schema.toolEffects.status })
        .from(schema.toolEffects)
        .where(eq(schema.toolEffects.id, fixture.effectId)),
    ).toEqual([{ status: 'outcome_unknown' }]);
    const [stored] = await getDatabase()
      .select()
      .from(toolEffectReconciliations);
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      [
        'code',
        'effectId',
        'evidenceHash',
        'receiptHash',
        'resolution',
        'resolvedAt',
        'resolverId',
        'source',
      ].sort(),
    );
    expect(JSON.stringify(stored)).not.toContain('不得进入决议账本');
  });

  it('拒绝跨Actor、非未知Effect、语义漂移与非法决议形状', async () => {
    const unknown = await createEffectFixture(getDatabase());
    const repository = new DrizzleToolEffectReconciliationRepository(
      getDatabase(),
    );
    await expect(
      repository.record({
        ...committedInput(unknown),
        actorId: unknown.otherActorId,
      }),
    ).rejects.toBeInstanceOf(ToolEffectReconciliationOwnershipError);
    await expect(
      repository.record({
        ...committedInput(unknown),
        expectedEffectKey: `${unknown.effectKey}:drift`,
      }),
    ).rejects.toBeInstanceOf(ToolEffectReconciliationConflictError);
    await expect(
      repository.record({
        ...committedInput(unknown),
        expectedSemanticsHash: 'a'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(ToolEffectReconciliationConflictError);
    await expect(
      repository.record({
        ...committedInput(unknown),
        resolution: 'confirmed_not_committed',
        receiptHash: null,
      }),
    ).rejects.toBeInstanceOf(ToolEffectReconciliationLifecycleError);

    for (const status of ['intended', 'committed', 'failed'] as const) {
      const ineligible = await createEffectFixture(getDatabase(), { status });
      await expect(
        repository.record(committedInput(ineligible)),
      ).rejects.toBeInstanceOf(ToolEffectReconciliationLifecycleError);
    }
  });

  it('adapter决议必须匹配Effect意图冻结的Verifier身份', async () => {
    const bound = await createEffectFixture(getDatabase(), {
      reconciliationVerifierId: 'mcp.receipt-query:v1',
    });
    const repository = new DrizzleToolEffectReconciliationRepository(
      getDatabase(),
    );
    await expect(
      repository.record(committedInput(bound, 'adapter')),
    ).resolves.toMatchObject({ recorded: true });

    const unbound = await createEffectFixture(getDatabase());
    await expect(
      repository.record(committedInput(unbound, 'adapter')),
    ).rejects.toBeInstanceOf(ToolEffectReconciliationConflictError);

    const mismatched = await createEffectFixture(getDatabase(), {
      reconciliationVerifierId: 'mcp.other-verifier:v1',
    });
    await expect(
      repository.record(committedInput(mismatched, 'adapter')),
    ).rejects.toBeInstanceOf(ToolEffectReconciliationConflictError);
  });

  it('并发同值只新增一次，决议漂移只有首写者成功', async () => {
    const same = await createEffectFixture(getDatabase());
    const repositories = [
      new DrizzleToolEffectReconciliationRepository(getDatabase()),
      new DrizzleToolEffectReconciliationRepository(getDatabase()),
    ];
    const sameResults = await Promise.all(
      repositories.map((repository) => repository.record(committedInput(same))),
    );
    expect(sameResults.map(({ recorded }) => recorded).sort()).toEqual([
      false,
      true,
    ]);

    const drift = await createEffectFixture(getDatabase());
    const driftResults = await Promise.allSettled([
      repositories[0]!.record(committedInput(drift)),
      repositories[1]!.record({
        ...committedInput(drift),
        evidenceHash: '9'.repeat(64),
      }),
    ]);
    expect(
      driftResults.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    const [rejected] = driftResults.filter(
      ({ status }) => status === 'rejected',
    );
    expect(rejected).toMatchObject({
      reason: expect.any(ToolEffectReconciliationConflictError),
    });
    expect(
      await getDatabase().select().from(toolEffectReconciliations),
    ).toHaveLength(2);
  });
});
