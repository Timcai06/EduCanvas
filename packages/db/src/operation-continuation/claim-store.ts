import type { OperationContinuationSnapshot } from '@educanvas/agent-core';
import { and, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import { isUuid } from '../internal/identifiers';
import {
  agentOperations,
  conversations,
  gatewayApprovals,
  notebookMemberships,
  operationContinuations,
  personalAgents,
  toolCalls,
} from '../schema';
import {
  OperationContinuationLifecycleError,
  type OperationContinuationExecutionClaim,
} from './contracts';
import {
  type ContinuationDatabase,
  type ContinuationTransaction,
  isSafeOpaqueId,
  requireOwnedContinuation,
  requireOwnedOperation,
  toContinuationSnapshot,
  validateLeaseDuration,
} from './persistence';

interface ClaimInput {
  continuationId: string;
  ownerId: string;
  leaseDurationMs: number;
  now?: Date;
}

async function claimRow(
  transaction: ContinuationTransaction,
  input: Pick<ClaimInput, 'continuationId' | 'ownerId'>,
  now: Date,
  expiresAt: Date,
) {
  const [claimed] = await transaction
    .update(operationContinuations)
    .set({
      status: 'running',
      leaseGeneration: sql`${operationContinuations.leaseGeneration} + 1`,
      leaseOwnerId: input.ownerId,
      leaseExpiresAt: expiresAt,
      heartbeatAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(operationContinuations.id, input.continuationId),
        or(
          eq(operationContinuations.status, 'ready'),
          and(
            eq(operationContinuations.status, 'running'),
            lte(operationContinuations.leaseExpiresAt, now),
          ),
        ),
      ),
    )
    .returning();
  return claimed;
}

export async function claimContinuation(
  database: ContinuationDatabase,
  input: ClaimInput & { actorId: string },
): Promise<OperationContinuationSnapshot | null> {
  const duration = validateLeaseDuration(input.leaseDurationMs);
  if (!isSafeOpaqueId(input.ownerId)) {
    throw new OperationContinuationLifecycleError('lease owner无效');
  }
  const now = input.now ?? new Date();
  return database.transaction(async (transaction) => {
    const continuation = await requireOwnedContinuation(transaction, input);
    const operation = await requireOwnedOperation(transaction, {
      operationId: continuation.operationId,
      actorId: input.actorId,
    });
    if (operation.status !== 'running' || operation.cancelRequestedAt) {
      return null;
    }
    const claimed = await claimRow(
      transaction,
      input,
      now,
      new Date(now.getTime() + duration),
    );
    return claimed ? toContinuationSnapshot(claimed) : null;
  });
}

/** Worker领取时从权威数据库重建并重新授权全部执行范围。 */
export async function claimContinuationForExecution(
  database: ContinuationDatabase,
  input: ClaimInput,
): Promise<OperationContinuationExecutionClaim> {
  const duration = validateLeaseDuration(input.leaseDurationMs);
  if (!isUuid(input.continuationId) || !isSafeOpaqueId(input.ownerId)) {
    throw new OperationContinuationLifecycleError(
      'continuation worker claim无效',
    );
  }
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + duration);
  return database.transaction(async (transaction) => {
    const [base] = await transaction
      .select({
        operationId: operationContinuations.operationId,
        actorId: agentOperations.actorUserId,
        operationStatus: agentOperations.status,
        cancelRequestedAt: agentOperations.cancelRequestedAt,
        continuationStatus: operationContinuations.status,
        leaseExpiresAt: operationContinuations.leaseExpiresAt,
      })
      .from(operationContinuations)
      .innerJoin(
        agentOperations,
        eq(agentOperations.id, operationContinuations.operationId),
      )
      .where(eq(operationContinuations.id, input.continuationId))
      .limit(1);
    if (!base?.actorId || base.operationStatus !== 'running') {
      return { status: 'not_claimed' };
    }
    if (base.cancelRequestedAt) {
      return {
        status: 'cancellation_requested',
        operationId: base.operationId,
        actorId: base.actorId,
      };
    }
    if (
      base.continuationStatus === 'running' &&
      base.leaseExpiresAt &&
      base.leaseExpiresAt > now
    ) {
      return {
        status: 'lease_held',
        retryAt: base.leaseExpiresAt.toISOString(),
      };
    }

    const [scope] = await transaction
      .select({
        operationId: agentOperations.id,
        actorId: agentOperations.actorUserId,
        agentId: agentOperations.agentId,
        notebookId: agentOperations.notebookId,
        conversationId: agentOperations.conversationId,
        profileId: conversations.agentProfileId,
        traceId: agentOperations.traceId,
        capability: gatewayApprovals.capability,
        risk: gatewayApprovals.risk,
      })
      .from(operationContinuations)
      .innerJoin(
        agentOperations,
        eq(agentOperations.id, operationContinuations.operationId),
      )
      .innerJoin(
        personalAgents,
        and(
          eq(personalAgents.id, agentOperations.agentId),
          eq(personalAgents.userId, agentOperations.actorUserId),
          eq(personalAgents.status, 'active'),
        ),
      )
      .innerJoin(
        conversations,
        and(
          eq(conversations.id, agentOperations.conversationId),
          eq(conversations.spaceId, agentOperations.notebookId),
          eq(conversations.status, 'active'),
        ),
      )
      .innerJoin(
        notebookMemberships,
        and(
          eq(notebookMemberships.notebookId, agentOperations.notebookId),
          eq(notebookMemberships.userId, agentOperations.actorUserId),
          inArray(notebookMemberships.role, ['owner', 'editor', 'contributor']),
          sql`${notebookMemberships.revokedAt} is null`,
          or(
            sql`${notebookMemberships.expiresAt} is null`,
            gt(notebookMemberships.expiresAt, now),
          ),
        ),
      )
      .innerJoin(
        gatewayApprovals,
        and(
          eq(gatewayApprovals.id, operationContinuations.approvalId),
          eq(gatewayApprovals.operationId, agentOperations.id),
          eq(gatewayApprovals.actorUserId, agentOperations.actorUserId),
          eq(gatewayApprovals.status, 'approved'),
          eq(gatewayApprovals.decidedByUserId, agentOperations.actorUserId),
        ),
      )
      .innerJoin(
        toolCalls,
        and(
          eq(toolCalls.id, operationContinuations.toolCallId),
          eq(toolCalls.agentOperationId, agentOperations.id),
        ),
      )
      .where(eq(operationContinuations.id, input.continuationId))
      .limit(1);
    if (
      !scope?.actorId ||
      !scope.agentId ||
      !scope.notebookId ||
      (scope.risk !== 'l2' && scope.risk !== 'l3')
    ) {
      return {
        status: 'reauthorization_failed',
        operationId: base.operationId,
        actorId: base.actorId,
      };
    }

    const claimed = await claimRow(transaction, input, now, expiresAt);
    if (!claimed) {
      const [current] = await transaction
        .select({
          status: operationContinuations.status,
          leaseExpiresAt: operationContinuations.leaseExpiresAt,
        })
        .from(operationContinuations)
        .where(eq(operationContinuations.id, input.continuationId))
        .limit(1);
      if (
        current?.status === 'running' &&
        current.leaseExpiresAt &&
        current.leaseExpiresAt > now
      ) {
        return {
          status: 'lease_held',
          retryAt: current.leaseExpiresAt.toISOString(),
        };
      }
      return { status: 'not_claimed' };
    }
    return {
      status: 'claimed',
      continuation: toContinuationSnapshot(claimed),
      scope: {
        operationId: scope.operationId,
        actorId: scope.actorId,
        agentId: scope.agentId,
        notebookId: scope.notebookId,
        conversationId: scope.conversationId,
        profileId: scope.profileId,
        traceId: scope.traceId,
        capability: scope.capability,
        risk: scope.risk,
      },
    };
  });
}
