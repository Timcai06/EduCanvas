import type {
  OperationContinuationSnapshot,
  OperationContinuationTerminalStatus,
} from '@educanvas/agent-core';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { operationContinuations } from '../schema';
import {
  OperationContinuationConflictError,
  OperationContinuationLifecycleError,
  OperationContinuationOwnershipError,
} from './contracts';
import {
  type ContinuationDatabase,
  isSafeFailureCode,
  isSafeOpaqueId,
  requireOwnedContinuation,
  requireOwnedOperation,
  toContinuationSnapshot,
} from './persistence';

export async function settleContinuation(
  database: ContinuationDatabase,
  input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseGeneration: number;
    status: OperationContinuationTerminalStatus;
    failureCode?: string | null;
    now?: Date;
  },
): Promise<{
  continuation: OperationContinuationSnapshot;
  transitioned: boolean;
}> {
  const failureCode = input.failureCode ?? null;
  if (
    !['completed', 'failed'].includes(input.status) ||
    !isSafeOpaqueId(input.ownerId) ||
    !Number.isSafeInteger(input.leaseGeneration) ||
    input.leaseGeneration < 1 ||
    !(
      (input.status === 'completed' && failureCode === null) ||
      (input.status === 'failed' &&
        failureCode !== null &&
        isSafeFailureCode(failureCode))
    )
  ) {
    throw new OperationContinuationLifecycleError('continuation终态参数无效');
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
        'Operation不再允许提交continuation终态',
      );
    }
    const [updated] = await transaction
      .update(operationContinuations)
      .set({
        status: input.status,
        leaseOwnerId: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        failureCode,
        updatedAt: now,
        completedAt: now,
      })
      .where(
        and(
          eq(operationContinuations.id, input.continuationId),
          eq(operationContinuations.status, 'running'),
          eq(operationContinuations.leaseOwnerId, input.ownerId),
          eq(operationContinuations.leaseGeneration, input.leaseGeneration),
          gt(operationContinuations.leaseExpiresAt, now),
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
    if (
      current.status === input.status &&
      current.failureCode === failureCode &&
      current.leaseGeneration === input.leaseGeneration
    ) {
      return {
        continuation: toContinuationSnapshot(current),
        transitioned: false,
      };
    }
    throw new OperationContinuationConflictError('continuation终态冲突');
  });
}

export async function cancelContinuation(
  database: ContinuationDatabase,
  input: { operationId: string; actorId: string; now?: Date },
): Promise<{
  continuation: OperationContinuationSnapshot;
  transitioned: boolean;
}> {
  const now = input.now ?? new Date();
  return database.transaction(async (transaction) => {
    await requireOwnedOperation(transaction, input);
    const [updated] = await transaction
      .update(operationContinuations)
      .set({
        status: 'cancelled',
        leaseOwnerId: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        failureCode: null,
        updatedAt: now,
        completedAt: now,
      })
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
      .returning();
    if (updated) {
      return {
        continuation: toContinuationSnapshot(updated),
        transitioned: true,
      };
    }
    const [current] = await transaction
      .select()
      .from(operationContinuations)
      .where(eq(operationContinuations.operationId, input.operationId))
      .orderBy(desc(operationContinuations.sequence))
      .limit(1);
    if (!current) throw new OperationContinuationOwnershipError();
    if (current.status === 'cancelled') {
      return {
        continuation: toContinuationSnapshot(current),
        transitioned: false,
      };
    }
    throw new OperationContinuationConflictError(
      '已终态continuation不能改为cancelled',
    );
  });
}
