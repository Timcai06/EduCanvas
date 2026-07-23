import type {
  ToolEffectReconciliationPort,
  ToolEffectReconciliationSnapshot,
} from '@educanvas/agent-core';
import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { agentOperations, toolEffects } from './schema';
import { toolEffectReconciliations } from './schema/tool-effect-reconciliation';

/** @internal 对账仓储与持久化辅助函数共享的数据库执行边界。 */
export type ReconciliationDatabase = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<ReconciliationDatabase['transaction']>[0]
>[0];
type DatabaseExecutor = ReconciliationDatabase | DatabaseTransaction;
/** @internal PostgreSQL实现额外接受可注入时间，公共Port不暴露该测试边界。 */
export type RecordReconciliationInput = Parameters<
  ToolEffectReconciliationPort['record']
>[0] & { now?: Date };

/** 不存在、跨Actor或伪造Operation统一返回同一错误，避免泄露Effect身份。 */
export class ToolEffectReconciliationOwnershipError extends Error {
  readonly code = 'tool_effect_reconciliation_not_found';

  constructor() {
    super('Tool Effect reconciliation不存在或不属于当前Actor');
    this.name = 'ToolEffectReconciliationOwnershipError';
  }
}

/** 已有决议或Effect稳定语义与本次写入不同。 */
export class ToolEffectReconciliationConflictError extends Error {
  readonly code = 'tool_effect_reconciliation_conflict';

  constructor() {
    super('Tool Effect reconciliation已绑定不同决议语义');
    this.name = 'ToolEffectReconciliationConflictError';
  }
}

/** 只有 outcome_unknown Effect 可以追加权威决议。 */
export class ToolEffectReconciliationLifecycleError extends Error {
  readonly code = 'invalid_tool_effect_reconciliation';

  constructor(message: string) {
    super(message);
    this.name = 'ToolEffectReconciliationLifecycleError';
  }
}

function isSafeId(value: string, max = 160): boolean {
  return value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function isHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function isSafeCode(value: string): boolean {
  return /^[a-z][a-z0-9._:-]{0,127}$/.test(value);
}

/** @internal 在任何数据库读取或写入前收敛决议的稳定标识与证据形状。 */
export function validateReconciliationInput(
  input: RecordReconciliationInput,
): void {
  const receiptHash = input.receiptHash ?? null;
  const code = input.code ?? null;
  const shapeIsValid =
    (input.resolution === 'confirmed_committed' && code === null) ||
    (input.resolution === 'confirmed_not_committed' &&
      receiptHash === null &&
      code !== null &&
      isSafeCode(code));
  if (
    !isUuid(input.operationId) ||
    !isUuid(input.effectId) ||
    input.actorId.length < 1 ||
    input.actorId.length > 160 ||
    !isSafeId(input.expectedEffectKey) ||
    !isHash(input.expectedSemanticsHash) ||
    !['confirmed_committed', 'confirmed_not_committed'].includes(
      input.resolution,
    ) ||
    !['manual', 'adapter'].includes(input.source) ||
    !isSafeId(input.resolverId) ||
    !isHash(input.evidenceHash) ||
    (receiptHash !== null && !isHash(receiptHash)) ||
    !shapeIsValid
  ) {
    throw new ToolEffectReconciliationLifecycleError('Effect决议参数无效');
  }
}

/** @internal 统一重验Operation、Actor与outcome_unknown状态，避免跨Actor身份探测。 */
export async function requireOwnedUnknownEffect(
  executor: DatabaseExecutor,
  input: { operationId: string; actorId: string; effectId: string },
) {
  if (
    !isUuid(input.operationId) ||
    !isUuid(input.effectId) ||
    input.actorId.length < 1 ||
    input.actorId.length > 160
  ) {
    throw new ToolEffectReconciliationOwnershipError();
  }
  const [effect] = await executor
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
  if (!effect) throw new ToolEffectReconciliationOwnershipError();
  if (effect.effect.status !== 'outcome_unknown') {
    throw new ToolEffectReconciliationLifecycleError(
      '只有outcome_unknown Effect可以记录决议',
    );
  }
  return effect.effect;
}

/** @internal 将追加决议与不可变Effect事实投影为公共快照。 */
export function toReconciliationSnapshot(
  row: typeof toolEffectReconciliations.$inferSelect,
  effect: typeof toolEffects.$inferSelect,
): ToolEffectReconciliationSnapshot {
  return {
    effectId: row.effectId,
    operationId: effect.agentOperationId,
    effectKey: effect.effectKey,
    semanticsHash: effect.semanticsHash,
    resolution:
      row.resolution as ToolEffectReconciliationSnapshot['resolution'],
    source: row.source as ToolEffectReconciliationSnapshot['source'],
    resolverId: row.resolverId,
    evidenceHash: row.evidenceHash,
    receiptHash: row.receiptHash,
    code: row.code,
    resolvedAt: row.resolvedAt.toISOString(),
  };
}

/** @internal 并发重放只有全部决议证据逐值相等时才视为幂等。 */
export function reconciliationMatches(
  row: typeof toolEffectReconciliations.$inferSelect,
  input: RecordReconciliationInput,
): boolean {
  return (
    row.resolution === input.resolution &&
    row.source === input.source &&
    row.resolverId === input.resolverId &&
    row.evidenceHash === input.evidenceHash &&
    row.receiptHash === (input.receiptHash ?? null) &&
    row.code === (input.code ?? null)
  );
}
