import type { ToolEffectReconciliationResolution } from '@educanvas/agent-core';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_CODE_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/;

/** 审计身份只允许可安全持久化和记录的稳定ID。 */
export function assertSafeResolverId(value: string): void {
  if (!SAFE_ID_PATTERN.test(value))
    throw new Error('effect_resolver_id_invalid');
}

/** principal与派生resolverId必须同时满足160字符上限。 */
export function isValidReconciliationPrincipal(input: {
  kind: string;
  subjectId: string;
}): boolean {
  return (
    (input.kind === 'operator' || input.kind === 'service') &&
    SAFE_ID_PATTERN.test(input.subjectId) &&
    SAFE_ID_PATTERN.test(`${input.kind}:${input.subjectId}`)
  );
}

/** 决议只接受哈希证据，并强制成功回执与未提交原因互斥。 */
export function assertValidReconciliationResolution(input: {
  resolution: ToolEffectReconciliationResolution;
  resolverId: string;
  evidenceHash: string;
  receiptHash?: string | null;
  code?: string | null;
}): void {
  assertSafeResolverId(input.resolverId);
  if (!SHA256_PATTERN.test(input.evidenceHash)) {
    throw new Error('effect_reconciliation_evidence_invalid');
  }
  const committed = input.resolution === 'confirmed_committed';
  if (
    (committed && input.code != null) ||
    (!committed &&
      (!SAFE_CODE_PATTERN.test(input.code ?? '') ||
        input.receiptHash != null)) ||
    (input.receiptHash != null && !SHA256_PATTERN.test(input.receiptHash))
  ) {
    throw new Error('effect_reconciliation_resolution_invalid');
  }
}
