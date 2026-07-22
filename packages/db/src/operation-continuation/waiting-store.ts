import {
  createOperationContinuationInputSchema,
  operationContinuationProtocolVersion,
  type CreateOperationContinuationInput,
  type OperationContinuationSnapshot,
} from '@educanvas/agent-core';
import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { isUuid } from '../internal/identifiers';
import { gatewayApprovals, operationContinuations, toolCalls } from '../schema';
import {
  OperationContinuationConflictError,
  OperationContinuationLifecycleError,
  OperationContinuationOwnershipError,
} from './contracts';
import {
  type ContinuationDatabase,
  isSafeOpaqueId,
  requireOwnedContinuation,
  requireOwnedOperation,
  toContinuationSnapshot,
} from './persistence';

export async function createWaitingContinuation(
  database: ContinuationDatabase,
  rawInput: CreateOperationContinuationInput & { now?: Date },
): Promise<{
  continuation: OperationContinuationSnapshot;
  replayed: boolean;
}> {
  const { now: _now, ...payload } = rawInput;
  const input = createOperationContinuationInputSchema.parse(payload);
  if (!isUuid(input.operationId) || !isUuid(input.work.toolCallId)) {
    throw new OperationContinuationLifecycleError(
      'Operation与Tool Call必须使用UUID',
    );
  }
  const now = rawInput.now ?? new Date();
  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'operation-continuation-v1:' + input.operationId}, 0))`,
    );
    const operation = await requireOwnedOperation(transaction, input);
    if (operation.status !== 'running' || operation.cancelRequestedAt) {
      throw new OperationContinuationLifecycleError(
        '只有未取消的running Operation可以创建continuation',
      );
    }
    const [call] = await transaction
      .select({ id: toolCalls.id })
      .from(toolCalls)
      .where(
        and(
          eq(toolCalls.id, input.work.toolCallId),
          eq(toolCalls.agentOperationId, input.operationId),
          eq(toolCalls.status, 'pending'),
        ),
      )
      .limit(1);
    if (!call) throw new OperationContinuationOwnershipError();

    const existing = await transaction
      .select()
      .from(operationContinuations)
      .where(
        or(
          eq(operationContinuations.approvalId, input.approvalId),
          eq(operationContinuations.toolCallId, input.work.toolCallId),
          and(
            eq(operationContinuations.adapterSource, input.work.adapterSource),
            eq(operationContinuations.resumeRef, input.work.resumeRef),
          ),
        ),
      );
    if (existing.length > 0) {
      const matching = existing.find(
        (row) =>
          row.operationId === input.operationId &&
          row.approvalId === input.approvalId &&
          row.toolCallId === input.work.toolCallId &&
          row.adapterSource === input.work.adapterSource &&
          row.resumeRef === input.work.resumeRef,
      );
      if (!matching) throw new OperationContinuationConflictError();
      return {
        continuation: toContinuationSnapshot(matching),
        replayed: true,
      };
    }
    const [latest] = await transaction
      .select({
        sequence: operationContinuations.sequence,
        status: operationContinuations.status,
      })
      .from(operationContinuations)
      .where(eq(operationContinuations.operationId, input.operationId))
      .orderBy(desc(operationContinuations.sequence))
      .limit(1);
    if (
      latest &&
      ['waiting_approval', 'ready', 'running'].includes(latest.status)
    ) {
      throw new OperationContinuationConflictError(
        'Operation已有活动continuation',
      );
    }
    const sequence = (latest?.sequence ?? 0) + 1;
    if (sequence > 1_000) {
      throw new OperationContinuationLifecycleError(
        '单个Operation的continuation数量超过上限',
      );
    }
    const [created] = await transaction
      .insert(operationContinuations)
      .values({
        operationId: input.operationId,
        sequence,
        protocolVersion: operationContinuationProtocolVersion,
        kind: 'tool_approval',
        step: input.work.step,
        approvalId: input.approvalId,
        toolCallId: input.work.toolCallId,
        adapterSource: input.work.adapterSource,
        resumeRef: input.work.resumeRef,
        traceParent: input.traceCarrier?.traceparent ?? null,
        status: 'waiting_approval',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error('Operation continuation写入失败');
    return {
      continuation: toContinuationSnapshot(created),
      replayed: false,
    };
  });
}

export async function getOwnedContinuation(
  database: ContinuationDatabase,
  input: { continuationId: string; actorId: string },
): Promise<OperationContinuationSnapshot | null> {
  return toContinuationSnapshot(
    await requireOwnedContinuation(database, input),
  );
}

export async function getActiveContinuation(
  database: ContinuationDatabase,
  input: { operationId: string; actorId: string },
): Promise<OperationContinuationSnapshot | null> {
  await requireOwnedOperation(database, input);
  const [row] = await database
    .select()
    .from(operationContinuations)
    .where(
      and(
        eq(operationContinuations.operationId, input.operationId),
        inArray(operationContinuations.status, [
          'waiting_approval',
          'ready',
          'running',
        ]),
      ),
    )
    .limit(1);
  return row ? toContinuationSnapshot(row) : null;
}

export async function markContinuationReady(
  database: ContinuationDatabase,
  input: {
    continuationId: string;
    actorId: string;
    approvalId: string;
    now?: Date;
  },
): Promise<{
  continuation: OperationContinuationSnapshot;
  transitioned: boolean;
}> {
  if (!isSafeOpaqueId(input.approvalId)) {
    throw new OperationContinuationLifecycleError('approvalId无效');
  }
  const now = input.now ?? new Date();
  return database.transaction(async (transaction) => {
    const continuation = await requireOwnedContinuation(transaction, input);
    const operation = await requireOwnedOperation(transaction, {
      operationId: continuation.operationId,
      actorId: input.actorId,
    });
    if (operation.status !== 'running' || operation.cancelRequestedAt) {
      throw new OperationContinuationLifecycleError(
        'Operation不再允许继续执行',
      );
    }
    if (continuation.approvalId !== input.approvalId) {
      throw new OperationContinuationConflictError('approvalId不匹配');
    }
    if (continuation.status !== 'waiting_approval') {
      return {
        continuation: toContinuationSnapshot(continuation),
        transitioned: false,
      };
    }
    const [approval] = await transaction
      .select({ id: gatewayApprovals.id })
      .from(gatewayApprovals)
      .where(
        and(
          eq(gatewayApprovals.id, input.approvalId),
          eq(gatewayApprovals.operationId, continuation.operationId),
          eq(gatewayApprovals.actorUserId, input.actorId),
          eq(gatewayApprovals.status, 'approved'),
          gt(gatewayApprovals.expiresAt, now),
        ),
      )
      .limit(1);
    if (!approval) {
      throw new OperationContinuationLifecycleError(
        '只有服务端已记录approved的审批可以唤醒continuation',
      );
    }
    const [updated] = await transaction
      .update(operationContinuations)
      .set({ status: 'ready', updatedAt: now })
      .where(
        and(
          eq(operationContinuations.id, input.continuationId),
          eq(operationContinuations.status, 'waiting_approval'),
        ),
      )
      .returning();
    if (updated) {
      return {
        continuation: toContinuationSnapshot(updated),
        transitioned: true,
      };
    }
    const current = await requireOwnedContinuation(transaction, input);
    if (current.status === 'waiting_approval') {
      throw new OperationContinuationConflictError();
    }
    return {
      continuation: toContinuationSnapshot(current),
      transitioned: false,
    };
  });
}
