import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import type { GatewayApprovalDecision } from '@educanvas/gateway-core';
import { and, eq, gt, sql } from 'drizzle-orm';
import { gatewayApprovals, operationContinuations } from '../schema';
import { findCurrentOperationAccess } from './operation-access';
import { appendGatewayOperationEvent } from './operation-event-writer';
import { GatewayPersistenceError, type Database } from './persistence';

export interface ResolveGatewayApprovalInput {
  approvalId: string;
  actorUserId: string;
  status: 'approved' | 'denied';
  reason?: string;
  now?: Date;
}

export interface ResolvedGatewayApproval {
  operationId: string;
  decision: GatewayApprovalDecision;
  continuationId: string | null;
}

/**
 * 审批决策、Gateway 事件、Continuation 就绪与 Graphile 任务原子提交。
 * 当前 Membership 在同一事务内锁定并复核，避免撤销与控制动作交错越权。
 */
export async function resolveGatewayApproval(
  database: Database,
  input: ResolveGatewayApprovalInput,
): Promise<ResolvedGatewayApproval> {
  const now = input.now ?? new Date();
  return database.transaction(async (transaction) => {
    const [approval] = await transaction
      .select({ operationId: gatewayApprovals.operationId })
      .from(gatewayApprovals)
      .where(
        and(
          eq(gatewayApprovals.id, input.approvalId),
          eq(gatewayApprovals.actorUserId, input.actorUserId),
        ),
      )
      .limit(1);
    if (!approval) {
      throw new GatewayPersistenceError(
        'forbidden',
        'Approval is unavailable or expired',
      );
    }
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${approval.operationId}`}, 0))`,
    );
    const access = await findCurrentOperationAccess(transaction, {
      operationId: approval.operationId,
      actorUserId: input.actorUserId,
      requiredPermission: 'conversation.reply',
      now,
      mutation: true,
    });
    const [candidate] = await transaction
      .select({ operationId: gatewayApprovals.operationId })
      .from(gatewayApprovals)
      .where(
        and(
          eq(gatewayApprovals.id, input.approvalId),
          eq(gatewayApprovals.operationId, approval.operationId),
          eq(gatewayApprovals.actorUserId, input.actorUserId),
          eq(gatewayApprovals.status, 'pending'),
          gt(gatewayApprovals.expiresAt, now),
        ),
      )
      .limit(1)
      .for('update', { of: gatewayApprovals });
    if (!access || !candidate) {
      throw new GatewayPersistenceError(
        'forbidden',
        'Approval is unavailable or expired',
      );
    }
    const decision: GatewayApprovalDecision = {
      approvalId: input.approvalId,
      status: input.status,
      decidedByUserId: input.actorUserId,
      decidedAt: now.toISOString(),
      ...(input.reason ? { reason: input.reason } : {}),
    };
    await appendGatewayOperationEvent(
      transaction,
      candidate.operationId,
      { type: 'approval.resolved', decision },
      now,
    );

    if (input.status === 'denied') {
      await transaction
        .update(operationContinuations)
        .set({
          status: 'failed',
          failureCode: 'approval_denied',
          updatedAt: now,
          completedAt: now,
        })
        .where(
          and(
            eq(operationContinuations.approvalId, input.approvalId),
            eq(operationContinuations.operationId, candidate.operationId),
            eq(operationContinuations.status, 'waiting_approval'),
          ),
        );
      await appendGatewayOperationEvent(
        transaction,
        candidate.operationId,
        {
          type: 'operation.failed',
          code: 'APPROVAL_DENIED',
          retryable: false,
        },
        now,
      );
      return {
        operationId: candidate.operationId,
        decision,
        continuationId: null,
      };
    }

    const [continuation] = await transaction
      .update(operationContinuations)
      .set({ status: 'ready', updatedAt: now })
      .where(
        and(
          eq(operationContinuations.approvalId, input.approvalId),
          eq(operationContinuations.operationId, candidate.operationId),
          eq(operationContinuations.status, 'waiting_approval'),
        ),
      )
      .returning({ id: operationContinuations.id });
    if (!continuation) {
      throw new GatewayPersistenceError(
        'invalid_event_sequence',
        'Approved operation has no waiting continuation',
      );
    }
    const queueJobKey = `operation-continuation:${continuation.id}`;
    const payload = JSON.stringify({ continuationId: continuation.id });
    /* 25次覆盖最长15分钟业务lease及Graphile指数退避，避免恢复任务在可重领前永久失败。 */
    await transaction.execute(sql`
      select graphile_worker.add_job(
        ${OPERATION_CONTINUATION_TASK},
        payload := ${payload}::json,
        job_key := ${queueJobKey},
        max_attempts := 25
      )
    `);
    return {
      operationId: candidate.operationId,
      decision,
      continuationId: continuation.id,
    };
  });
}
