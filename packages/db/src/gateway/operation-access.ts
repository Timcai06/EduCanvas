import {
  gatewayOperationEventSchema,
  notebookMembershipRoleSchema,
  notebookRoleAllows,
  type GatewayOperationEvent,
  type NotebookPermission,
  type NotebookMembershipRole,
} from '@educanvas/gateway-core';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  agentOperations,
  conversations,
  gatewayOperationEvents,
  notebookMemberships,
  operationContinuations,
} from '../schema';
import {
  cancelContinuationWithinTransaction,
  normalizeOperationStatus,
} from './operation-event-writer';
import {
  GatewayPersistenceError,
  type Database,
  type DatabaseExecutor,
} from './persistence';

export interface GatewayCurrentOperationAccess {
  operationId: string;
  actorUserId: string;
  role: NotebookMembershipRole;
  status: string;
}

/**
 * Operation 控制面每次访问都以当前 Membership 为准，而不是信任 Operation 创建时的路由快照。
 * mutation=true 时锁定 Membership 行，使撤销与审批/取消在 PostgreSQL 中形成明确提交顺序。
 */
export async function findCurrentOperationAccess(
  database: DatabaseExecutor,
  input: {
    operationId: string;
    actorUserId: string;
    requiredPermission: NotebookPermission;
    now: Date;
    mutation?: boolean;
  },
): Promise<GatewayCurrentOperationAccess | null> {
  const query = database
    .select({
      operationId: agentOperations.id,
      actorUserId: agentOperations.actorUserId,
      role: notebookMemberships.role,
      status: agentOperations.status,
    })
    .from(agentOperations)
    .innerJoin(
      conversations,
      eq(conversations.id, agentOperations.conversationId),
    )
    .innerJoin(
      notebookMemberships,
      and(
        eq(notebookMemberships.notebookId, agentOperations.notebookId),
        eq(notebookMemberships.userId, input.actorUserId),
      ),
    )
    .where(
      and(
        eq(agentOperations.id, input.operationId),
        eq(agentOperations.actorUserId, input.actorUserId),
        eq(conversations.spaceId, agentOperations.notebookId),
        eq(conversations.status, 'active'),
        isNull(notebookMemberships.revokedAt),
        or(
          isNull(notebookMemberships.expiresAt),
          gt(notebookMemberships.expiresAt, input.now),
        ),
      ),
    )
    .limit(1);
  const [row] = input.mutation
    ? await query.for('update', { of: notebookMemberships })
    : await query;
  if (!row || row.actorUserId === null) return null;
  const parsedRole = notebookMembershipRoleSchema.safeParse(row.role);
  if (
    !parsedRole.success ||
    !notebookRoleAllows(parsedRole.data, input.requiredPermission)
  ) {
    return null;
  }
  return {
    operationId: row.operationId,
    actorUserId: row.actorUserId,
    role: parsedRole.data,
    status: row.status,
  };
}

export async function describeCurrentGatewayOperation(
  database: Database,
  input: {
    operationId: string;
    actorUserId: string;
    now: Date;
  },
): Promise<{
  operationId: string;
  actorUserId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
} | null> {
  const access = await findCurrentOperationAccess(database, {
    ...input,
    requiredPermission: 'conversation.reply',
  });
  if (!access) return null;
  return {
    operationId: input.operationId,
    actorUserId: access.actorUserId,
    status:
      access.status === 'running' || access.status === 'pending'
        ? 'running'
        : normalizeOperationStatus(access.status),
  };
}

export async function requestCurrentGatewayOperationCancellation(
  database: Database,
  input: {
    operationId: string;
    actorUserId: string;
    now: Date;
  },
): Promise<{
  recorded: boolean;
  continuation: 'none' | 'running' | 'cancelled';
}> {
  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-event-v1:${input.operationId}`}, 0))`,
    );
    const access = await findCurrentOperationAccess(transaction, {
      ...input,
      requiredPermission: 'conversation.reply',
      mutation: true,
    });
    if (
      !access ||
      (access.status !== 'pending' && access.status !== 'running')
    ) {
      return { recorded: false, continuation: 'none' };
    }
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
      const cancelled = await cancelContinuationWithinTransaction(transaction, {
        operationId: input.operationId,
        actorUserId: input.actorUserId,
        statuses: ['waiting_approval', 'ready'],
        now: input.now,
      });
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

export async function listRecentCurrentGatewayOperations(
  database: Database,
  input: {
    actorUserId: string;
    limit: number;
    now: Date;
  },
): Promise<
  readonly {
    operationId: string;
    conversationId: string;
    conversationTitle: string | null;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    createdAt: string;
  }[]
> {
  const rows = await database
    .select({
      operationId: agentOperations.id,
      conversationId: agentOperations.conversationId,
      title: conversations.title,
      status: agentOperations.status,
      createdAt: agentOperations.createdAt,
      membershipRole: notebookMemberships.role,
    })
    .from(agentOperations)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, agentOperations.conversationId),
        eq(conversations.spaceId, agentOperations.notebookId),
      ),
    )
    .innerJoin(
      notebookMemberships,
      and(
        eq(notebookMemberships.notebookId, agentOperations.notebookId),
        eq(notebookMemberships.userId, input.actorUserId),
      ),
    )
    .where(
      and(
        eq(agentOperations.actorUserId, input.actorUserId),
        eq(agentOperations.kind, 'turn'),
        eq(conversations.status, 'active'),
        isNull(notebookMemberships.revokedAt),
        or(
          isNull(notebookMemberships.expiresAt),
          gt(notebookMemberships.expiresAt, input.now),
        ),
      ),
    )
    .orderBy(desc(agentOperations.createdAt), desc(agentOperations.id))
    .limit(Math.min(Math.max(input.limit, 1), 50));
  return rows.flatMap((row) => {
    const role = notebookMembershipRoleSchema.safeParse(row.membershipRole);
    if (!role.success || !notebookRoleAllows(role.data, 'notebook.read')) {
      return [];
    }
    return [
      {
        operationId: row.operationId,
        conversationId: row.conversationId,
        conversationTitle: row.title,
        status:
          row.status === 'running' || row.status === 'pending'
            ? ('running' as const)
            : normalizeOperationStatus(row.status),
        createdAt: row.createdAt.toISOString(),
      },
    ];
  });
}

export async function listCurrentGatewayOperationEvents(
  database: Database,
  input: {
    operationId: string;
    afterSequence: number;
    actorUserId: string;
    now: Date;
  },
): Promise<readonly GatewayOperationEvent[]> {
  const access = await findCurrentOperationAccess(database, {
    operationId: input.operationId,
    actorUserId: input.actorUserId,
    requiredPermission: 'notebook.read',
    now: input.now,
  });
  if (!access) {
    throw new GatewayPersistenceError(
      'operation_not_found',
      'Operation not found',
    );
  }
  const rows = await database
    .select({ payload: gatewayOperationEvents.payload })
    .from(gatewayOperationEvents)
    .where(
      and(
        eq(gatewayOperationEvents.operationId, input.operationId),
        gt(gatewayOperationEvents.sequence, input.afterSequence),
      ),
    )
    .orderBy(asc(gatewayOperationEvents.sequence));
  return rows.map(({ payload }) => gatewayOperationEventSchema.parse(payload));
}
