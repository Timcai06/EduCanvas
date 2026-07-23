import type {
  ToolEffectLedgerPort,
  ToolEffectReconciliationPort,
} from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';
import {
  ToolEffectReconciler,
  type ToolEffectReconciliationAuthorizerPort,
} from './tool-kernel';

const target = {
  operationId: '20000000-0000-4000-8000-000000000001',
  actorId: 'user:effect-owner',
  effectId: '10000000-0000-4000-8000-000000000001',
  effectKey: 'execution:effect-1',
  semanticsHash: 'a'.repeat(64),
};

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
    reconciliationVerifierId: null,
    status: 'outcome_unknown',
    code: 'write_outcome_unknown',
    receiptHash: null,
    intendedAt: '2026-07-23T00:00:00.000Z',
    settledAt: '2026-07-23T00:00:05.000Z',
  }),
};

describe('Tool Effect人工对账授权', () => {
  it.each([
    {
      name: '授权拒绝',
      authorizer: { authorize: async () => false },
      reason: 'manual_authorization_denied',
    },
    {
      name: '授权器异常',
      authorizer: {
        authorize: async () => {
          throw new Error('private_authorizer_error');
        },
      },
      reason: 'manual_authorization_failed',
    },
  ])('$name时保持未知且不写决议', async ({ authorizer, reason }) => {
    const record = vi.fn();
    const reconciliations = {
      get: async () => null,
      record,
    } as ToolEffectReconciliationPort;
    const reconciler = new ToolEffectReconciler(
      effects,
      reconciliations,
      authorizer as ToolEffectReconciliationAuthorizerPort,
    );

    await expect(
      reconciler.reconcileManually({
        ...target,
        resolution: 'confirmed_committed',
        principal: { kind: 'service', subjectId: 'effect-ops' },
        evidenceHash: 'e'.repeat(64),
      }),
    ).resolves.toEqual({ status: 'unchanged', reason });
    expect(record).not.toHaveBeenCalled();
  });
});
