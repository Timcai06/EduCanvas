import type {
  ToolEffectLedgerPort,
  ToolEffectReconciliationPort,
} from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';
import { ToolEffectReconciler, type ToolEffectVerifier } from './tool-kernel';

const target = {
  operationId: '20000000-0000-4000-8000-000000000001',
  actorId: 'user:effect-owner',
  effectId: '10000000-0000-4000-8000-000000000001',
  effectKey: 'execution:effect-1',
  semanticsHash: 'a'.repeat(64),
};

function setup(
  verifiers: readonly ToolEffectVerifier[] = [],
  boundVerifierId: string | null = verifiers[0]?.id ?? null,
) {
  const effects: ToolEffectLedgerPort = {
    intend: async () => {
      throw new Error('unexpected_intend');
    },
    settle: async () => {
      throw new Error('unexpected_settle');
    },
    get: async () => ({
      id: target.effectId,
      operationId: target.operationId,
      toolCallId: '30000000-0000-4000-8000-000000000001',
      effectKey: target.effectKey,
      semanticsHash: target.semanticsHash,
      reconciliationVerifierId: boundVerifierId,
      status: 'outcome_unknown',
      code: 'write_outcome_unknown',
      receiptHash: null,
      intendedAt: '2026-07-23T00:00:00.000Z',
      settledAt: '2026-07-23T00:00:05.000Z',
    }),
  };
  const authorize = vi.fn(async () => true);
  const record = vi.fn(async () => {
    throw new Error('unexpected_record');
  });
  const reconciliations = {
    get: async () => null,
    record,
  } as ToolEffectReconciliationPort;
  return {
    authorize,
    record,
    reconciler: new ToolEffectReconciler(
      effects,
      reconciliations,
      { authorize },
      verifiers,
    ),
  };
}

describe('Tool Effect reconciliation输入边界', () => {
  it('拒绝会令派生resolverId超过160字符的principal', async () => {
    const { authorize, record, reconciler } = setup();
    await expect(
      reconciler.reconcileManually({
        ...target,
        resolution: 'confirmed_committed',
        principal: { kind: 'operator', subjectId: `a${'b'.repeat(159)}` },
        evidenceHash: 'b'.repeat(64),
      }),
    ).resolves.toEqual({
      status: 'unchanged',
      reason: 'manual_authorization_denied',
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('拒绝重复注册同名自动核验器', () => {
    const verifier = {
      id: 'adapter:duplicate',
      verify: async () => ({ status: 'indeterminate' as const }),
    };
    expect(() => setup([verifier, verifier])).toThrow(
      'effect_verifier_duplicate',
    );
  });

  it.each([
    {
      name: '非法超时',
      verifier: {
        id: 'adapter:bad-timeout',
        timeoutMs: 0,
        verify: async () => ({ status: 'indeterminate' as const }),
      },
    },
    {
      name: '非法核验结果',
      verifier: {
        id: 'adapter:bad-verdict',
        verify: async () => ({
          status: 'committed' as const,
          evidenceHash: 'x',
        }),
      },
    },
  ])('$name时不写决议', async ({ verifier }) => {
    const { record, reconciler } = setup([verifier]);
    await expect(reconciler.reconcileAutomatically(target)).resolves.toEqual({
      status: 'unchanged',
      reason: 'verification_failed',
    });
    expect(record).not.toHaveBeenCalled();
  });

  it('拒绝没有SHA-256证据的人工输入', async () => {
    const { record, reconciler } = setup();
    await expect(
      reconciler.reconcileManually({
        ...target,
        resolution: 'confirmed_committed',
        principal: { kind: 'service', subjectId: 'effect-ops' },
        evidenceHash: 'not-a-hash',
      }),
    ).rejects.toThrow('effect_reconciliation_evidence_invalid');
    expect(record).not.toHaveBeenCalled();
  });

  it('旧Effect的null绑定不会调用任一核验器', async () => {
    const verify = vi.fn(async () => ({ status: 'indeterminate' as const }));
    const { record, reconciler } = setup(
      [{ id: 'adapter:registered', verify }],
      null,
    );
    await expect(reconciler.reconcileAutomatically(target)).resolves.toEqual({
      status: 'unchanged',
      reason: 'verifier_unavailable',
    });
    expect(verify).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
