import {
  ToolEffectReconciler,
  type ToolEffectReconciliationPrincipal,
  type ToolEffectReconcileResult,
} from '@educanvas/agent-runtime';
import {
  DrizzleToolEffectReconciliationRepository,
  DrizzleToolEffectRepository,
} from '@educanvas/db';
import { z } from 'zod';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_CODE_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/;
const INTERNAL_RECONCILIATION_SUBJECT = 'gateway-effect-reconciliation';
const RECONCILIATION_PRINCIPAL_HEADER = 'x-educanvas-reconciliation-principal';

const reconciliationRequestSchema = z
  .object({
    operationId: z.uuid(),
    actorId: z.string().min(1).max(160),
    effectId: z.uuid(),
    effectKey: z.string().regex(SAFE_ID_PATTERN),
    semanticsHash: z.string().regex(SHA256_PATTERN),
    resolution: z.enum(['confirmed_committed', 'confirmed_not_committed']),
    evidenceHash: z.string().regex(SHA256_PATTERN),
    receiptHash: z.string().regex(SHA256_PATTERN).nullish(),
    code: z.string().regex(SAFE_CODE_PATTERN).nullish(),
  })
  .strict()
  .superRefine((input, context) => {
    const committed = input.resolution === 'confirmed_committed';
    if (
      (committed && input.code != null) ||
      (!committed && (input.code == null || input.receiptHash != null))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Effect reconciliation决议形状无效',
      });
    }
  });

export type GatewayEffectReconciliationRequest = z.infer<
  typeof reconciliationRequestSchema
>;

interface ManualEffectReconciler {
  reconcileManually(
    input: GatewayEffectReconciliationRequest & {
      principal: ToolEffectReconciliationPrincipal;
    },
  ): Promise<ToolEffectReconcileResult>;
}

/**
 * Gateway内部Effect对账控制面。调用方只能提交稳定目标与哈希证据，
 * resolver来自已通过Internal token的请求上下文，不能由请求体伪造。
 */
export class GatewayEffectReconciliationControl {
  constructor(private readonly reconciler: ManualEffectReconciler) {}

  reconcile(
    raw: unknown,
    principal: ToolEffectReconciliationPrincipal,
  ): Promise<ToolEffectReconcileResult> {
    const input = reconciliationRequestSchema.parse(raw);
    return this.reconciler.reconcileManually({
      ...input,
      principal,
    });
  }
}

/**
 * 解析Internal transport携带的审计主体。缺少header时使用固定Gateway service；
 * operator身份只能由持有Internal token的受信代理注入，普通请求体无此能力。
 */
export function resolveGatewayEffectReconciliationPrincipal(
  raw: string | string[] | undefined,
): ToolEffectReconciliationPrincipal {
  if (raw === undefined) {
    return {
      kind: 'service',
      subjectId: INTERNAL_RECONCILIATION_SUBJECT,
    };
  }
  if (Array.isArray(raw) || raw.length > 160) {
    throw new Error('EFFECT_RECONCILIATION_PRINCIPAL_INVALID');
  }
  const separator = raw.indexOf(':');
  const kind = raw.slice(0, separator);
  const subjectId = raw.slice(separator + 1);
  const resolverId = `${kind}:${subjectId}`;
  if (
    separator < 1 ||
    (kind !== 'operator' && kind !== 'service') ||
    !SAFE_ID_PATTERN.test(subjectId) ||
    !SAFE_ID_PATTERN.test(resolverId)
  ) {
    throw new Error('EFFECT_RECONCILIATION_PRINCIPAL_INVALID');
  }
  return { kind, subjectId };
}

/** Internal transport用于传递受信对账审计主体的header名。 */
export const gatewayEffectReconciliationPrincipalHeader =
  RECONCILIATION_PRINCIPAL_HEADER;

/** 生产组合只开放人工追加决议；自动Verifier必须由具体Adapter另行提供可信查询契约。 */
export function createGatewayEffectReconciliationControl(): GatewayEffectReconciliationControl {
  return new GatewayEffectReconciliationControl(
    new ToolEffectReconciler(
      new DrizzleToolEffectRepository(),
      new DrizzleToolEffectReconciliationRepository(),
      {
        async authorize(input) {
          return (
            (input.principal.kind === 'operator' ||
              input.principal.kind === 'service') &&
            SAFE_ID_PATTERN.test(input.principal.subjectId) &&
            SAFE_ID_PATTERN.test(
              `${input.principal.kind}:${input.principal.subjectId}`,
            )
          );
        },
      },
    ),
  );
}
