import type {
  ToolEffectLedgerPort,
  ToolEffectLedgerSnapshot,
  ToolEffectLedgerStatus,
} from '@educanvas/agent-core';
import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { agentOperations, toolEffects } from './schema';

/** @internal Effect仓储使用的数据库边界。 */
export type ToolEffectDatabase = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<ToolEffectDatabase['transaction']>[0]
>[0];
type DatabaseExecutor = ToolEffectDatabase | DatabaseTransaction;

/** @internal DB快照补充冻结的决议Verifier身份。 */
export type ToolEffectSnapshot = ToolEffectLedgerSnapshot & {
  reconciliationVerifierId: string | null;
};

/** @internal DB实现允许冻结Verifier身份并注入测试时间。 */
export type IntendInput = Parameters<ToolEffectLedgerPort['intend']>[0] & {
  reconciliationVerifierId?: string | null;
  now?: Date;
};

/** Effect不存在或不属于当前Actor。 */
export class ToolEffectOwnershipError extends Error {
  readonly code = 'tool_effect_not_found';

  constructor() {
    super('Tool Effect不存在或不属于当前Actor');
    this.name = 'ToolEffectOwnershipError';
  }
}

/** Effect已绑定不同的副作用语义或Verifier身份。 */
export class ToolEffectConflictError extends Error {
  readonly code = 'tool_effect_conflict';

  constructor() {
    super('effectKey、Tool Call或Verifier已绑定不同副作用语义');
    this.name = 'ToolEffectConflictError';
  }
}

/** Effect输入或状态迁移不合法。 */
export class ToolEffectLifecycleError extends Error {
  readonly code = 'invalid_tool_effect_transition';

  constructor(message: string) {
    super(message);
    this.name = 'ToolEffectLifecycleError';
  }
}

/** @internal 校验可持久化的稳定安全标识。 */
export function isSafeEffectKey(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
}

/** @internal 校验稳定错误码。 */
export function isSafeEffectCode(value: string): boolean {
  return /^[a-z][a-z0-9._:-]{0,127}$/.test(value);
}

/** @internal 将Effect行转换为Port快照。 */
export function toToolEffectSnapshot(
  row: typeof toolEffects.$inferSelect,
): ToolEffectSnapshot {
  return {
    id: row.id,
    operationId: row.agentOperationId,
    toolCallId: row.toolCallId,
    effectKey: row.effectKey,
    semanticsHash: row.semanticsHash,
    reconciliationVerifierId: row.reconciliationVerifierId,
    status: row.status as ToolEffectLedgerStatus,
    code: row.code,
    receiptHash: row.receiptHash,
    intendedAt: row.intendedAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}

/** @internal 在访问Effect前统一验证Operation与Actor归属。 */
export async function requireOwnedToolEffect(
  executor: DatabaseExecutor,
  input: { operationId: string; actorId: string; effectId: string },
) {
  if (
    !isUuid(input.operationId) ||
    !isUuid(input.effectId) ||
    input.actorId.length < 1 ||
    input.actorId.length > 160
  ) {
    throw new ToolEffectOwnershipError();
  }
  const [row] = await executor
    .select({ effect: toolEffects })
    .from(toolEffects)
    .innerJoin(
      agentOperations,
      eq(agentOperations.id, toolEffects.agentOperationId),
    )
    .where(
      and(
        eq(toolEffects.id, input.effectId),
        eq(toolEffects.agentOperationId, input.operationId),
        eq(agentOperations.actorUserId, input.actorId),
      ),
    )
    .limit(1);
  if (!row) throw new ToolEffectOwnershipError();
  return row.effect;
}
