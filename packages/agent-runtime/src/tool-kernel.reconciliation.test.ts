import type {
  ToolEffectLedgerPort,
  ToolEffectLedgerSnapshot,
  ToolEffectReconciliationPort,
  ToolEffectReconciliationSnapshot,
} from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';
import {
  ToolEffectReconciler,
  type ToolEffectReconciliationAuthorizerPort,
  type ToolEffectReconciliationTarget,
  type ToolEffectVerificationInput,
  type ToolEffectVerifier,
} from './tool-kernel';

const effect: ToolEffectLedgerSnapshot = {
  id: '10000000-0000-4000-8000-000000000001',
  operationId: '20000000-0000-4000-8000-000000000001',
  toolCallId: '30000000-0000-4000-8000-000000000001',
  effectKey: 'execution:effect-1',
  semanticsHash: 'a'.repeat(64),
  reconciliationVerifierId: 'adapter:query-v1',
  status: 'outcome_unknown',
  code: 'write_outcome_unknown',
  receiptHash: null,
  intendedAt: '2026-07-23T00:00:00.000Z',
  settledAt: '2026-07-23T00:00:05.000Z',
};

const target: ToolEffectReconciliationTarget = {
  operationId: effect.operationId,
  actorId: 'user:effect-owner',
  effectId: effect.id,
  effectKey: effect.effectKey,
  semanticsHash: effect.semanticsHash,
};

class EffectLedger implements ToolEffectLedgerPort {
  constructor(readonly current: ToolEffectLedgerSnapshot | null = effect) {}
  intend(): never {
    throw new Error('unexpected_intend');
  }
  settle(): never {
    throw new Error('unexpected_settle');
  }
  async get() {
    return this.current;
  }
}

class ReconciliationLedger implements ToolEffectReconciliationPort {
  readonly records: Parameters<ToolEffectReconciliationPort['record']>[0][] =
    [];

  async get() {
    return null;
  }

  async record(input: Parameters<ToolEffectReconciliationPort['record']>[0]) {
    this.records.push(input);
    const reconciliation: ToolEffectReconciliationSnapshot = {
      effectId: input.effectId,
      operationId: input.operationId,
      effectKey: input.expectedEffectKey,
      semanticsHash: input.expectedSemanticsHash,
      resolution: input.resolution,
      source: input.source,
      resolverId: input.resolverId,
      evidenceHash: input.evidenceHash,
      receiptHash: input.receiptHash ?? null,
      code: input.code ?? null,
      resolvedAt: '2026-07-23T00:01:00.000Z',
    };
    return { reconciliation, recorded: true };
  }
}

const allowManual: ToolEffectReconciliationAuthorizerPort = {
  authorize: async () => true,
};

function setup(
  options: {
    current?: ToolEffectLedgerSnapshot | null;
    authorizer?: ToolEffectReconciliationAuthorizerPort;
    verifiers?: readonly ToolEffectVerifier[];
  } = {},
) {
  const effects = new EffectLedger(options.current ?? effect);
  const reconciliations = new ReconciliationLedger();
  return {
    effects,
    reconciliations,
    reconciler: new ToolEffectReconciler(
      effects,
      reconciliations,
      options.authorizer ?? allowManual,
      options.verifiers,
    ),
  };
}

describe('Tool Effect reconciliation', () => {
  it('人工决议只追加证据，不改写原Effect或制造Tool结果', async () => {
    const authorize = vi.fn(async () => true);
    const { effects, reconciliations, reconciler } = setup({
      authorizer: { authorize },
    });
    const result = await reconciler.reconcileManually({
      ...target,
      resolution: 'confirmed_not_committed',
      principal: { kind: 'operator', subjectId: 'reconciler-1' },
      evidenceHash: 'b'.repeat(64),
      code: 'operator_confirmed_not_committed',
    });

    expect(result).toMatchObject({
      status: 'recorded',
      recorded: true,
      reconciliation: { resolution: 'confirmed_not_committed' },
    });
    expect(effects.current).toEqual(effect);
    expect(result).not.toHaveProperty('output');
    expect(reconciliations.records).toHaveLength(1);
    expect(reconciliations.records[0]?.resolverId).toBe(
      'operator:reconciler-1',
    );
    expect(authorize).toHaveBeenCalledWith({
      principal: { kind: 'operator', subjectId: 'reconciler-1' },
      target,
    });
  });

  it('自动核验器只收到稳定Effect元数据且绝不调用invoke', async () => {
    const invoke = vi.fn();
    const verify = vi.fn(async (_input: ToolEffectVerificationInput) => ({
      status: 'committed' as const,
      evidenceHash: 'c'.repeat(64),
      receiptHash: 'd'.repeat(64),
    }));
    const verifier = { id: 'adapter:query-v1', invoke, verify };
    const wrongVerify = vi.fn(async () => ({
      status: 'indeterminate' as const,
    }));
    const wrongVerifier = { id: 'adapter:wrong', verify: wrongVerify };
    const authorize = vi.fn(async () => true);
    const { reconciliations, reconciler } = setup({
      authorizer: { authorize },
      verifiers: [verifier, wrongVerifier],
    });

    await expect(
      reconciler.reconcileAutomatically(target),
    ).resolves.toMatchObject({
      status: 'recorded',
      reconciliation: { resolution: 'confirmed_committed' },
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(wrongVerify).not.toHaveBeenCalled();
    expect(reconciler.reconcileAutomatically).toHaveLength(1);
    const verificationInput = verify.mock.calls[0]![0];
    expect(Object.keys(verificationInput ?? {}).sort()).toEqual(
      [
        'effectId',
        'effectKey',
        'intendedAt',
        'operationId',
        'semanticsHash',
        'settledAt',
        'toolCallId',
      ].sort(),
    );
    expect(Object.isFrozen(verificationInput)).toBe(true);
    expect(JSON.stringify(reconciliations.records)).not.toContain('credential');
  });

  it.each([
    {
      name: '缺少核验器',
      verifier: undefined as ToolEffectVerifier | undefined,
      verifierId: 'adapter:missing',
      reason: 'verifier_unavailable',
    },
    {
      name: '核验结果仍未知',
      verifier: {
        id: 'adapter:unknown',
        verify: async () => ({ status: 'indeterminate' as const }),
      },
      verifierId: 'adapter:unknown',
      reason: 'verification_indeterminate',
    },
    {
      name: '核验器异常',
      verifier: {
        id: 'adapter:broken',
        verify: async () => {
          throw new Error('private_remote_error');
        },
      },
      verifierId: 'adapter:broken',
      reason: 'verification_failed',
    },
    {
      name: '核验器超时',
      verifier: {
        id: 'adapter:slow',
        timeoutMs: 1,
        verify: async () => new Promise<never>(() => undefined),
      },
      verifierId: 'adapter:slow',
      reason: 'verification_timed_out',
    },
  ])('$name时保持未知且不写决议', async ({ verifier, verifierId, reason }) => {
    const { reconciliations, reconciler } = setup({
      current: { ...effect, reconciliationVerifierId: verifierId },
      verifiers: verifier ? [verifier] : [],
    });
    await expect(reconciler.reconcileAutomatically(target)).resolves.toEqual({
      status: 'unchanged',
      reason,
    });
    expect(reconciliations.records).toHaveLength(0);
  });
  it('拒绝非未知Effect和effectKey/semanticsHash漂移', async () => {
    const verify = vi.fn(async () => ({ status: 'indeterminate' as const }));
    for (const [current, changedTarget] of [
      [{ ...effect, status: 'committed' as const }, target],
      [effect, { ...target, effectKey: 'execution:changed' }],
      [effect, { ...target, semanticsHash: 'f'.repeat(64) }],
    ] as const) {
      const verifier = { id: 'adapter:query-v1', verify };
      const { reconciliations, reconciler } = setup({
        current,
        verifiers: [verifier],
      });
      await expect(
        reconciler.reconcileAutomatically(changedTarget),
      ).resolves.toEqual({
        status: 'unchanged',
        reason: 'effect_not_reconcilable',
      });
      expect(reconciliations.records).toHaveLength(0);
    }
    expect(verify).not.toHaveBeenCalled();
  });
});
