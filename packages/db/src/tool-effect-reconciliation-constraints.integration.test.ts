import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { toolEffects } from './schema';
import { toolEffectReconciliations } from './schema/tool-effect-reconciliation';
import {
  createEffectFixture,
  describeWithDatabase,
  getDatabase,
  registerReconciliationIntegrationHooks,
} from './tool-effect-reconciliation.integration.support';

describeWithDatabase('Tool Effect决议数据库约束', () => {
  registerReconciliationIntegrationHooks();

  it('严格限制决议来源、稳定标识、证据hash与终态形状', async () => {
    const fixture = await createEffectFixture(getDatabase());
    await expect(
      getDatabase()
        .update(toolEffects)
        .set({ reconciliationVerifierId: 'bad verifier' })
        .where(eq(toolEffects.id, fixture.effectId)),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    const base = {
      effectId: fixture.effectId,
      resolution: 'confirmed_committed',
      source: 'manual',
      resolverId: 'operator:reviewer-1',
      evidenceHash: 'a'.repeat(64),
      resolvedAt: new Date('2026-07-22T12:00:03.000Z'),
    };
    const invalidRows = [
      { ...base, resolution: 'unknown' },
      { ...base, source: 'client' },
      { ...base, resolverId: 'bad resolver' },
      { ...base, evidenceHash: 'not-a-hash' },
      { ...base, receiptHash: 'not-a-hash' },
      { ...base, code: 'should_not_exist' },
      {
        ...base,
        resolution: 'confirmed_not_committed',
        code: 'provider_rejected',
        receiptHash: 'b'.repeat(64),
      },
      {
        ...base,
        resolution: 'confirmed_not_committed',
        code: 'Bad code',
      },
    ];
    for (const row of invalidRows) {
      await expect(
        getDatabase().insert(toolEffectReconciliations).values(row),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    }

    await expect(
      getDatabase().insert(toolEffectReconciliations).values(base),
    ).resolves.toBeDefined();
    const notCommitted = await createEffectFixture(getDatabase());
    await expect(
      getDatabase()
        .insert(toolEffectReconciliations)
        .values({
          ...base,
          effectId: notCommitted.effectId,
          resolution: 'confirmed_not_committed',
          code: 'provider_rejected',
        }),
    ).resolves.toBeDefined();
  });
});
