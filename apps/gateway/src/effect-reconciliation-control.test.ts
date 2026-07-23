import { describe, expect, it, vi } from 'vitest';
import { GatewayEffectReconciliationControl } from './effect-reconciliation-control';

const request = {
  operationId: '00000000-0000-4000-8000-000000000001',
  actorId: 'user:1',
  effectId: '00000000-0000-4000-8000-000000000002',
  effectKey: 'execution:1',
  semanticsHash: 'a'.repeat(64),
  resolution: 'confirmed_committed' as const,
  evidenceHash: 'b'.repeat(64),
  receiptHash: 'c'.repeat(64),
};

describe('GatewayEffectReconciliationControl', () => {
  it('使用受信上下文resolver身份且请求体不能伪造principal', async () => {
    const reconcileManually = vi.fn(async () => ({
      status: 'unchanged' as const,
      reason: 'effect_not_reconcilable' as const,
    }));
    const control = new GatewayEffectReconciliationControl({
      reconcileManually,
    });

    await expect(
      control.reconcile(request, {
        kind: 'operator',
        subjectId: 'ops-1',
      }),
    ).resolves.toEqual({
      status: 'unchanged',
      reason: 'effect_not_reconcilable',
    });
    expect(reconcileManually).toHaveBeenCalledWith({
      ...request,
      principal: {
        kind: 'operator',
        subjectId: 'ops-1',
      },
    });
    expect(() =>
      control.reconcile(
        {
          ...request,
          principal: { kind: 'operator', subjectId: 'forged' },
        },
        {
          kind: 'service',
          subjectId: 'gateway-effect-reconciliation',
        },
      ),
    ).toThrowError(expect.objectContaining({ name: 'ZodError' }));
  });

  it('拒绝正文证据和不一致的决议形状', async () => {
    const control = new GatewayEffectReconciliationControl({
      reconcileManually: vi.fn(),
    });

    expect(() =>
      control.reconcile(
        { ...request, evidence: '原始对账证据' },
        { kind: 'service', subjectId: 'gateway-effect-reconciliation' },
      ),
    ).toThrowError(expect.objectContaining({ name: 'ZodError' }));
    expect(() =>
      control.reconcile(
        {
          ...request,
          resolution: 'confirmed_not_committed',
          receiptHash: null,
          code: null,
        },
        { kind: 'service', subjectId: 'gateway-effect-reconciliation' },
      ),
    ).toThrowError(expect.objectContaining({ name: 'ZodError' }));
  });
});
