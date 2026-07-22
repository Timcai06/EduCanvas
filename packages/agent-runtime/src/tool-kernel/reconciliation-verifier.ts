import type { ToolEffectLedgerSnapshot } from '@educanvas/agent-core';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_CODE_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/;
export const DEFAULT_VERIFICATION_TIMEOUT_MS = 5_000;
export const MAX_VERIFICATION_TIMEOUT_MS = 30_000;

/** 自动核验器可见的全部数据；有意排除参数、输出、Actor和Credential。 */
export interface ToolEffectVerificationInput {
  effectId: string;
  operationId: string;
  toolCallId: string;
  effectKey: string;
  semanticsHash: string;
  intendedAt: string;
  settledAt: string;
}

export type ToolEffectVerificationVerdict =
  | {
      status: 'committed';
      evidenceHash: string;
      receiptHash?: string | null;
    }
  | { status: 'not_committed'; evidenceHash: string; code: string }
  | { status: 'indeterminate' };

/** 可选受信查询能力；verify只能查证既有副作用，绝不能重新执行工具。 */
export interface ToolEffectVerifier {
  id: string;
  timeoutMs?: number;
  verify(
    input: Readonly<ToolEffectVerificationInput>,
    signal: AbortSignal,
  ): Promise<ToolEffectVerificationVerdict> | ToolEffectVerificationVerdict;
}

export async function runEffectVerifier(
  verifier: ToolEffectVerifier,
  effect: ToolEffectLedgerSnapshot,
  timeoutMs: number,
): Promise<
  | { status: 'verified'; verdict: ToolEffectVerificationVerdict }
  | {
      status: 'failed';
      reason: 'verification_failed' | 'verification_timed_out';
    }
> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort('tool_effect_verification_timeout');
      reject(new Error('tool_effect_verification_timeout'));
    }, timeoutMs);
  });
  try {
    const verdict = await Promise.race([
      Promise.resolve(
        verifier.verify(
          Object.freeze({
            effectId: effect.id,
            operationId: effect.operationId,
            toolCallId: effect.toolCallId,
            effectKey: effect.effectKey,
            semanticsHash: effect.semanticsHash,
            intendedAt: effect.intendedAt,
            settledAt: effect.settledAt!,
          }),
          controller.signal,
        ),
      ),
      timeout,
    ]);
    return isVerificationVerdict(verdict)
      ? { status: 'verified', verdict }
      : { status: 'failed', reason: 'verification_failed' };
  } catch {
    return {
      status: 'failed',
      reason:
        controller.signal.aborted &&
        controller.signal.reason === 'tool_effect_verification_timeout'
          ? 'verification_timed_out'
          : 'verification_failed',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isVerificationVerdict(
  value: unknown,
): value is ToolEffectVerificationVerdict {
  if (!value || typeof value !== 'object') return false;
  const verdict = value as Record<string, unknown>;
  if (verdict.status === 'indeterminate') return true;
  if (!SHA256_PATTERN.test(String(verdict.evidenceHash ?? ''))) return false;
  if (verdict.status === 'committed') {
    return (
      verdict.receiptHash == null ||
      SHA256_PATTERN.test(String(verdict.receiptHash))
    );
  }
  return (
    verdict.status === 'not_committed' &&
    SAFE_CODE_PATTERN.test(String(verdict.code ?? ''))
  );
}
