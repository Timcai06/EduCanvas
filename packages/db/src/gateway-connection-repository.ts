import { randomUUID } from 'node:crypto';
import {
  notebookRoleAllows,
  type GatewayChannelConnection,
  type GatewayConnectionProvider,
  type GatewayResolvedRoute,
} from '@educanvas/gateway-core';
import { and, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  ensurePersonalIdentity,
  GatewayPersistenceError,
  type GatewayChannelPrivateRoute,
} from './gateway-repository';
import {
  conversations,
  gatewayChannelAccountBindings,
  gatewayChannelThreadBindings,
  notebookMemberships,
} from './schema';

type Database = ReturnType<typeof getDb>;

const PROVIDER_ADAPTERS = {
  telegram: 'telegram.bot',
  wechat: 'wechat.official',
  qq: 'qq.bot',
} as const satisfies Record<GatewayConnectionProvider, string>;

function providerForAdapter(
  adapterId: string,
): GatewayConnectionProvider | null {
  const entry = Object.entries(PROVIDER_ADAPTERS).find(
    ([, candidate]) => candidate === adapterId,
  );
  return (entry?.[0] as GatewayConnectionProvider | undefined) ?? null;
}

interface ConnectionRow {
  connectionId: string;
  adapterId: string;
  status: string;
  conversationId: string | null;
  createdAt: Date;
  activationExpiresAt: Date | null;
  revokedAt: Date | null;
}

function toConnection(row: ConnectionRow): GatewayChannelConnection | null {
  const provider = providerForAdapter(row.adapterId);
  if (!provider || !row.conversationId) return null;
  return {
    connectionId: row.connectionId,
    provider,
    status: row.status as GatewayChannelConnection['status'],
    conversationId: row.conversationId,
    createdAt: row.createdAt.toISOString(),
    activationExpiresAt: row.activationExpiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Provider-neutral Connections 的 PostgreSQL 适配器。用户面只读写产品级 provider；
 * Adapter ID、外部账号/线程 ID 与激活码只留在服务端绑定表中。
 */
export class DrizzleGatewayConnectionRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async list(userId: string): Promise<readonly GatewayChannelConnection[]> {
    const rows = await this.database
      .select({
        connectionId: gatewayChannelAccountBindings.id,
        adapterId: gatewayChannelAccountBindings.adapterId,
        status: gatewayChannelAccountBindings.status,
        conversationId: gatewayChannelThreadBindings.conversationId,
        createdAt: gatewayChannelAccountBindings.createdAt,
        activationExpiresAt: gatewayChannelAccountBindings.activationExpiresAt,
        revokedAt: gatewayChannelAccountBindings.revokedAt,
      })
      .from(gatewayChannelAccountBindings)
      .innerJoin(
        gatewayChannelThreadBindings,
        eq(
          gatewayChannelThreadBindings.accountBindingId,
          gatewayChannelAccountBindings.id,
        ),
      )
      .where(eq(gatewayChannelAccountBindings.userId, userId))
      .orderBy(
        desc(gatewayChannelAccountBindings.createdAt),
        desc(gatewayChannelAccountBindings.id),
      )
      .limit(100);
    const seen = new Set<string>();
    return rows
      .map((row) => toConnection(row))
      .filter((row): row is GatewayChannelConnection => {
        if (!row || seen.has(row.connectionId)) return false;
        seen.add(row.connectionId);
        return true;
      });
  }

  async begin(input: {
    provider: GatewayConnectionProvider;
    userId: string;
    conversationId: string;
    now: Date;
    activationExpiresAt: Date;
  }): Promise<GatewayChannelConnection> {
    const adapterId = PROVIDER_ADAPTERS[input.provider];
    return this.database.transaction(async (transaction) => {
      const identity = await ensurePersonalIdentity(transaction, {
        userId: input.userId,
        kind: input.userId.startsWith('anon:')
          ? 'anonymous_compat'
          : 'registered',
        now: input.now,
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
            eq(notebookMemberships.userId, identity.userId),
            isNull(notebookMemberships.revokedAt),
            or(
              isNull(notebookMemberships.expiresAt),
              gt(notebookMemberships.expiresAt, input.now),
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
          'Cannot connect a channel to an inaccessible conversation',
        );
      }

      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-connection-start-v1:${identity.userId}:${adapterId}`}, 0))`,
      );
      const [existing] = await transaction
        .select({
          id: gatewayChannelAccountBindings.id,
          status: gatewayChannelAccountBindings.status,
          activationExpiresAt:
            gatewayChannelAccountBindings.activationExpiresAt,
        })
        .from(gatewayChannelAccountBindings)
        .where(
          and(
            eq(gatewayChannelAccountBindings.userId, identity.userId),
            eq(gatewayChannelAccountBindings.adapterId, adapterId),
            ne(gatewayChannelAccountBindings.status, 'revoked'),
          ),
        )
        .orderBy(desc(gatewayChannelAccountBindings.createdAt))
        .limit(1);
      const pendingExpired =
        existing?.status === 'pending' &&
        existing.activationExpiresAt !== null &&
        existing.activationExpiresAt <= input.now;
      if (existing && !pendingExpired) {
        throw new GatewayPersistenceError(
          'idempotency_conflict',
          'A non-revoked connection for this provider already exists',
        );
      }
      if (existing) {
        await transaction
          .update(gatewayChannelAccountBindings)
          .set({
            status: 'revoked',
            activationExpiresAt: null,
            revokedAt: input.now,
          })
          .where(eq(gatewayChannelAccountBindings.id, existing.id));
        await transaction
          .update(gatewayChannelThreadBindings)
          .set({ status: 'revoked', revokedAt: input.now })
          .where(
            eq(gatewayChannelThreadBindings.accountBindingId, existing.id),
          );
      }

      const connectionId = randomUUID();
      const threadBindingId = randomUUID();
      const pendingExternalId = `pending:${connectionId}`;
      await transaction.insert(gatewayChannelAccountBindings).values({
        id: connectionId,
        adapterId,
        externalAccountId: pendingExternalId,
        userId: identity.userId,
        agentId: identity.agentId,
        status: 'pending',
        createdAt: input.now,
        activationExpiresAt: input.activationExpiresAt,
      });
      await transaction.insert(gatewayChannelThreadBindings).values({
        id: threadBindingId,
        accountBindingId: connectionId,
        externalThreadId: pendingExternalId,
        threadKind: 'private',
        notebookId: route.notebookId,
        conversationId: input.conversationId,
        status: 'pending',
        createdAt: input.now,
      });
      return {
        connectionId,
        provider: input.provider,
        status: 'pending',
        conversationId: input.conversationId,
        createdAt: input.now.toISOString(),
        activationExpiresAt: input.activationExpiresAt.toISOString(),
        revokedAt: null,
      };
    });
  }

  async revoke(input: {
    connectionId: string;
    userId: string;
    now: Date;
  }): Promise<GatewayChannelConnection> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          connectionId: gatewayChannelAccountBindings.id,
          adapterId: gatewayChannelAccountBindings.adapterId,
          status: gatewayChannelAccountBindings.status,
          conversationId: gatewayChannelThreadBindings.conversationId,
          createdAt: gatewayChannelAccountBindings.createdAt,
          activationExpiresAt:
            gatewayChannelAccountBindings.activationExpiresAt,
          revokedAt: gatewayChannelAccountBindings.revokedAt,
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
            eq(gatewayChannelAccountBindings.id, input.connectionId),
            eq(gatewayChannelAccountBindings.userId, input.userId),
          ),
        )
        .limit(1);
      const current = row ? toConnection(row) : null;
      if (!current) {
        throw new GatewayPersistenceError(
          'forbidden',
          'Connection does not belong to the current user',
        );
      }
      if (current.status === 'revoked') return current;

      await transaction
        .update(gatewayChannelAccountBindings)
        .set({
          status: 'revoked',
          activationExpiresAt: null,
          revokedAt: input.now,
        })
        .where(eq(gatewayChannelAccountBindings.id, input.connectionId));
      await transaction
        .update(gatewayChannelThreadBindings)
        .set({ status: 'revoked', revokedAt: input.now })
        .where(
          eq(gatewayChannelThreadBindings.accountBindingId, input.connectionId),
        );
      return {
        ...current,
        status: 'revoked',
        activationExpiresAt: null,
        revokedAt: input.now.toISOString(),
      };
    });
  }

  /**
   * Channel Adapter 只可用外部平台返回的账号/线程与一次性 connectionId 激活 pending；
   * 过期、重放或已被其他用户绑定的外部账号一律拒绝，绝不根据普通 bot update 自建绑定。
   */
  async activatePending(input: {
    provider: GatewayConnectionProvider;
    connectionId: string;
    externalAccountId: string;
    externalThreadId: string;
    now?: Date;
  }): Promise<GatewayChannelPrivateRoute> {
    const now = input.now ?? new Date();
    const adapterId = PROVIDER_ADAPTERS[input.provider];
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-connection-consume-v1:${adapterId}:${input.connectionId}`}, 0))`,
      );
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-connection-v1:${adapterId}:${input.externalAccountId}`}, 0))`,
      );
      const [pending] = await transaction
        .select({
          accountBindingId: gatewayChannelAccountBindings.id,
          threadBindingId: gatewayChannelThreadBindings.id,
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
            eq(gatewayChannelAccountBindings.id, input.connectionId),
            eq(gatewayChannelAccountBindings.adapterId, adapterId),
            eq(gatewayChannelAccountBindings.status, 'pending'),
            gt(gatewayChannelAccountBindings.activationExpiresAt, now),
            eq(gatewayChannelThreadBindings.status, 'pending'),
          ),
        )
        .limit(1);
      if (!pending?.conversationId) {
        throw new GatewayPersistenceError(
          'forbidden',
          'Connection activation is invalid, expired or already consumed',
        );
      }
      const [existing] = await transaction
        .select({
          id: gatewayChannelAccountBindings.id,
          userId: gatewayChannelAccountBindings.userId,
          status: gatewayChannelAccountBindings.status,
        })
        .from(gatewayChannelAccountBindings)
        .where(
          and(
            eq(gatewayChannelAccountBindings.adapterId, adapterId),
            eq(
              gatewayChannelAccountBindings.externalAccountId,
              input.externalAccountId,
            ),
            ne(gatewayChannelAccountBindings.id, input.connectionId),
          ),
        )
        .limit(1);
      if (
        existing &&
        (existing.status !== 'revoked' || existing.userId !== pending.userId)
      ) {
        throw new GatewayPersistenceError(
          'forbidden',
          'External channel account is already bound',
        );
      }
      if (existing) {
        /* 同一用户可重新连接自己已撤销的外部账号；旧记录仍保留主体与 revokedAt，
           但释放唯一外部 ID。不同用户的历史绑定绝不进入此分支。 */
        await transaction
          .update(gatewayChannelAccountBindings)
          .set({ externalAccountId: `retired:${existing.id}` })
          .where(eq(gatewayChannelAccountBindings.id, existing.id));
      }
      await transaction
        .update(gatewayChannelAccountBindings)
        .set({
          externalAccountId: input.externalAccountId,
          status: 'active',
          activationExpiresAt: null,
          revokedAt: null,
        })
        .where(eq(gatewayChannelAccountBindings.id, input.connectionId));
      await transaction
        .update(gatewayChannelThreadBindings)
        .set({
          externalThreadId: input.externalThreadId,
          status: 'active',
          revokedAt: null,
        })
        .where(
          eq(gatewayChannelThreadBindings.accountBindingId, input.connectionId),
        );
      return {
        accountBindingId: pending.accountBindingId,
        threadBindingId: pending.threadBindingId,
        externalUserId: input.externalAccountId,
        externalThreadId: input.externalThreadId,
        userId: pending.userId,
        agentId: pending.agentId,
        notebookId: pending.notebookId,
        conversationId: pending.conversationId,
      };
    });
  }
}
