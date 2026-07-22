import { randomUUID } from 'node:crypto';
import {
  gatewayOperationEventSchema,
  gatewayProtocolVersion,
  isGatewayTerminalEvent,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  agentOperations,
  gatewayApprovals,
  gatewayOperationEvents,
  operationContinuations,
} from '../schema';
import {
  GatewayPersistenceError,
  type DatabaseTransaction,
} from './persistence';

/**
 * Operation Store 的内部事务写入器：Gateway 事件序号分配、终态收敛，以及
 * Approval/continuation 的原子写入辅助。这些函数**只接收已有的 Transaction，永不自开事务或嵌套事务**，
 * 以保证审批决策、continuation 就绪与终态仍在 Operation Store 的单一事务边界内提交。
 * 本模块不是第二个公开 Repository，不从包入口导出。
 */

type GatewayEventBaseKeys =
  'protocol' | 'eventId' | 'operationId' | 'sequence' | 'occurredAt';
export type GatewayEventPayload = GatewayOperationEvent extends infer Event
  ? Event extends GatewayOperationEvent
    ? Omit<Event, GatewayEventBaseKeys>
    : never
  : never;

type NormalizedOperationStatus =
  'running' | 'completed' | 'failed' | 'cancelled';

export function normalizeOperationStatus(
  status: typeof agentOperations.$inferSelect.status,
): NormalizedOperationStatus {
  if (status === 'completed' || status === 'cancelled') return status;
  if (status === 'failed' || status === 'interrupted') return 'failed';
  return 'running';
}

export async function appendGatewayOperationEvent(
  transaction: DatabaseTransaction,
  operationId: string,
  payload: GatewayEventPayload,
  now: Date,
): Promise<GatewayOperationEvent> {
  const [operation] = await transaction
    .select({
      status: agentOperations.status,
      actorUserId: agentOperations.actorUserId,
    })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);
  if (!operation) {
    throw new GatewayPersistenceError(
      'operation_not_found',
      'Operation not found',
    );
  }
  const terminalStatus =
    payload.type === 'operation.completed'
      ? 'completed'
      : payload.type === 'operation.cancelled'
        ? 'cancelled'
        : payload.type === 'operation.failed'
          ? 'failed'
          : null;
  const normalizedStatus = normalizeOperationStatus(operation.status);
  if (
    operation.status !== 'running' &&
    (terminalStatus === null || terminalStatus !== normalizedStatus)
  ) {
    throw new GatewayPersistenceError(
      'invalid_event_sequence',
      'Cannot append after operation terminal state',
    );
  }
  const [sequenceRow] = await transaction
    .select({
      next: sql<number>`coalesce(max(${gatewayOperationEvents.sequence}), -1) + 1`,
    })
    .from(gatewayOperationEvents)
    .where(eq(gatewayOperationEvents.operationId, operationId));
  const sequence = Number(sequenceRow?.next ?? 0);
  const event = gatewayOperationEventSchema.parse({
    ...payload,
    protocol: gatewayProtocolVersion,
    eventId: randomUUID(),
    operationId,
    sequence,
    occurredAt: now.toISOString(),
  });
  await transaction.insert(gatewayOperationEvents).values({
    id: event.eventId,
    operationId,
    sequence,
    type: event.type,
    payload: event,
    occurredAt: now,
  });
  if (event.type === 'approval.required') {
    if (event.approval.actorUserId !== operation.actorUserId) {
      throw new GatewayPersistenceError(
        'invalid_event_sequence',
        'Approval actor does not own operation',
      );
    }
    await transaction.insert(gatewayApprovals).values({
      id: event.approval.approvalId,
      operationId,
      actorUserId: event.approval.actorUserId,
      capability: event.approval.capability,
      risk: event.approval.risk,
      summary: event.approval.summary,
      status: 'pending',
      requestedAt: new Date(event.approval.requestedAt),
      expiresAt: new Date(event.approval.expiresAt),
    });
  } else if (event.type === 'approval.resolved') {
    const [approval] = await transaction
      .update(gatewayApprovals)
      .set({
        status: event.decision.status,
        decidedByUserId: event.decision.decidedByUserId,
        decidedAt: new Date(event.decision.decidedAt),
        reason: event.decision.reason ?? null,
      })
      .where(
        and(
          eq(gatewayApprovals.id, event.decision.approvalId),
          eq(gatewayApprovals.operationId, operationId),
          eq(gatewayApprovals.status, 'pending'),
        ),
      )
      .returning({ id: gatewayApprovals.id });
    if (!approval) {
      throw new GatewayPersistenceError(
        'invalid_event_sequence',
        'Approval is unknown or already resolved',
      );
    }
  }
  if (isGatewayTerminalEvent(event)) {
    await transaction
      .update(agentOperations)
      .set({
        status:
          event.type === 'operation.completed'
            ? 'completed'
            : event.type === 'operation.cancelled'
              ? 'cancelled'
              : 'failed',
        failureCode: event.type === 'operation.failed' ? event.code : null,
        completedAt: now,
      })
      .where(eq(agentOperations.id, operationId));
  }
  return event;
}

export async function cancelContinuationWithinTransaction(
  transaction: DatabaseTransaction,
  input: {
    continuationId?: string;
    operationId: string;
    actorUserId: string;
    statuses: readonly ('waiting_approval' | 'ready' | 'running')[];
    ownerId?: string;
    leaseGeneration?: number;
    now: Date;
  },
): Promise<GatewayOperationEvent | null> {
  const conditions = [
    eq(operationContinuations.operationId, input.operationId),
    inArray(operationContinuations.status, input.statuses),
  ];
  if (input.continuationId) {
    conditions.push(eq(operationContinuations.id, input.continuationId));
  }
  if (input.ownerId) {
    conditions.push(eq(operationContinuations.leaseOwnerId, input.ownerId));
  }
  if (input.leaseGeneration !== undefined) {
    conditions.push(
      eq(operationContinuations.leaseGeneration, input.leaseGeneration),
    );
  }
  const [cancelled] = await transaction
    .update(operationContinuations)
    .set({
      status: 'cancelled',
      leaseOwnerId: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      failureCode: null,
      updatedAt: input.now,
      completedAt: input.now,
    })
    .where(and(...conditions))
    .returning({ approvalId: operationContinuations.approvalId });
  if (!cancelled) return null;
  await transaction
    .update(gatewayApprovals)
    .set({
      status: 'revoked',
      decidedByUserId: input.actorUserId,
      decidedAt: input.now,
      reason: 'operation_cancelled',
    })
    .where(
      and(
        eq(gatewayApprovals.id, cancelled.approvalId),
        eq(gatewayApprovals.operationId, input.operationId),
        eq(gatewayApprovals.actorUserId, input.actorUserId),
        eq(gatewayApprovals.status, 'pending'),
      ),
    );
  return appendGatewayOperationEvent(
    transaction,
    input.operationId,
    { type: 'operation.cancelled' },
    input.now,
  );
}
