import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import {
  isNotebookMembershipActive,
  notebookRoleAllows,
  type GatewayPrincipal,
  type GatewayResolvedRoute,
  type NotebookPermission,
} from '@educanvas/gateway-core';
import { getDb } from '../client';
import {
  conversations,
  notebookMemberships,
  personalAgents,
  platformUsers,
} from '../schema';
import { GatewayPersistenceError, type Database } from './persistence';

/**
 * Route Resolver 边界：把 Principal + 路由提示解析为一个可用的 Notebook/Conversation 路由，
 * 并按成员资格与所需权限执行访问控制。仅做只读解析，不改写任何持久状态。
 */
export class DrizzleGatewayRouteResolver {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async resolve(input: {
    principal: GatewayPrincipal;
    routeHint: { notebookId?: string; conversationId?: string };
    requiredPermission: NotebookPermission;
    now: Date;
  }): Promise<GatewayResolvedRoute> {
    const [agent] = await this.database
      .select({ id: personalAgents.id })
      .from(personalAgents)
      .innerJoin(platformUsers, eq(platformUsers.id, personalAgents.userId))
      .where(
        and(
          eq(personalAgents.id, input.principal.agentId),
          eq(personalAgents.userId, input.principal.userId),
          eq(personalAgents.status, 'active'),
          eq(platformUsers.status, 'active'),
        ),
      )
      .limit(1);
    if (!agent) {
      throw new GatewayPersistenceError('forbidden', 'Agent access denied');
    }

    const conditions = [
      eq(notebookMemberships.userId, input.principal.userId),
      eq(conversations.status, 'active'),
      isNull(notebookMemberships.revokedAt),
      or(
        isNull(notebookMemberships.expiresAt),
        gt(notebookMemberships.expiresAt, input.now),
      ),
    ];
    if (input.routeHint.notebookId !== undefined) {
      conditions.push(eq(conversations.spaceId, input.routeHint.notebookId));
    }
    if (input.routeHint.conversationId !== undefined) {
      conditions.push(eq(conversations.id, input.routeHint.conversationId));
    }

    const [resolved] = await this.database
      .select({
        notebookId: conversations.spaceId,
        conversationId: conversations.id,
        agentProfileId: conversations.agentProfileId,
        membershipRole: notebookMemberships.role,
        grantedByUserId: notebookMemberships.grantedByUserId,
        grantedAt: notebookMemberships.grantedAt,
        expiresAt: notebookMemberships.expiresAt,
        revokedAt: notebookMemberships.revokedAt,
      })
      .from(conversations)
      .innerJoin(
        notebookMemberships,
        eq(notebookMemberships.notebookId, conversations.spaceId),
      )
      .where(and(...conditions))
      .orderBy(desc(conversations.lastActivityAt), desc(conversations.id))
      .limit(1);
    if (!resolved) {
      throw new GatewayPersistenceError(
        'route_not_found',
        'Conversation route is unavailable',
      );
    }
    const membership = {
      notebookId: resolved.notebookId,
      userId: input.principal.userId,
      role: resolved.membershipRole as GatewayResolvedRoute['membershipRole'],
      grantedByUserId: resolved.grantedByUserId,
      grantedAt: resolved.grantedAt.toISOString(),
      expiresAt: resolved.expiresAt?.toISOString() ?? null,
      revokedAt: resolved.revokedAt?.toISOString() ?? null,
    };
    if (
      !isNotebookMembershipActive(membership, input.now) ||
      !notebookRoleAllows(membership.role, input.requiredPermission)
    ) {
      throw new GatewayPersistenceError(
        'forbidden',
        'Notebook permission denied',
      );
    }
    return {
      actorUserId: input.principal.userId,
      agentId: input.principal.agentId,
      notebookId: resolved.notebookId,
      conversationId: resolved.conversationId,
      agentProfileId: resolved.agentProfileId,
      membershipRole: membership.role,
    };
  }
}
