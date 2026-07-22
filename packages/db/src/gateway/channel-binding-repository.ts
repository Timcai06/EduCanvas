import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import {
  notebookRoleAllows,
  type GatewayResolvedRoute,
} from '@educanvas/gateway-core';
import { getDb } from '../client';
import {
  conversations,
  gatewayChannelAccountBindings,
  gatewayChannelThreadBindings,
  notebookMemberships,
} from '../schema';
import { ensurePersonalIdentity } from './identity-repository';
import { GatewayPersistenceError, type Database } from './persistence';

/**
 * Channel Binding 边界：解析并原子建立外部渠道账号/线程到内部会话的私聊绑定。
 * 绑定前必须校验调用者对目标会话具备 reply 权限，且外部账号未归属其他用户。
 */

export interface GatewayChannelPrivateRoute {
  accountBindingId: string;
  threadBindingId: string;
  externalUserId: string;
  externalThreadId: string;
  userId: string;
  agentId: string;
  notebookId: string;
  conversationId: string;
}

export class DrizzleGatewayChannelBindingRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async resolvePrivate(input: {
    adapterId: string;
    externalUserId: string;
    externalThreadId: string;
  }): Promise<GatewayChannelPrivateRoute | null> {
    const [row] = await this.database
      .select({
        accountBindingId: gatewayChannelAccountBindings.id,
        threadBindingId: gatewayChannelThreadBindings.id,
        externalUserId: gatewayChannelAccountBindings.externalAccountId,
        externalThreadId: gatewayChannelThreadBindings.externalThreadId,
        userId: gatewayChannelAccountBindings.userId,
        agentId: gatewayChannelAccountBindings.agentId,
        notebookId: gatewayChannelThreadBindings.notebookId,
        conversationId: gatewayChannelThreadBindings.conversationId,
      })
      .from(gatewayChannelAccountBindings)
      .innerJoin(
        gatewayChannelThreadBindings,
        eq(
          gatewayChannelThreadBindings.accountBindingId,
          gatewayChannelAccountBindings.id,
        ),
      )
      .where(
        and(
          eq(gatewayChannelAccountBindings.adapterId, input.adapterId),
          eq(
            gatewayChannelAccountBindings.externalAccountId,
            input.externalUserId,
          ),
          eq(
            gatewayChannelThreadBindings.externalThreadId,
            input.externalThreadId,
          ),
          eq(gatewayChannelAccountBindings.status, 'active'),
          isNull(gatewayChannelAccountBindings.revokedAt),
          eq(gatewayChannelThreadBindings.status, 'active'),
          isNull(gatewayChannelThreadBindings.revokedAt),
          eq(gatewayChannelThreadBindings.threadKind, 'private'),
        ),
      )
      .limit(1);
    return row?.conversationId
      ? { ...row, conversationId: row.conversationId }
      : null;
  }

  async bindPrivate(input: {
    adapterId: string;
    externalUserId: string;
    externalThreadId: string;
    userId: string;
    conversationId: string;
    now?: Date;
  }): Promise<GatewayChannelPrivateRoute> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const identity = await ensurePersonalIdentity(transaction, {
        userId: input.userId,
        kind: 'registered',
        now,
      });
      const [route] = await transaction
        .select({
          notebookId: conversations.spaceId,
          role: notebookMemberships.role,
        })
        .from(conversations)
        .innerJoin(
          notebookMemberships,
          eq(notebookMemberships.notebookId, conversations.spaceId),
        )
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.status, 'active'),
            eq(notebookMemberships.userId, input.userId),
            isNull(notebookMemberships.revokedAt),
            or(
              isNull(notebookMemberships.expiresAt),
              gt(notebookMemberships.expiresAt, now),
            ),
          ),
        )
        .limit(1);
      if (
        !route ||
        !notebookRoleAllows(
          route.role as GatewayResolvedRoute['membershipRole'],
          'conversation.reply',
        )
      ) {
        throw new GatewayPersistenceError(
          'forbidden',
          'Cannot bind channel to inaccessible conversation',
        );
      }
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-channel-bind-v1:${input.adapterId}:${input.externalUserId}`}, 0))`,
      );
      const [existingAccount] = await transaction
        .select({ userId: gatewayChannelAccountBindings.userId })
        .from(gatewayChannelAccountBindings)
        .where(
          and(
            eq(gatewayChannelAccountBindings.adapterId, input.adapterId),
            eq(
              gatewayChannelAccountBindings.externalAccountId,
              input.externalUserId,
            ),
          ),
        )
        .limit(1);
      if (existingAccount && existingAccount.userId !== identity.userId) {
        throw new GatewayPersistenceError(
          'forbidden',
          'External channel account already belongs to another user',
        );
      }
      const [account] = await transaction
        .insert(gatewayChannelAccountBindings)
        .values({
          adapterId: input.adapterId,
          externalAccountId: input.externalUserId,
          userId: identity.userId,
          agentId: identity.agentId,
          status: 'active',
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [
            gatewayChannelAccountBindings.adapterId,
            gatewayChannelAccountBindings.externalAccountId,
          ],
          set: {
            status: 'active',
            activationExpiresAt: null,
            revokedAt: null,
          },
        })
        .returning({ id: gatewayChannelAccountBindings.id });
      if (!account) {
        throw new GatewayPersistenceError(
          'operation_not_found',
          'Channel account binding failed',
        );
      }
      const [thread] = await transaction
        .insert(gatewayChannelThreadBindings)
        .values({
          accountBindingId: account.id,
          externalThreadId: input.externalThreadId,
          threadKind: 'private',
          notebookId: route.notebookId,
          conversationId: input.conversationId,
          status: 'active',
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [
            gatewayChannelThreadBindings.accountBindingId,
            gatewayChannelThreadBindings.externalThreadId,
          ],
          set: {
            threadKind: 'private',
            notebookId: route.notebookId,
            conversationId: input.conversationId,
            status: 'active',
            revokedAt: null,
          },
        })
        .returning({ id: gatewayChannelThreadBindings.id });
      if (!thread) {
        throw new GatewayPersistenceError(
          'operation_not_found',
          'Channel thread binding failed',
        );
      }
      return {
        accountBindingId: account.id,
        threadBindingId: thread.id,
        externalUserId: input.externalUserId,
        externalThreadId: input.externalThreadId,
        userId: identity.userId,
        agentId: identity.agentId,
        notebookId: route.notebookId,
        conversationId: input.conversationId,
      };
    });
  }
}
