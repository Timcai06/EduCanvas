import type {
  ToolEffectLedgerPort,
  ToolEffectLedgerSnapshot,
  ToolEffectLedgerStatus,
  ToolEffectLedgerTerminalStatus,
} from '@educanvas/agent-core';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { agentOperations, toolCalls, toolEffects } from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

export class ToolEffectOwnershipError extends Error {
  readonly code = 'tool_effect_not_found';

  constructor() {
    super('Tool Effect不存在或不属于当前Actor');
    this.name = 'ToolEffectOwnershipError';
  }
}

export class ToolEffectConflictError extends Error {
  readonly code = 'tool_effect_conflict';

  constructor() {
    super('effectKey或Tool Call已绑定不同副作用语义');
    this.name = 'ToolEffectConflictError';
  }
}

export class ToolEffectLifecycleError extends Error {
  readonly code = 'invalid_tool_effect_transition';

  constructor(message: string) {
    super(message);
    this.name = 'ToolEffectLifecycleError';
  }
}

function isSafeKey(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
}

function isSafeCode(value: string): boolean {
  return /^[a-z][a-z0-9._:-]{0,127}$/.test(value);
}

function toSnapshot(
  row: typeof toolEffects.$inferSelect,
): ToolEffectLedgerSnapshot {
  return {
    id: row.id,
    operationId: row.agentOperationId,
    toolCallId: row.toolCallId,
    effectKey: row.effectKey,
    semanticsHash: row.semanticsHash,
    status: row.status as ToolEffectLedgerStatus,
    code: row.code,
    receiptHash: row.receiptHash,
    intendedAt: row.intendedAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}

async function requireOwnedEffect(
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

/** Tool Kernel的PostgreSQL effect ledger；write意图先落库，且不保存任何原始值。 */
export class DrizzleToolEffectRepository implements ToolEffectLedgerPort {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async intend(input: {
    operationId: string;
    actorId: string;
    toolCallId: string;
    effectKey: string;
    semanticsHash: string;
    now?: Date;
  }): Promise<{ effect: ToolEffectLedgerSnapshot; replayed: boolean }> {
    if (
      !isUuid(input.operationId) ||
      !isUuid(input.toolCallId) ||
      input.actorId.length < 1 ||
      input.actorId.length > 160 ||
      !isSafeKey(input.effectKey) ||
      !/^[a-f0-9]{64}$/.test(input.semanticsHash)
    ) {
      throw new ToolEffectLifecycleError('Tool Effect创建参数无效');
    }
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${'tool-effect-v1:' + input.operationId + ':' + input.effectKey}, 0))`,
      );
      const [scope] = await transaction
        .select({ call: toolCalls })
        .from(toolCalls)
        .innerJoin(
          agentOperations,
          eq(agentOperations.id, toolCalls.agentOperationId),
        )
        .where(
          and(
            eq(toolCalls.id, input.toolCallId),
            eq(toolCalls.agentOperationId, input.operationId),
            eq(toolCalls.effect, 'write'),
            eq(toolCalls.status, 'running'),
            eq(agentOperations.actorUserId, input.actorId),
            eq(agentOperations.kind, 'turn'),
            inArray(agentOperations.status, ['pending', 'running']),
          ),
        )
        .limit(1);
      if (!scope) throw new ToolEffectOwnershipError();
      const existing = await transaction
        .select()
        .from(toolEffects)
        .where(
          or(
            and(
              eq(toolEffects.agentOperationId, input.operationId),
              eq(toolEffects.effectKey, input.effectKey),
            ),
            eq(toolEffects.toolCallId, input.toolCallId),
          ),
        );
      if (existing.length > 0) {
        const matching = existing.find(
          (row) =>
            row.agentOperationId === input.operationId &&
            row.toolCallId === input.toolCallId &&
            row.effectKey === input.effectKey &&
            row.semanticsHash === input.semanticsHash,
        );
        if (!matching) throw new ToolEffectConflictError();
        return { effect: toSnapshot(matching), replayed: true };
      }
      const [created] = await transaction
        .insert(toolEffects)
        .values({
          agentOperationId: input.operationId,
          toolCallId: input.toolCallId,
          effectKey: input.effectKey,
          semanticsHash: input.semanticsHash,
          intendedAt: input.now ?? new Date(),
        })
        .returning();
      if (!created) throw new Error('Tool Effect记录写入失败');
      return { effect: toSnapshot(created), replayed: false };
    });
  }

  async settle(input: {
    operationId: string;
    actorId: string;
    effectId: string;
    status: ToolEffectLedgerTerminalStatus;
    code?: string | null;
    receiptHash?: string | null;
    now?: Date;
  }): Promise<{ effect: ToolEffectLedgerSnapshot; transitioned: boolean }> {
    if (
      !['committed', 'failed', 'outcome_unknown'].includes(input.status) ||
      (input.status === 'committed' && input.code) ||
      (input.status !== 'committed' && !isSafeCode(input.code ?? '')) ||
      (input.status !== 'committed' && input.receiptHash) ||
      (input.receiptHash !== undefined &&
        input.receiptHash !== null &&
        !/^[a-f0-9]{64}$/.test(input.receiptHash))
    ) {
      throw new ToolEffectLifecycleError('Tool Effect终态参数无效');
    }
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const effect = await requireOwnedEffect(transaction, input);
      const [updated] = await transaction
        .update(toolEffects)
        .set({
          status: input.status,
          code: input.status === 'committed' ? null : (input.code ?? null),
          receiptHash:
            input.status === 'committed' ? (input.receiptHash ?? null) : null,
          settledAt: now,
        })
        .where(
          and(
            eq(toolEffects.id, effect.id),
            eq(toolEffects.status, 'intended'),
          ),
        )
        .returning();
      if (updated) return { effect: toSnapshot(updated), transitioned: true };
      const current = await requireOwnedEffect(transaction, input);
      if (
        current.status !== input.status ||
        current.code !==
          (input.status === 'committed' ? null : (input.code ?? null)) ||
        current.receiptHash !==
          (input.status === 'committed' ? (input.receiptHash ?? null) : null)
      ) {
        throw new ToolEffectConflictError();
      }
      return { effect: toSnapshot(current), transitioned: false };
    });
  }

  async get(input: {
    operationId: string;
    actorId: string;
    effectKey: string;
  }): Promise<ToolEffectLedgerSnapshot | null> {
    if (
      !isUuid(input.operationId) ||
      input.actorId.length < 1 ||
      input.actorId.length > 160 ||
      !isSafeKey(input.effectKey)
    ) {
      throw new ToolEffectOwnershipError();
    }
    const [owned] = await this.database
      .select({ id: agentOperations.id })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, input.operationId),
          eq(agentOperations.actorUserId, input.actorId),
        ),
      )
      .limit(1);
    if (!owned) throw new ToolEffectOwnershipError();
    const [row] = await this.database
      .select()
      .from(toolEffects)
      .where(
        and(
          eq(toolEffects.agentOperationId, input.operationId),
          eq(toolEffects.effectKey, input.effectKey),
        ),
      )
      .limit(1);
    return row ? toSnapshot(row) : null;
  }
}
