import { and, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { personalAgents, platformUsers } from '../schema';
import {
  GatewayPersistenceError,
  type Database,
  type DatabaseExecutor,
} from './persistence';

/**
 * Personal Identity 边界：保证 Platform User 与其 Personal Agent 的存在与激活。
 * ensurePersonalIdentity 由 Directory/Channel/Node 等多个 Gateway 仓储在各自事务内复用，
 * 因此接受调用方提供的 executor（Database 或 Transaction），不自行开启事务。
 */

export interface GatewayIdentitySnapshot {
  userId: string;
  agentId: string;
  kind: 'registered' | 'anonymous_compat';
}

export async function ensurePersonalIdentity(
  executor: DatabaseExecutor,
  input: {
    userId: string;
    kind: GatewayIdentitySnapshot['kind'];
    now: Date;
  },
): Promise<GatewayIdentitySnapshot> {
  const userId = input.userId.trim();
  if (!userId || userId.length > 160) {
    throw new GatewayPersistenceError(
      'identity_not_found',
      'User identifier is invalid',
    );
  }
  await executor
    .insert(platformUsers)
    .values({
      id: userId,
      kind: input.kind,
      status: 'active',
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing();
  await executor
    .insert(personalAgents)
    .values({
      userId,
      status: 'active',
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing();

  const [identity] = await executor
    .select({
      userId: platformUsers.id,
      kind: platformUsers.kind,
      userStatus: platformUsers.status,
      agentId: personalAgents.id,
      agentStatus: personalAgents.status,
    })
    .from(platformUsers)
    .innerJoin(personalAgents, eq(personalAgents.userId, platformUsers.id))
    .where(eq(platformUsers.id, userId))
    .limit(1);
  if (
    !identity ||
    identity.userStatus !== 'active' ||
    identity.agentStatus !== 'active' ||
    identity.kind !== input.kind
  ) {
    throw new GatewayPersistenceError(
      'identity_not_found',
      'Active personal identity is unavailable',
    );
  }
  return {
    userId: identity.userId,
    agentId: identity.agentId,
    kind: identity.kind as GatewayIdentitySnapshot['kind'],
  };
}

export class DrizzleGatewayIdentityRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async ensureAnonymousCompatibility(input: {
    trustedSubjectId: string;
    now?: Date;
  }): Promise<GatewayIdentitySnapshot> {
    return this.database.transaction((transaction) =>
      ensurePersonalIdentity(transaction, {
        userId: input.trustedSubjectId,
        kind: 'anonymous_compat',
        now: input.now ?? new Date(),
      }),
    );
  }

  async ensureRegistered(input: {
    trustedSubjectId: string;
    now?: Date;
  }): Promise<GatewayIdentitySnapshot> {
    return this.database.transaction((transaction) =>
      ensurePersonalIdentity(transaction, {
        userId: input.trustedSubjectId,
        kind: 'registered',
        now: input.now ?? new Date(),
      }),
    );
  }

  async getActive(userId: string): Promise<GatewayIdentitySnapshot | null> {
    const [identity] = await this.database
      .select({
        userId: platformUsers.id,
        kind: platformUsers.kind,
        agentId: personalAgents.id,
      })
      .from(platformUsers)
      .innerJoin(personalAgents, eq(personalAgents.userId, platformUsers.id))
      .where(
        and(
          eq(platformUsers.id, userId),
          eq(platformUsers.status, 'active'),
          eq(personalAgents.status, 'active'),
        ),
      )
      .limit(1);
    return identity
      ? {
          userId: identity.userId,
          agentId: identity.agentId,
          kind: identity.kind as GatewayIdentitySnapshot['kind'],
        }
      : null;
  }
}
