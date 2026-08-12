import { randomUUID } from 'node:crypto';
import {
  type GatewayOperationEvent,
  type GatewayResolvedRoute,
  type NotebookPermission,
} from '@educanvas/gateway-core';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb } from '../client';
import {
  agentOperations,
  chatMessages,
  conversationMessages,
  operationContinuations,
} from '../schema';
import {
  findCurrentOperationAccess,
  listCurrentGatewayOperationEvents,
  listRecentCurrentGatewayOperations,
  requestCurrentGatewayOperationCancellation,
} from './operation-access';
import {
  resolveGatewayApproval,
  type ResolveGatewayApprovalInput,
  type ResolvedGatewayApproval,
} from './operation-approval-control';
import { GatewayPersistenceError, type Database } from './persistence';
import { reconcileGatewayTerminalWithinTransaction } from './terminal-reconciliation';
import {
  appendGatewayOperationEvent,
  cancelContinuationWithinTransaction,
  normalizeOperationStatus,
  type GatewayEventPayload,
} from './operation-event-writer';
import type { DatabaseTransaction } from './persistence';
import type { GatewayTerminalReconciliationMode } from './terminal-reconciliation-mode';

/**
 * Gateway Operation 的公开持久化边界。
 * 创建/追加、当前访问复核、审批控制分别委托给命名模块；所有写路径仍在同一数据库事务内提交。
 */

/** PostgreSQL Operation快照不回显未持久化的历史Membership/Profile路由。 */
export interface GatewayStoredOperationSnapshot {
  operationId: string;
  traceId: string;
  envelopeId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  replayed: boolean;
}

export class DrizzleGatewayOperationStore {
  private readonly terminalReconciliationMode: GatewayTerminalReconciliationMode;

  constructor(
    private readonly providedDatabase?: Database,
    options: {
      terminalReconciliationMode?: GatewayTerminalReconciliationMode;
    } = {},
  ) {
    this.terminalReconciliationMode =
      options.terminalReconciliationMode ?? 'enabled';
  }

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  private async reconcileTerminal(
    transaction: DatabaseTransaction,
    operationId: string,
    rawStatus: string,
    now: Date,
  ): Promise<'running' | 'completed' | 'failed' | 'cancelled'> {
    if (this.terminalReconciliationMode === 'legacy-disabled') {
      return rawStatus === 'running' || rawStatus === 'pending'
        ? 'running'
        : normalizeOperationStatus(rawStatus);
    }
    return reconcileGatewayTerminalWithinTransaction(
      transaction,
      operationId,
      now,
    );
  }

  private async loadTerminalAwareStatus(
    transaction: DatabaseTransaction,
    input: {
      operationId: string;
      actorUserId: string;
      requiredPermission: NotebookPermission;
      now: Date;
    },
  ) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${input.operationId}`}, 0))`,
    );
    const access = await findCurrentOperationAccess(transaction, {
      ...input,
      mutation: true,
    });
    if (!access) return null;
    return {
      access,
      status: await this.reconcileTerminal(
        transaction,
        input.operationId,
        access.status,
        input.now,
      ),
    };
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
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${existing.id}`}, 0))`,
        );
        const status = await this.reconcileTerminal(
          transaction,
          existing.id,
          existing.status,
          input.now,
        );
        return {
          operationId: existing.id,
          traceId: existing.traceId,
          envelopeId: existing.gatewayEnvelopeId,
          idempotencyKey: existing.idempotencyKey,
          requestFingerprint: existing.requestFingerprint,
          status,
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
      // A lifecycle may have committed assistant/citations plus its durable
      // intent before this append. Reconcile first so a retry cannot overwrite
      // that terminal with GatewayService's generic catch fallback.
      if (this.terminalReconciliationMode === 'enabled') {
        await reconcileGatewayTerminalWithinTransaction(
          transaction,
          operationId,
          now,
        );
      }
      return appendGatewayOperationEvent(
        transaction,
        operationId,
        payload,
        now,
      );
    });
  }

  async resolveApproval(
    input: ResolveGatewayApprovalInput,
  ): Promise<ResolvedGatewayApproval> {
    return resolveGatewayApproval(this.database, input);
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
      if (this.terminalReconciliationMode === 'enabled') {
        await reconcileGatewayTerminalWithinTransaction(
          transaction,
          input.operationId,
          now,
        );
      }
      const [operation] = await transaction
        .select({
          status: agentOperations.status,
          actorUserId: agentOperations.actorUserId,
          cancelRequestedAt: agentOperations.cancelRequestedAt,
        })
        .from(agentOperations)
        .where(eq(agentOperations.id, input.operationId))
        .limit(1);
      if (
        !operation?.actorUserId ||
        (operation.status !== 'running' &&
          operation.status !== input.result.status)
      ) {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Operation is no longer running for continuation settlement',
        );
      }
      if (operation.status === 'running' && operation.cancelRequestedAt) {
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

  /** 取消鉴权用的最小描述：按当前回复权限返回归属与规范化终态。 */
  async describe(
    operationId: string,
    actorUserId: string,
    now: Date = new Date(),
  ): Promise<{
    operationId: string;
    actorUserId: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
  } | null> {
    return this.database.transaction(async (transaction) => {
      const loaded = await this.loadTerminalAwareStatus(transaction, {
        operationId,
        actorUserId,
        requiredPermission: 'conversation.reply',
        now,
      });
      if (!loaded) return null;
      return {
        operationId,
        actorUserId: loaded.access.actorUserId,
        status: loaded.status,
      };
    });
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
    return requestCurrentGatewayOperationCancellation(this.database, {
      ...input,
      reconcileTerminal:
        this.terminalReconciliationMode === 'enabled'
          ? (transaction, operationId, now) =>
              reconcileGatewayTerminalWithinTransaction(
                transaction,
                operationId,
                now,
              )
          : undefined,
    });
  }

  /**
   * 近期回合操作，供 TUI/客户端的会话恢复入口使用。只返回归属当前用户的
   * `turn` 操作，附会话标题；产物生成等其他 kind 不在此列。
   */
  async listRecent(
    actorUserId: string,
    limit = 20,
    now: Date = new Date(),
  ): Promise<
    readonly {
      operationId: string;
      conversationId: string;
      conversationTitle: string | null;
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      createdAt: string;
    }[]
  > {
    const candidates = await listRecentCurrentGatewayOperations(this.database, {
      actorUserId,
      limit,
      now,
    });
    const result: (typeof candidates)[number][] = [];
    for (const candidate of candidates) {
      const loaded = await this.database.transaction((transaction) =>
        this.loadTerminalAwareStatus(transaction, {
          operationId: candidate.operationId,
          actorUserId,
          requiredPermission: 'notebook.read',
          now,
        }),
      );
      if (loaded) result.push({ ...candidate, status: loaded.status });
    }
    return result;
  }

  async listEvents(
    operationId: string,
    afterSequence: number,
    actorUserId: string,
    now: Date = new Date(),
  ): Promise<readonly GatewayOperationEvent[]> {
    const access = await findCurrentOperationAccess(this.database, {
      operationId,
      actorUserId,
      requiredPermission: 'notebook.read',
      now,
    });
    if (!access) {
      throw new GatewayPersistenceError(
        'operation_not_found',
        'Operation not found',
      );
    }
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${operationId}`}, 0))`,
      );
      const lockedAccess = await findCurrentOperationAccess(transaction, {
        operationId,
        actorUserId,
        requiredPermission: 'notebook.read',
        now,
      });
      if (!lockedAccess) {
        throw new GatewayPersistenceError(
          'operation_not_found',
          'Operation not found',
        );
      }
      if (this.terminalReconciliationMode === 'enabled') {
        await reconcileGatewayTerminalWithinTransaction(
          transaction,
          operationId,
          now,
        );
      }
      return listCurrentGatewayOperationEvents(transaction, {
        operationId,
        afterSequence,
        actorUserId,
        now,
      });
    });
  }
}
