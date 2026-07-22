import type { OperationContinuationSnapshot } from '@educanvas/agent-core';
import { and, eq, gt } from 'drizzle-orm';
import { operationContinuations } from '../schema';
import {
  OperationContinuationConflictError,
  OperationContinuationLifecycleError,
} from './contracts';
import {
  type ContinuationDatabase,
  isSafeOpaqueId,
  requireOwnedContinuation,
  requireOwnedOperation,
  toContinuationSnapshot,
  validateLeaseDuration,
} from './persistence';

interface LeaseIdentityInput {
  continuationId: string;
  actorId: string;
  ownerId: string;
  leaseGeneration: number;
  now?: Date;
}

function validateLeaseIdentity(
  input: Pick<LeaseIdentityInput, 'ownerId' | 'leaseGeneration'>,
): void {
  if (
    !isSafeOpaqueId(input.ownerId) ||
    !Number.isSafeInteger(input.leaseGeneration) ||
    input.leaseGeneration < 1
  ) {
    throw new OperationContinuationLifecycleError('continuation lease无效');
  }
}

export async function heartbeatContinuation(
  database: ContinuationDatabase,
  input: LeaseIdentityInput & { leaseDurationMs: number },
): Promise<boolean> {
  const duration = validateLeaseDuration(input.leaseDurationMs);
  validateLeaseIdentity(input);
  const now = input.now ?? new Date();
  return database.transaction(async (transaction) => {
    const continuation = await requireOwnedContinuation(transaction, input);
    const operation = await requireOwnedOperation(transaction, {
      operationId: continuation.operationId,
      actorId: input.actorId,
    });
    if (operation.status !== 'running' || operation.cancelRequestedAt) {
      return false;
    }
    const [updated] = await transaction
      .update(operationContinuations)
      .set({
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + duration),
        updatedAt: now,
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
      .returning({ operationId: operationContinuations.operationId });
    return Boolean(updated);
  });
}

export async function releaseContinuation(
  database: ContinuationDatabase,
  input: LeaseIdentityInput,
): Promise<{
  continuation: OperationContinuationSnapshot;
  transitioned: boolean;
}> {
  validateLeaseIdentity(input);
  const now = input.now ?? new Date();
  return database.transaction(async (transaction) => {
    const continuation = await requireOwnedContinuation(transaction, input);
    const operation = await requireOwnedOperation(transaction, {
      operationId: continuation.operationId,
      actorId: input.actorId,
    });
    if (operation.status !== 'running' || operation.cancelRequestedAt) {
      throw new OperationContinuationLifecycleError(
        'Operation不再允许释放continuation lease',
      );
    }
    const [updated] = await transaction
      .update(operationContinuations)
      .set({
        status: 'ready',
        leaseOwnerId: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        updatedAt: now,
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
      current.status === 'ready' &&
      current.leaseGeneration === input.leaseGeneration
    ) {
      return {
        continuation: toContinuationSnapshot(current),
        transitioned: false,
      };
    }
    throw new OperationContinuationConflictError('continuation lease已失效');
  });
}
