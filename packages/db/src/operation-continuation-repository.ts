import type {
  CreateOperationContinuationInput,
  OperationContinuationPort,
  OperationContinuationSnapshot,
  OperationContinuationTerminalStatus,
} from '@educanvas/agent-core';
import {
  MAX_OPERATION_CONTINUATION_LEASE_MS,
  MIN_OPERATION_CONTINUATION_LEASE_MS,
  createOperationContinuationInputSchema,
  operationContinuationProtocolVersion,
  operationContinuationSnapshotSchema,
} from '@educanvas/agent-core';
import { and, desc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import {
  agentOperations,
  conversations,
  gatewayApprovals,
  notebookMemberships,
  operationContinuations,
  personalAgents,
  toolCalls,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

/** 对不存在与跨Actor访问使用同一错误，避免泄漏continuation身份。 */
export class OperationContinuationOwnershipError extends Error {
  readonly code = 'operation_continuation_not_found';

  constructor() {
    super('Operation continuation不存在或不属于当前Actor');
    this.name = 'OperationContinuationOwnershipError';
  }
}

/** 幂等身份、活动等待点或lease generation冲突。 */
export class OperationContinuationConflictError extends Error {
  readonly code = 'operation_continuation_conflict';

  constructor(message = 'Operation continuation已绑定不同恢复语义') {
    super(message);
    this.name = 'OperationContinuationConflictError';
  }
}

/** 输入或状态迁移违反continuation生命周期不变量。 */
export class OperationContinuationLifecycleError extends Error {
  readonly code = 'invalid_operation_continuation_transition';

  constructor(message: string) {
    super(message);
    this.name = 'OperationContinuationLifecycleError';
  }
}

/** Worker恢复前从当前Operation、Agent、Notebook、Conversation与approval重算的范围。 */
export interface OperationContinuationExecutionScope {
  operationId: string;
  actorId: string;
  agentId: string;
  notebookId: string;
  conversationId: string;
  profileId: string;
  traceId: string;
  capability: string;
  risk: 'l2' | 'l3';
}

/** claimForExecution不会把未通过当前授权检查的工作交给Adapter。 */
export type OperationContinuationExecutionClaim =
  | {
      status: 'claimed';
      continuation: OperationContinuationSnapshot;
      scope: OperationContinuationExecutionScope;
    }
  | { status: 'not_claimed' }
  | {
      status: 'reauthorization_failed';
      operationId: string;
      actorId: string;
    };

function isSafeOpaqueId(value: string, max = 256): boolean {
  return (
    value.length >= 1 &&
    value.length <= max &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isSafeFailureCode(value: string): boolean {
  return /^[a-z][a-z0-9._:-]{0,127}$/.test(value);
}

function validateLeaseDuration(value: number): number {
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

function toSnapshot(
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

async function requireOwnedOperation(
  executor: DatabaseExecutor,
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

async function requireOwnedContinuation(
  executor: DatabaseExecutor,
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

/**
 * PostgreSQL原生continuation账本。它只拥有执行游标与lease；Gateway审批、
 * Operation终态、Tool effect和学习事实仍由各自唯一写者维护。
 */
export class DrizzleOperationContinuationRepository implements OperationContinuationPort {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createWaiting(
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
    return this.database.transaction(async (transaction) => {
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
              eq(
                operationContinuations.adapterSource,
                input.work.adapterSource,
              ),
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
        return { continuation: toSnapshot(matching), replayed: true };
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
          status: 'waiting_approval',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error('Operation continuation写入失败');
      return { continuation: toSnapshot(created), replayed: false };
    });
  }

  async get(input: {
    continuationId: string;
    actorId: string;
  }): Promise<OperationContinuationSnapshot | null> {
    return toSnapshot(await requireOwnedContinuation(this.database, input));
  }

  async getActive(input: {
    operationId: string;
    actorId: string;
  }): Promise<OperationContinuationSnapshot | null> {
    await requireOwnedOperation(this.database, input);
    const [row] = await this.database
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
    return row ? toSnapshot(row) : null;
  }

  async markReady(input: {
    continuationId: string;
    actorId: string;
    approvalId: string;
    now?: Date;
  }): Promise<{
    continuation: OperationContinuationSnapshot;
    transitioned: boolean;
  }> {
    if (!isSafeOpaqueId(input.approvalId)) {
      throw new OperationContinuationLifecycleError('approvalId无效');
    }
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
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
        return { continuation: toSnapshot(continuation), transitioned: false };
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
        return { continuation: toSnapshot(updated), transitioned: true };
      }
      const current = await requireOwnedContinuation(transaction, input);
      if (current.status === 'waiting_approval') {
        throw new OperationContinuationConflictError();
      }
      return { continuation: toSnapshot(current), transitioned: false };
    });
  }

  async claim(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<OperationContinuationSnapshot | null> {
    const duration = validateLeaseDuration(input.leaseDurationMs);
    if (!isSafeOpaqueId(input.ownerId)) {
      throw new OperationContinuationLifecycleError('lease owner无效');
    }
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + duration);
    return this.database.transaction(async (transaction) => {
      const continuation = await requireOwnedContinuation(transaction, input);
      const operation = await requireOwnedOperation(transaction, {
        operationId: continuation.operationId,
        actorId: input.actorId,
      });
      if (operation.status !== 'running' || operation.cancelRequestedAt) {
        return null;
      }
      const [updated] = await transaction
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
      return updated ? toSnapshot(updated) : null;
    });
  }

  /**
   * Worker专用领取入口。队列只提供continuationId；Actor与全部执行范围从数据库
   * 权威事实重建。Membership或Personal Agent失效时原子记为稳定失败，绝不调用Adapter。
   */
  async claimForExecution(input: {
    continuationId: string;
    ownerId: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<OperationContinuationExecutionClaim> {
    const duration = validateLeaseDuration(input.leaseDurationMs);
    if (!isUuid(input.continuationId) || !isSafeOpaqueId(input.ownerId)) {
      throw new OperationContinuationLifecycleError(
        'continuation worker claim无效',
      );
    }
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + duration);
    return this.database.transaction(async (transaction) => {
      const [base] = await transaction
        .select({
          operationId: operationContinuations.operationId,
          actorId: agentOperations.actorUserId,
          operationStatus: agentOperations.status,
          cancelRequestedAt: agentOperations.cancelRequestedAt,
        })
        .from(operationContinuations)
        .innerJoin(
          agentOperations,
          eq(agentOperations.id, operationContinuations.operationId),
        )
        .where(eq(operationContinuations.id, input.continuationId))
        .limit(1);
      if (
        !base?.actorId ||
        base.operationStatus !== 'running' ||
        base.cancelRequestedAt
      ) {
        return { status: 'not_claimed' };
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
            inArray(notebookMemberships.role, [
              'owner',
              'editor',
              'contributor',
            ]),
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
      if (!claimed) return { status: 'not_claimed' };
      return {
        status: 'claimed',
        continuation: toSnapshot(claimed),
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

  async heartbeat(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseGeneration: number;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<boolean> {
    const duration = validateLeaseDuration(input.leaseDurationMs);
    if (
      !isSafeOpaqueId(input.ownerId) ||
      !Number.isSafeInteger(input.leaseGeneration) ||
      input.leaseGeneration < 1
    ) {
      throw new OperationContinuationLifecycleError('continuation lease无效');
    }
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
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

  async release(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseGeneration: number;
    now?: Date;
  }): Promise<{
    continuation: OperationContinuationSnapshot;
    transitioned: boolean;
  }> {
    if (
      !isSafeOpaqueId(input.ownerId) ||
      !Number.isSafeInteger(input.leaseGeneration) ||
      input.leaseGeneration < 1
    ) {
      throw new OperationContinuationLifecycleError('continuation lease无效');
    }
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
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
        return { continuation: toSnapshot(updated), transitioned: true };
      }
      const current = await requireOwnedContinuation(transaction, input);
      if (
        current.status === 'ready' &&
        current.leaseGeneration === input.leaseGeneration
      ) {
        return { continuation: toSnapshot(current), transitioned: false };
      }
      throw new OperationContinuationConflictError('continuation lease已失效');
    });
  }

  async settle(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseGeneration: number;
    status: OperationContinuationTerminalStatus;
    failureCode?: string | null;
    now?: Date;
  }): Promise<{
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
    return this.database.transaction(async (transaction) => {
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
        return { continuation: toSnapshot(updated), transitioned: true };
      }
      const current = await requireOwnedContinuation(transaction, input);
      if (
        current.status === input.status &&
        current.failureCode === failureCode &&
        current.leaseGeneration === input.leaseGeneration
      ) {
        return { continuation: toSnapshot(current), transitioned: false };
      }
      throw new OperationContinuationConflictError('continuation终态冲突');
    });
  }

  async cancel(input: {
    operationId: string;
    actorId: string;
    now?: Date;
  }): Promise<{
    continuation: OperationContinuationSnapshot;
    transitioned: boolean;
  }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
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
        return { continuation: toSnapshot(updated), transitioned: true };
      }
      const [current] = await transaction
        .select()
        .from(operationContinuations)
        .where(eq(operationContinuations.operationId, input.operationId))
        .orderBy(desc(operationContinuations.sequence))
        .limit(1);
      if (!current) throw new OperationContinuationOwnershipError();
      if (current.status === 'cancelled') {
        return { continuation: toSnapshot(current), transitioned: false };
      }
      throw new OperationContinuationConflictError(
        '已终态continuation不能改为cancelled',
      );
    });
  }
}
