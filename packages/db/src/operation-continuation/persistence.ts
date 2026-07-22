import {
  MAX_OPERATION_CONTINUATION_LEASE_MS,
  MIN_OPERATION_CONTINUATION_LEASE_MS,
  operationContinuationSnapshotSchema,
  type OperationContinuationSnapshot,
} from '@educanvas/agent-core';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { isUuid } from '../internal/identifiers';
import { agentOperations, operationContinuations } from '../schema';
import {
  OperationContinuationLifecycleError,
  OperationContinuationOwnershipError,
} from './contracts';

export type ContinuationDatabase = ReturnType<typeof getDb>;
export type ContinuationTransaction = Parameters<
  Parameters<ContinuationDatabase['transaction']>[0]
>[0];
export type ContinuationExecutor =
  ContinuationDatabase | ContinuationTransaction;

export function isSafeOpaqueId(value: string, max = 256): boolean {
  return (
    value.length >= 1 &&
    value.length <= max &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

export function isSafeFailureCode(value: string): boolean {
  return /^[a-z][a-z0-9._:-]{0,127}$/.test(value);
}

export function validateLeaseDuration(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_OPERATION_CONTINUATION_LEASE_MS ||
    value > MAX_OPERATION_CONTINUATION_LEASE_MS
  ) {
    throw new OperationContinuationLifecycleError(
      `continuation lease必须是${MIN_OPERATION_CONTINUATION_LEASE_MS}-${MAX_OPERATION_CONTINUATION_LEASE_MS}毫秒的整数`,
    );
  }
  return value;
}

export function toContinuationSnapshot(
  row: typeof operationContinuations.$inferSelect,
): OperationContinuationSnapshot {
  return operationContinuationSnapshotSchema.parse({
    protocol: row.protocolVersion,
    continuationId: row.id,
    operationId: row.operationId,
    sequence: row.sequence,
    status: row.status,
    approvalId: row.approvalId,
    work: {
      kind: 'tool_invocation',
      step: row.step,
      toolCallId: row.toolCallId,
      adapterSource: row.adapterSource,
      resumeRef: row.resumeRef,
    },
    leaseGeneration: row.leaseGeneration,
    leaseOwnerId: row.leaseOwnerId,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    heartbeatAt: row.heartbeatAt?.toISOString() ?? null,
    failureCode: row.failureCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  });
}

export async function requireOwnedOperation(
  executor: ContinuationExecutor,
  input: { operationId: string; actorId: string },
) {
  if (
    !isUuid(input.operationId) ||
    input.actorId.length < 1 ||
    input.actorId.length > 160
  ) {
    throw new OperationContinuationOwnershipError();
  }
  const [operation] = await executor
    .select({
      id: agentOperations.id,
      status: agentOperations.status,
      cancelRequestedAt: agentOperations.cancelRequestedAt,
    })
    .from(agentOperations)
    .where(
      and(
        eq(agentOperations.id, input.operationId),
        eq(agentOperations.actorUserId, input.actorId),
        eq(agentOperations.kind, 'turn'),
      ),
    )
    .limit(1);
  if (!operation) throw new OperationContinuationOwnershipError();
  return operation;
}

export async function requireOwnedContinuation(
  executor: ContinuationExecutor,
  input: { continuationId: string; actorId: string },
) {
  if (!isUuid(input.continuationId)) {
    throw new OperationContinuationOwnershipError();
  }
  const [continuation] = await executor
    .select()
    .from(operationContinuations)
    .where(eq(operationContinuations.id, input.continuationId))
    .limit(1);
  if (!continuation) throw new OperationContinuationOwnershipError();
  await requireOwnedOperation(executor, {
    operationId: continuation.operationId,
    actorId: input.actorId,
  });
  return continuation;
}
