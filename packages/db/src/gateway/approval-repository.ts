import { and, asc, eq, gt } from 'drizzle-orm';
import { getDb } from '../client';
import { gatewayApprovals } from '../schema';
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
      .select()
      .from(gatewayApprovals)
      .where(
        and(
          eq(gatewayApprovals.actorUserId, actorUserId),
          eq(gatewayApprovals.status, 'pending'),
          gt(gatewayApprovals.expiresAt, now),
        ),
      )
      .orderBy(asc(gatewayApprovals.requestedAt));
    return rows.map((row) => ({
      approvalId: row.id,
      operationId: row.operationId,
      capability: row.capability,
      risk: row.risk as 'l2' | 'l3',
      summary: row.summary,
      requestedAt: row.requestedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }));
  }
}
