import { randomUUID } from 'node:crypto';
import { OPERATION_CONTINUATION_TASK } from '@educanvas/agent-core';
import {
  gatewayOperationEventSchema,
  type GatewayApprovalDecision,
  type GatewayOperationEvent,
  type GatewayResolvedRoute,
} from '@educanvas/gateway-core';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { getDb } from '../client';
import {
  agentOperations,
  chatMessages,
  conversations,
  conversationMessages,
  gatewayApprovals,
  gatewayOperationEvents,
  operationContinuations,
} from '../schema';
import { GatewayPersistenceError, type Database } from './persistence';
import {
  appendGatewayOperationEvent,
  cancelContinuationWithinTransaction,
  normalizeOperationStatus,
  type GatewayEventPayload,
} from './operation-event-writer';

/**
 * Operation Store 边界：拥有 Gateway Operation、Approval 与 continuation 的原子事务。
 * begin/append/resolveApproval/cancel/list/replay 及终态收敛都在此聚合，
 * 事件序号分配与终态写入委托给内部的 operation-event-writer，但仍在同一事务内提交。
 */

export interface GatewayStoredOperationSnapshot {
  operationId: string;
  traceId: string;
  envelopeId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  route: GatewayResolvedRoute;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  replayed: boolean;
}

export class DrizzleGatewayOperationStore {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async begin(input: {
    envelopeId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    route: GatewayResolvedRoute;
    now: Date;
  }): Promise<GatewayStoredOperationSnapshot> {
    return this.database.transaction(async (transaction) => {
      const lockKey = `gateway-operation-v1:${input.route.actorUserId}:${input.route.conversationId}:${input.idempotencyKey}`;
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const [existing] = await transaction
        .select()
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.actorUserId, input.route.actorUserId),
            eq(agentOperations.conversationId, input.route.conversationId),
            eq(agentOperations.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.requestFingerprint !== input.requestFingerprint ||
          existing.gatewayEnvelopeId === null ||
          existing.agentId === null ||
          existing.notebookId === null ||
          existing.actorUserId === null
        ) {
          throw new GatewayPersistenceError(
            'idempotency_conflict',
            'Idempotency key is bound to a different request',
          );
        }
        return {
          operationId: existing.id,
          traceId: existing.traceId,
          envelopeId: existing.gatewayEnvelopeId,
          idempotencyKey: existing.idempotencyKey,
          requestFingerprint: existing.requestFingerprint,
          route: {
            actorUserId: existing.actorUserId,
            agentId: existing.agentId,
            notebookId: existing.notebookId,
            conversationId: existing.conversationId,
            membershipRole: input.route.membershipRole,
          },
          status: normalizeOperationStatus(existing.status),
          replayed: true,
        };
      }
      const [created] = await transaction
        .insert(agentOperations)
        .values({
          gatewayEnvelopeId: input.envelopeId,
          requestFingerprint: input.requestFingerprint,
          actorUserId: input.route.actorUserId,
          agentId: input.route.agentId,
          notebookId: input.route.notebookId,
          conversationId: input.route.conversationId,
          kind: 'turn',
          idempotencyKey: input.idempotencyKey,
          traceId: randomUUID(),
          status: 'running',
          createdAt: input.now,
        })
        .returning({
          id: agentOperations.id,
          traceId: agentOperations.traceId,
        });
      if (!created) {
        throw new GatewayPersistenceError(
          'operation_not_found',
          'Operation insert failed',
        );
      }
      return {
        operationId: created.id,
        traceId: created.traceId,
        envelopeId: input.envelopeId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        route: input.route,
        status: 'running',
        replayed: false,
      };
    });
  }

  async append(
    operationId: string,
    payload: GatewayEventPayload,
    now: Date,
  ): Promise<GatewayOperationEvent> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${operationId}`}, 0))`,
      );
      return appendGatewayOperationEvent(
        transaction,
        operationId,
        payload,
        now,
      );
    });
  }

  /**
   * 审批决策、Gateway事件、continuation就绪与Graphile任务原子提交。
   * approved没有对应等待点时整笔回滚，避免记录“已批准”却永远无法恢复。
   */
  async resolveApproval(input: {
    approvalId: string;
    actorUserId: string;
    status: 'approved' | 'denied';
    reason?: string;
    now?: Date;
  }): Promise<{
    operationId: string;
    decision: GatewayApprovalDecision;
    continuationId: string | null;
  }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select({ operationId: gatewayApprovals.operationId })
        .from(gatewayApprovals)
        .where(
          and(
            eq(gatewayApprovals.id, input.approvalId),
            eq(gatewayApprovals.actorUserId, input.actorUserId),
            eq(gatewayApprovals.status, 'pending'),
            gt(gatewayApprovals.expiresAt, now),
          ),
        )
        .limit(1);
      if (!candidate) {
        throw new GatewayPersistenceError(
          'forbidden',
          'Approval is unavailable or expired',
        );
      }
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${candidate.operationId}`}, 0))`,
      );
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

  /** 恢复前重新鉴权失败时，continuation与Operation失败终态在同一事务提交。 */
  async rejectContinuationAuthorization(input: {
    continuationId: string;
    operationId: string;
    actorUserId: string;
    now?: Date;
  }): Promise<GatewayOperationEvent> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${input.operationId}`}, 0))`,
      );
      const [failed] = await transaction
        .update(operationContinuations)
        .set({
          status: 'failed',
          leaseOwnerId: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          failureCode: 'reauthorization_failed',
          updatedAt: now,
          completedAt: now,
        })
        .where(
          and(
            eq(operationContinuations.id, input.continuationId),
            eq(operationContinuations.operationId, input.operationId),
            or(
              eq(operationContinuations.status, 'ready'),
              and(
                eq(operationContinuations.status, 'running'),
                lte(operationContinuations.leaseExpiresAt, now),
              ),
            ),
          ),
        )
        .returning({ id: operationContinuations.id });
      if (!failed) {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Continuation is no longer ready for authorization rejection',
        );
      }
      const [operation] = await transaction
        .select({ actorUserId: agentOperations.actorUserId })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.id, input.operationId),
            eq(agentOperations.actorUserId, input.actorUserId),
            eq(agentOperations.status, 'running'),
          ),
        )
        .limit(1);
      if (!operation) {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Operation is no longer running for authorization rejection',
        );
      }
      return appendGatewayOperationEvent(
        transaction,
        input.operationId,
        { type: 'operation.failed', code: 'FORBIDDEN', retryable: false },
        now,
      );
    });
  }

  /** Worker lease终态与Gateway Operation唯一终态原子提交，避免任一侧单独成功。 */
  async settleContinuation(input: {
    continuationId: string;
    operationId: string;
    ownerId: string;
    leaseGeneration: number;
    result:
      | { status: 'completed'; messageId: string }
      | {
          status: 'failed';
          continuationFailureCode: string;
          operationFailureCode:
            'CAPABILITY_UNAVAILABLE' | 'FORBIDDEN' | 'RUNTIME_FAILED';
          retryable: boolean;
        };
    now?: Date;
  }): Promise<GatewayOperationEvent> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${input.operationId}`}, 0))`,
      );
      const [operation] = await transaction
        .select({
          status: agentOperations.status,
          actorUserId: agentOperations.actorUserId,
          cancelRequestedAt: agentOperations.cancelRequestedAt,
        })
        .from(agentOperations)
        .where(eq(agentOperations.id, input.operationId))
        .limit(1);
      if (!operation?.actorUserId || operation.status !== 'running') {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Operation is no longer running for continuation settlement',
        );
      }
      if (operation.cancelRequestedAt) {
        const cancelled = await cancelContinuationWithinTransaction(
          transaction,
          {
            continuationId: input.continuationId,
            operationId: input.operationId,
            actorUserId: operation.actorUserId,
            statuses: ['running'],
            ownerId: input.ownerId,
            leaseGeneration: input.leaseGeneration,
            now,
          },
        );
        if (!cancelled) {
          throw new GatewayPersistenceError(
            'invalid_event_sequence',
            'Continuation lease is stale during cancellation',
          );
        }
        return cancelled;
      }
      if (input.result.status === 'completed') {
        const [platformMessage] = await transaction
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.id, input.result.messageId),
              eq(conversationMessages.operationId, input.operationId),
              eq(conversationMessages.role, 'assistant'),
              eq(conversationMessages.status, 'completed'),
            ),
          )
          .limit(1);
        const [teachingMessage] = platformMessage
          ? []
          : await transaction
              .select({ id: chatMessages.id })
              .from(chatMessages)
              .where(
                and(
                  eq(chatMessages.id, input.result.messageId),
                  eq(chatMessages.turnId, input.operationId),
                  eq(chatMessages.role, 'assistant'),
                  eq(chatMessages.status, 'completed'),
                ),
              )
              .limit(1);
        if (!platformMessage && !teachingMessage) {
          throw new GatewayPersistenceError(
            'invalid_event_sequence',
            'Completed continuation requires its completed assistant message',
          );
        }
      }
      const [settled] = await transaction
        .update(operationContinuations)
        .set({
          status: input.result.status,
          leaseOwnerId: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          failureCode:
            input.result.status === 'failed'
              ? input.result.continuationFailureCode
              : null,
          updatedAt: now,
          completedAt: now,
        })
        .where(
          and(
            eq(operationContinuations.id, input.continuationId),
            eq(operationContinuations.operationId, input.operationId),
            eq(operationContinuations.status, 'running'),
            eq(operationContinuations.leaseOwnerId, input.ownerId),
            eq(operationContinuations.leaseGeneration, input.leaseGeneration),
            gt(operationContinuations.leaseExpiresAt, now),
          ),
        )
        .returning({ id: operationContinuations.id });
      if (!settled) {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Continuation lease is stale or expired',
        );
      }
      return appendGatewayOperationEvent(
        transaction,
        input.operationId,
        input.result.status === 'completed'
          ? { type: 'operation.completed', messageId: input.result.messageId }
          : {
              type: 'operation.failed',
              code: input.result.operationFailureCode,
              retryable: input.result.retryable,
            },
        now,
      );
    });
  }

  /** Worker观察到持久取消请求后，原子废止lease并写入唯一Operation取消终态。 */
  async cancelContinuation(input: {
    continuationId: string;
    operationId: string;
    actorUserId: string;
    now?: Date;
  }): Promise<GatewayOperationEvent> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${input.operationId}`}, 0))`,
      );
      const [operation] = await transaction
        .select({ id: agentOperations.id })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.id, input.operationId),
            eq(agentOperations.actorUserId, input.actorUserId),
            eq(agentOperations.status, 'running'),
            sql`${agentOperations.cancelRequestedAt} is not null`,
          ),
        )
        .limit(1);
      if (!operation) {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Operation has no active cancellation request',
        );
      }
      const cancelled = await cancelContinuationWithinTransaction(transaction, {
        continuationId: input.continuationId,
        operationId: input.operationId,
        actorUserId: input.actorUserId,
        statuses: ['waiting_approval', 'ready', 'running'],
        now,
      });
      if (!cancelled) {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Operation has no active continuation to cancel',
        );
      }
      return cancelled;
    });
  }

  /** 取消鉴权用的最小描述：归属与规范化终态。操作不存在或无归属返回 null。 */
  async describe(operationId: string): Promise<{
    operationId: string;
    actorUserId: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
  } | null> {
    const [row] = await this.database
      .select({
        actorUserId: agentOperations.actorUserId,
        status: agentOperations.status,
      })
      .from(agentOperations)
      .where(eq(agentOperations.id, operationId))
      .limit(1);
    if (!row || row.actorUserId === null) return null;
    const normalized = normalizeOperationStatus(row.status);
    return {
      operationId,
      actorUserId: row.actorUserId,
      /* pending 尚未进入运行循环，对外按 running 呈现（可取消/可等待） */
      status:
        row.status === 'running' || row.status === 'pending'
          ? 'running'
          : normalized,
    };
  }

  /** 写入跨进程可见的取消请求；终态仍只能由运行该Operation的控制循环追加。 */
  async requestCancellation(input: {
    operationId: string;
    actorUserId: string;
    now: Date;
  }): Promise<{
    recorded: boolean;
    continuation: 'none' | 'running' | 'cancelled';
  }> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${input.operationId}`}, 0))`,
      );
      const [operation] = await transaction
        .select({ status: agentOperations.status })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.id, input.operationId),
            eq(agentOperations.actorUserId, input.actorUserId),
            inArray(agentOperations.status, ['pending', 'running']),
          ),
        )
        .limit(1);
      if (!operation) return { recorded: false, continuation: 'none' };
      await transaction
        .update(agentOperations)
        .set({ cancelRequestedAt: input.now })
        .where(
          and(
            eq(agentOperations.id, input.operationId),
            isNull(agentOperations.cancelRequestedAt),
          ),
        );
      const [continuation] = await transaction
        .select({ status: operationContinuations.status })
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
      if (
        continuation?.status === 'waiting_approval' ||
        continuation?.status === 'ready'
      ) {
        const cancelled = await cancelContinuationWithinTransaction(
          transaction,
          {
            operationId: input.operationId,
            actorUserId: input.actorUserId,
            statuses: ['waiting_approval', 'ready'],
            now: input.now,
          },
        );
        if (!cancelled) {
          throw new GatewayPersistenceError(
            'invalid_event_sequence',
            'Continuation changed during cancellation',
          );
        }
        return { recorded: true, continuation: 'cancelled' };
      }
      return {
        recorded: true,
        continuation: continuation?.status === 'running' ? 'running' : 'none',
      };
    });
  }

  /**
   * 近期回合操作，供 TUI/客户端的会话恢复入口使用。只返回归属当前用户的
   * `turn` 操作，附会话标题；产物生成等其他 kind 不在此列。
   */
  async listRecent(
    actorUserId: string,
    limit = 20,
  ): Promise<
    readonly {
      operationId: string;
      conversationId: string;
      conversationTitle: string | null;
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      createdAt: string;
    }[]
  > {
    const rows = await this.database
      .select({
        operationId: agentOperations.id,
        conversationId: agentOperations.conversationId,
        title: conversations.title,
        status: agentOperations.status,
        createdAt: agentOperations.createdAt,
      })
      .from(agentOperations)
      .innerJoin(
        conversations,
        eq(conversations.id, agentOperations.conversationId),
      )
      .where(
        and(
          eq(agentOperations.actorUserId, actorUserId),
          eq(agentOperations.kind, 'turn'),
        ),
      )
      .orderBy(desc(agentOperations.createdAt), desc(agentOperations.id))
      .limit(Math.min(Math.max(limit, 1), 50));
    return rows.map((row) => ({
      operationId: row.operationId,
      conversationId: row.conversationId,
      conversationTitle: row.title,
      status:
        row.status === 'running' || row.status === 'pending'
          ? 'running'
          : normalizeOperationStatus(row.status),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async listEvents(
    operationId: string,
    afterSequence: number,
    actorUserId: string,
  ): Promise<readonly GatewayOperationEvent[]> {
    const [owned] = await this.database
      .select({ id: agentOperations.id })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, operationId),
          eq(agentOperations.actorUserId, actorUserId),
        ),
      )
      .limit(1);
    if (!owned) {
      throw new GatewayPersistenceError(
        'operation_not_found',
        'Operation not found',
      );
    }
    const rows = await this.database
      .select({ payload: gatewayOperationEvents.payload })
      .from(gatewayOperationEvents)
      .where(
        and(
          eq(gatewayOperationEvents.operationId, operationId),
          gt(gatewayOperationEvents.sequence, afterSequence),
        ),
      )
      .orderBy(asc(gatewayOperationEvents.sequence));
    return rows.map(({ payload }) =>
      gatewayOperationEventSchema.parse(payload),
    );
  }
}
