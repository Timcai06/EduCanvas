import type {
  ToolEffectLedgerPort,
  ToolEffectLedgerSnapshot,
  ToolEffectReconciliationPort,
  ToolEffectReconciliationResolution,
  ToolEffectReconciliationSnapshot,
} from '@educanvas/agent-core';
import {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  MAX_VERIFICATION_TIMEOUT_MS,
  runEffectVerifier,
  type ToolEffectVerificationVerdict,
  type ToolEffectVerifier,
} from './reconciliation-verifier';
import {
  assertSafeResolverId,
  assertValidReconciliationResolution,
  isValidReconciliationPrincipal,
} from './reconciliation-validation';

export type {
  ToolEffectVerificationInput,
  ToolEffectVerificationVerdict,
  ToolEffectVerifier,
} from './reconciliation-verifier';

export interface ToolEffectReconciliationTarget {
  operationId: string;
  actorId: string;
  effectId: string;
  effectKey: string;
  semanticsHash: string;
}

export type ToolEffectReconcileResult =
  | {
      status: 'recorded';
      reconciliation: ToolEffectReconciliationSnapshot;
      recorded: boolean;
    }
  | {
      status: 'unchanged';
      reason:
        | 'effect_not_reconcilable'
        | 'manual_authorization_denied'
        | 'manual_authorization_failed'
        | 'verifier_unavailable'
        | 'verification_failed'
        | 'verification_timed_out'
        | 'verification_indeterminate';
    };

export interface ManualToolEffectReconciliation extends ToolEffectReconciliationTarget {
  resolution: ToolEffectReconciliationResolution;
  principal: ToolEffectReconciliationPrincipal;
  evidenceHash: string;
  receiptHash?: string | null;
  code?: string | null;
}

interface ToolEffectReconciliationDecision extends ToolEffectReconciliationTarget {
  resolution: ToolEffectReconciliationResolution;
  resolverId: string;
  evidenceHash: string;
  receiptHash?: string | null;
  code?: string | null;
  source: 'manual' | 'adapter';
}

export interface ToolEffectReconciliationPrincipal {
  kind: 'operator' | 'service';
  subjectId: string;
}

/** 人工决议的必需授权边界；实现必须基于服务端身份，不得采信学生或模型声明。 */
export interface ToolEffectReconciliationAuthorizerPort {
  authorize(input: {
    principal: ToolEffectReconciliationPrincipal;
    target: ToolEffectReconciliationTarget;
  }): Promise<boolean>;
}

/**
 * 为outcome_unknown write effect追加人工或受信Adapter决议。
 * 本服务不持有Tool Adapter，也不改变Effect、Tool Call或Operation的既有终态。
 */
export class ToolEffectReconciler {
  private readonly verifiers = new Map<string, ToolEffectVerifier>();

  constructor(
    private readonly effects: ToolEffectLedgerPort,
    private readonly reconciliations: ToolEffectReconciliationPort,
    private readonly manualAuthorizer: ToolEffectReconciliationAuthorizerPort,
    verifiers: readonly ToolEffectVerifier[] = [],
  ) {
    for (const verifier of verifiers) {
      assertSafeResolverId(verifier.id);
      if (this.verifiers.has(verifier.id)) {
        throw new Error('effect_verifier_duplicate');
      }
      this.verifiers.set(verifier.id, verifier);
    }
  }

  async reconcileManually(
    input: ManualToolEffectReconciliation,
  ): Promise<ToolEffectReconcileResult> {
    if (!isValidReconciliationPrincipal(input.principal)) {
      return unchanged('manual_authorization_denied');
    }
    let authorized: boolean;
    try {
      authorized = await this.manualAuthorizer.authorize({
        principal: input.principal,
        target: reconciliationTarget(input),
      });
    } catch {
      return unchanged('manual_authorization_failed');
    }
    if (!authorized) return unchanged('manual_authorization_denied');
    const resolverId = `${input.principal.kind}:${input.principal.subjectId}`;
    assertValidReconciliationResolution({ ...input, resolverId });
    const effect = await this.loadReconcilableEffect(input);
    if (!effect) return unchanged('effect_not_reconcilable');
    return this.record(effect, {
      ...input,
      resolverId,
      source: 'manual',
    });
  }

  async reconcileAutomatically(
    input: ToolEffectReconciliationTarget,
  ): Promise<ToolEffectReconcileResult> {
    const effect = await this.loadReconcilableEffect(input);
    if (!effect) return unchanged('effect_not_reconcilable');
    const verifier = effect.reconciliationVerifierId
      ? this.verifiers.get(effect.reconciliationVerifierId)
      : undefined;
    if (!verifier) return unchanged('verifier_unavailable');
    const timeoutMs = verifier.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > MAX_VERIFICATION_TIMEOUT_MS
    ) {
      return unchanged('verification_failed');
    }
    const verified = await runEffectVerifier(verifier, effect, timeoutMs);
    if (verified.status !== 'verified') return unchanged(verified.reason);
    const verdict = verified.verdict;
    if (verdict.status === 'indeterminate') {
      return unchanged('verification_indeterminate');
    }
    const resolution: ToolEffectReconciliationResolution =
      verdict.status === 'committed'
        ? 'confirmed_committed'
        : 'confirmed_not_committed';
    const decision = {
      ...input,
      resolution,
      source: 'adapter' as const,
      resolverId: verifier.id,
      evidenceHash: verdict.evidenceHash,
      receiptHash:
        verdict.status === 'committed' ? verdict.receiptHash : undefined,
      code: verdict.status === 'not_committed' ? verdict.code : undefined,
    };
    assertValidReconciliationResolution(decision);
    return this.record(effect, decision);
  }

  private async loadReconcilableEffect(
    input: ToolEffectReconciliationTarget,
  ): Promise<ToolEffectLedgerSnapshot | null> {
    const effect = await this.effects.get({
      operationId: input.operationId,
      actorId: input.actorId,
      effectKey: input.effectKey,
    });
    return effect?.id === input.effectId &&
      effect.operationId === input.operationId &&
      effect.effectKey === input.effectKey &&
      effect.semanticsHash === input.semanticsHash &&
      effect.status === 'outcome_unknown'
      ? effect
      : null;
  }

  private async record(
    effect: ToolEffectLedgerSnapshot,
    input: ToolEffectReconciliationDecision,
  ): Promise<ToolEffectReconcileResult> {
    const result = await this.reconciliations.record({
      operationId: input.operationId,
      actorId: input.actorId,
      effectId: effect.id,
      expectedEffectKey: effect.effectKey,
      expectedSemanticsHash: effect.semanticsHash,
      resolution: input.resolution,
      source: input.source,
      resolverId: input.resolverId,
      evidenceHash: input.evidenceHash,
      receiptHash: input.receiptHash,
      code: input.code,
    });
    return { status: 'recorded', ...result };
  }
}

function reconciliationTarget(
  input: ToolEffectReconciliationTarget,
): ToolEffectReconciliationTarget {
  return {
    operationId: input.operationId,
    actorId: input.actorId,
    effectId: input.effectId,
    effectKey: input.effectKey,
    semanticsHash: input.semanticsHash,
  };
}

function unchanged(
  reason: Extract<ToolEffectReconcileResult, { status: 'unchanged' }>['reason'],
): ToolEffectReconcileResult {
  return { status: 'unchanged', reason };
}
