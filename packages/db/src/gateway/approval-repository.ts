import {
  notebookMembershipRoleSchema,
  notebookRoleAllows,
} from '@educanvas/gateway-core';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { getDb } from '../client';
import {
  agentOperations,
  conversations,
  gatewayApprovals,
  notebookMemberships,
} from '../schema';
import { type Database } from './persistence';

/**
 * Approval 只读投影边界：列出属于某 Actor 且仍在有效期内的待批准项。
 * 审批的写入与终态收敛属于 Operation Store 的原子事务，不在此处。
 */

export interface GatewayPendingApprovalSnapshot {
  approvalId: string;
  operationId: string;
  capability: string;
  risk: 'l2' | 'l3';
  summary: string;
  requestedAt: string;
  expiresAt: string;
}

export class DrizzleGatewayApprovalRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async listPending(
    actorUserId: string,
    now: Date = new Date(),
  ): Promise<readonly GatewayPendingApprovalSnapshot[]> {
    const rows = await this.database
      .select({
        id: gatewayApprovals.id,
        operationId: gatewayApprovals.operationId,
        capability: gatewayApprovals.capability,
        risk: gatewayApprovals.risk,
        summary: gatewayApprovals.summary,
        requestedAt: gatewayApprovals.requestedAt,
        expiresAt: gatewayApprovals.expiresAt,
        membershipRole: notebookMemberships.role,
      })
      .from(gatewayApprovals)
      .innerJoin(
        agentOperations,
        eq(agentOperations.id, gatewayApprovals.operationId),
      )
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
          eq(notebookMemberships.userId, actorUserId),
        ),
      )
      .where(
        and(
          eq(gatewayApprovals.actorUserId, actorUserId),
          eq(agentOperations.actorUserId, actorUserId),
          eq(gatewayApprovals.status, 'pending'),
          gt(gatewayApprovals.expiresAt, now),
          eq(conversations.status, 'active'),
          isNull(notebookMemberships.revokedAt),
          or(
            isNull(notebookMemberships.expiresAt),
            gt(notebookMemberships.expiresAt, now),
          ),
        ),
      )
      .orderBy(asc(gatewayApprovals.requestedAt));
    return rows.flatMap((row) => {
      const role = notebookMembershipRoleSchema.safeParse(row.membershipRole);
      if (
        !role.success ||
        !notebookRoleAllows(role.data, 'conversation.reply')
      ) {
        return [];
      }
      return [
        {
          approvalId: row.id,
          operationId: row.operationId,
          capability: row.capability,
          risk: row.risk as 'l2' | 'l3',
          summary: row.summary,
          requestedAt: row.requestedAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        },
      ];
    });
  }
}
