import type {
  ToolEffectLedgerPort,
  ToolEffectLedgerSnapshot,
  ToolEffectLedgerTerminalStatus,
} from '@educanvas/agent-core';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { agentOperations, toolCalls, toolEffects } from './schema';
import {
  type IntendInput,
  isSafeEffectCode,
  isSafeEffectKey,
  requireOwnedToolEffect,
  ToolEffectConflictError,
  type ToolEffectDatabase,
  ToolEffectLifecycleError,
  ToolEffectOwnershipError,
  type ToolEffectSnapshot,
  toToolEffectSnapshot,
} from './tool-effect-persistence';

export {
  ToolEffectConflictError,
  ToolEffectLifecycleError,
  ToolEffectOwnershipError,
} from './tool-effect-persistence';

/** Tool Kernel的PostgreSQL effect ledger；write意图先落库，且不保存任何原始值。 */
export class DrizzleToolEffectRepository implements ToolEffectLedgerPort {
  constructor(private readonly providedDatabase?: ToolEffectDatabase) {}

  private get database(): ToolEffectDatabase {
    return this.providedDatabase ?? getDb();
  }

  async intend(
    input: IntendInput,
  ): Promise<{ effect: ToolEffectSnapshot; replayed: boolean }> {
    if (
      !isUuid(input.operationId) ||
      !isUuid(input.toolCallId) ||
      input.actorId.length < 1 ||
      input.actorId.length > 160 ||
      !isSafeEffectKey(input.effectKey) ||
      !/^[a-f0-9]{64}$/.test(input.semanticsHash) ||
      (input.reconciliationVerifierId != null &&
        !isSafeEffectKey(input.reconciliationVerifierId))
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
            row.semanticsHash === input.semanticsHash &&
            row.reconciliationVerifierId ===
              (input.reconciliationVerifierId ?? null),
        );
        if (!matching) throw new ToolEffectConflictError();
        return { effect: toToolEffectSnapshot(matching), replayed: true };
      }
      const [created] = await transaction
        .insert(toolEffects)
        .values({
          agentOperationId: input.operationId,
          toolCallId: input.toolCallId,
          effectKey: input.effectKey,
          semanticsHash: input.semanticsHash,
          reconciliationVerifierId: input.reconciliationVerifierId ?? null,
          intendedAt: input.now ?? new Date(),
        })
        .returning();
      if (!created) throw new Error('Tool Effect记录写入失败');
      return { effect: toToolEffectSnapshot(created), replayed: false };
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
      (input.status !== 'committed' && !isSafeEffectCode(input.code ?? '')) ||
      (input.status !== 'committed' && input.receiptHash) ||
      (input.receiptHash !== undefined &&
        input.receiptHash !== null &&
        !/^[a-f0-9]{64}$/.test(input.receiptHash))
    ) {
      throw new ToolEffectLifecycleError('Tool Effect终态参数无效');
    }
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const effect = await requireOwnedToolEffect(transaction, input);
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
      if (updated) {
        return { effect: toToolEffectSnapshot(updated), transitioned: true };
      }
      const current = await requireOwnedToolEffect(transaction, input);
      if (
        current.status !== input.status ||
        current.code !==
          (input.status === 'committed' ? null : (input.code ?? null)) ||
        current.receiptHash !==
          (input.status === 'committed' ? (input.receiptHash ?? null) : null)
      ) {
        throw new ToolEffectConflictError();
      }
      return { effect: toToolEffectSnapshot(current), transitioned: false };
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
      !isSafeEffectKey(input.effectKey)
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
    return row ? toToolEffectSnapshot(row) : null;
  }
}
