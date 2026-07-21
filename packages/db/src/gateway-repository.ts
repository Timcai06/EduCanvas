import { randomUUID } from 'node:crypto';
import {
  gatewayOperationEventSchema,
  gatewayNodeHeartbeatSchema,
  gatewayNodeInvocationRequestSchema,
  gatewayNodeInvocationResultSchema,
  gatewayNodePairingRequestSchema,
  gatewayProtocolVersion,
  isGatewayTerminalEvent,
  isNotebookMembershipActive,
  notebookRoleAllows,
  type GatewayOperationEvent,
  type GatewayNodeInvocationRequest,
  type GatewayNodeInvocationResult,
  type GatewayNodePairingRecord,
  type GatewayApprovalDecision,
  type GatewayPrincipal,
  type GatewayResolvedRoute,
  type NotebookPermission,
} from '@educanvas/gateway-core';
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  agentOperations,
  conversations,
  gatewayOperationEvents,
  gatewayChannelAccountBindings,
  gatewayChannelThreadBindings,
  gatewayDeliveries,
  gatewayNodeInvocations,
  gatewayNodePairings,
  gatewayApprovals,
  notebookMemberships,
  personalAgents,
  platformUsers,
  spaces,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

type GatewayEventBaseKeys =
  'protocol' | 'eventId' | 'operationId' | 'sequence' | 'occurredAt';
type GatewayEventPayload = GatewayOperationEvent extends infer Event
  ? Event extends GatewayOperationEvent
    ? Omit<Event, GatewayEventBaseKeys>
    : never
  : never;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export class GatewayPersistenceError extends Error {
  constructor(
    readonly code:
      | 'identity_not_found'
      | 'route_not_found'
      | 'forbidden'
      | 'idempotency_conflict'
      | 'operation_not_found'
      | 'invalid_event_sequence',
    message: string,
  ) {
    super(message);
    this.name = 'GatewayPersistenceError';
  }
}

export interface GatewayIdentitySnapshot {
  userId: string;
  agentId: string;
  kind: 'registered' | 'anonymous_compat';
}

export interface GatewayStoredOperationSnapshot {
  operationId: string;
  envelopeId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  route: GatewayResolvedRoute;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  replayed: boolean;
}

export interface GatewayConversationDirectoryEntry {
  notebookId: string;
  conversationId: string;
  title: string | null;
  agentProfileId: string;
  membershipRole: GatewayResolvedRoute['membershipRole'];
}

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

function normalizeOperationStatus(
  status: typeof agentOperations.$inferSelect.status,
): GatewayStoredOperationSnapshot['status'] {
  if (status === 'completed' || status === 'cancelled') return status;
  if (status === 'failed' || status === 'interrupted') return 'failed';
  return 'running';
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
      membershipRole: membership.role,
    };
  }
}

export class DrizzleGatewayDirectoryRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async listConversations(
    userId: string,
    now: Date = new Date(),
  ): Promise<readonly GatewayConversationDirectoryEntry[]> {
    const rows = await this.database
      .select({
        notebookId: conversations.spaceId,
        conversationId: conversations.id,
        title: conversations.title,
        agentProfileId: conversations.agentProfileId,
        membershipRole: notebookMemberships.role,
      })
      .from(conversations)
      .innerJoin(
        notebookMemberships,
        eq(notebookMemberships.notebookId, conversations.spaceId),
      )
      .where(
        and(
          eq(notebookMemberships.userId, userId),
          eq(conversations.status, 'active'),
          isNull(notebookMemberships.revokedAt),
          or(
            isNull(notebookMemberships.expiresAt),
            gt(notebookMemberships.expiresAt, now),
          ),
        ),
      )
      .orderBy(desc(conversations.lastActivityAt), desc(conversations.id));
    return rows.map((row) => ({
      ...row,
      membershipRole:
        row.membershipRole as GatewayResolvedRoute['membershipRole'],
    }));
  }

  /** Local/IdP onboarding boundary: ensure one usable personal Notebook atomically. */
  async ensurePersonalWorkspace(input: {
    userId: string;
    now?: Date;
  }): Promise<GatewayConversationDirectoryEntry> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, 0))`,
      );
      await ensurePersonalIdentity(transaction, {
        userId: input.userId,
        kind: 'registered',
        now,
      });
      const [existing] = await transaction
        .select({
          notebookId: conversations.spaceId,
          conversationId: conversations.id,
          title: conversations.title,
          agentProfileId: conversations.agentProfileId,
          membershipRole: notebookMemberships.role,
        })
        .from(conversations)
        .innerJoin(
          notebookMemberships,
          eq(notebookMemberships.notebookId, conversations.spaceId),
        )
        .where(
          and(
            eq(notebookMemberships.userId, input.userId),
            eq(notebookMemberships.role, 'owner'),
            eq(conversations.status, 'active'),
            isNull(notebookMemberships.revokedAt),
          ),
        )
        .orderBy(desc(conversations.lastActivityAt), desc(conversations.id))
        .limit(1);
      if (existing) {
        return {
          ...existing,
          membershipRole:
            existing.membershipRole as GatewayResolvedRoute['membershipRole'],
        };
      }

      const [notebook] = await transaction
        .insert(spaces)
        .values({
          ownerSubjectId: input.userId,
          kind: 'notebook',
          title: '我的学习笔记本',
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: spaces.id });
      if (!notebook) throw new Error('Default Notebook write failed');
      await transaction.insert(notebookMemberships).values({
        notebookId: notebook.id,
        userId: input.userId,
        role: 'owner',
        grantedByUserId: input.userId,
        grantedAt: now,
      });
      const [conversation] = await transaction
        .insert(conversations)
        .values({
          spaceId: notebook.id,
          ownerSubjectId: input.userId,
          agentProfileId: 'general',
          title: '我的学习笔记本',
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: conversations.id,
          spaceId: conversations.spaceId,
          title: conversations.title,
          agentProfileId: conversations.agentProfileId,
        });
      if (!conversation) throw new Error('Default Conversation write failed');
      return {
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
        title: conversation.title,
        agentProfileId: conversation.agentProfileId,
        membershipRole: 'owner',
      };
    });
  }
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

export class DrizzleGatewayDeliveryRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async begin(input: {
    operationId: string;
    envelopeId: string;
    targetKind: 'channel' | 'connection';
    target: Record<string, unknown>;
    now?: Date;
  }): Promise<{ deliveryId: string; replayed: boolean }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-delivery-v1:${input.envelopeId}:${input.targetKind}`}, 0))`,
      );
      const [existing] = await transaction
        .select({ id: gatewayDeliveries.id, status: gatewayDeliveries.status })
        .from(gatewayDeliveries)
        .where(
          and(
            eq(gatewayDeliveries.envelopeId, input.envelopeId),
            eq(gatewayDeliveries.targetKind, input.targetKind),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.status === 'sent' || existing.status === 'acknowledged') {
          return { deliveryId: existing.id, replayed: true };
        }
        await transaction
          .update(gatewayDeliveries)
          .set({
            attempt: sql`least(${gatewayDeliveries.attempt} + 1, 100)`,
            status: 'pending',
            externalMessageId: null,
            failureCode: null,
            updatedAt: now,
          })
          .where(eq(gatewayDeliveries.id, existing.id));
        return { deliveryId: existing.id, replayed: false };
      }
      const [delivery] = await transaction
        .insert(gatewayDeliveries)
        .values({
          operationId: input.operationId,
          envelopeId: input.envelopeId,
          targetKind: input.targetKind,
          target: input.target,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: gatewayDeliveries.id });
      if (!delivery) {
        throw new GatewayPersistenceError(
          'operation_not_found',
          'Delivery could not be created',
        );
      }
      return { deliveryId: delivery.id, replayed: false };
    });
  }

  async settle(input: {
    deliveryId: string;
    status: 'sent' | 'acknowledged' | 'failed' | 'expired';
    externalMessageId?: string | null;
    failureCode?: string | null;
    now?: Date;
  }): Promise<void> {
    if (input.status === 'failed' && !input.failureCode) {
      throw new GatewayPersistenceError(
        'invalid_event_sequence',
        'Failed delivery requires a failure code',
      );
    }
    const [updated] = await this.database
      .update(gatewayDeliveries)
      .set({
        status: input.status,
        externalMessageId: input.externalMessageId ?? null,
        failureCode: input.status === 'failed' ? input.failureCode : null,
        updatedAt: input.now ?? new Date(),
      })
      .where(eq(gatewayDeliveries.id, input.deliveryId))
      .returning({ id: gatewayDeliveries.id });
    if (!updated) {
      throw new GatewayPersistenceError(
        'operation_not_found',
        'Delivery settlement is invalid',
      );
    }
  }
}

export class DrizzleGatewayNodeRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async pair(input: {
    userId: string;
    request: unknown;
    now?: Date;
  }): Promise<GatewayNodePairingRecord> {
    const request = gatewayNodePairingRequestSchema.parse(input.request);
    const now = input.now ?? new Date();
    if (new Date(request.expiresAt).getTime() <= now.getTime()) {
      throw new GatewayPersistenceError('forbidden', 'Pairing request expired');
    }
    const allowed = request.requestedCapabilities.capabilities.every(
      (capability) =>
        capability.name === 'device.status' ||
        capability.name === 'filesystem.read_allowlisted',
    );
    if (!allowed) {
      throw new GatewayPersistenceError(
        'forbidden',
        'Pairing requested unsupported capabilities',
      );
    }
    return this.database.transaction(async (transaction) => {
      const identity = await ensurePersonalIdentity(transaction, {
        userId: input.userId,
        kind: 'registered',
        now,
      });
      const [row] = await transaction
        .insert(gatewayNodePairings)
        .values({
          userId: identity.userId,
          agentId: identity.agentId,
          displayName: request.displayName,
          devicePublicKey: request.devicePublicKey,
          approvedCapabilities: request.requestedCapabilities,
          status: 'active',
          pairedAt: now,
          lastSeenAt: now,
        })
        .returning();
      if (!row) {
        throw new GatewayPersistenceError(
          'operation_not_found',
          'Node pairing failed',
        );
      }
      return {
        pairingId: row.id,
        nodeId: row.nodeId,
        userId: row.userId,
        agentId: row.agentId,
        displayName: row.displayName,
        devicePublicKey: row.devicePublicKey,
        approvedCapabilities: row.approvedCapabilities,
        status: 'active',
        pairedAt: row.pairedAt.toISOString(),
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        revokedAt: null,
      };
    });
  }

  async getActive(nodeId: string): Promise<GatewayNodePairingRecord | null> {
    const [row] = await this.database
      .select()
      .from(gatewayNodePairings)
      .where(eq(gatewayNodePairings.nodeId, nodeId))
      .limit(1);
    if (!row || row.status !== 'active' || row.revokedAt) return null;
    return {
      pairingId: row.id,
      nodeId: row.nodeId,
      userId: row.userId,
      agentId: row.agentId,
      displayName: row.displayName,
      devicePublicKey: row.devicePublicKey,
      approvedCapabilities: row.approvedCapabilities,
      status: 'active',
      pairedAt: row.pairedAt.toISOString(),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      revokedAt: null,
    };
  }

  async heartbeat(raw: unknown, now: Date = new Date()): Promise<void> {
    const heartbeat = gatewayNodeHeartbeatSchema.parse(raw);
    const pairing = await this.getActive(heartbeat.nodeId);
    if (
      !pairing ||
      canonicalJson(pairing.approvedCapabilities) !==
        canonicalJson(heartbeat.capabilities)
    ) {
      throw new GatewayPersistenceError('forbidden', 'Node heartbeat denied');
    }
    await this.database
      .update(gatewayNodePairings)
      .set({ lastSeenAt: now, status: 'active' })
      .where(eq(gatewayNodePairings.nodeId, heartbeat.nodeId));
  }

  /**
   * 只允许 Operation 的真实 Actor/Personal Agent 调用其自有 Node。
   * 调用方不能补传主体字段；归属必须从 PostgreSQL 的 Operation 与 Pairing 事实中同事务解析。
   */
  async enqueue(raw: unknown): Promise<GatewayNodeInvocationRequest> {
    const request = gatewayNodeInvocationRequestSchema.parse(raw);
    return this.database.transaction(async (transaction) => {
      const [ownership] = await transaction
        .select({
          nodeUserId: gatewayNodePairings.userId,
          nodeAgentId: gatewayNodePairings.agentId,
          nodeStatus: gatewayNodePairings.status,
          nodeRevokedAt: gatewayNodePairings.revokedAt,
          approvedCapabilities: gatewayNodePairings.approvedCapabilities,
          operationActorUserId: agentOperations.actorUserId,
          operationAgentId: agentOperations.agentId,
        })
        .from(gatewayNodePairings)
        .innerJoin(agentOperations, eq(agentOperations.id, request.operationId))
        .where(eq(gatewayNodePairings.nodeId, request.nodeId))
        .limit(1)
        .for('update', { of: gatewayNodePairings });

      if (
        !ownership ||
        ownership.nodeStatus !== 'active' ||
        ownership.nodeRevokedAt !== null ||
        ownership.operationActorUserId !== ownership.nodeUserId ||
        ownership.operationAgentId !== ownership.nodeAgentId ||
        !ownership.approvedCapabilities.capabilities.some(
          (capability) => capability.name === request.capability,
        )
      ) {
        throw new GatewayPersistenceError(
          'forbidden',
          'Node invocation ownership or capability denied',
        );
      }

      await transaction.insert(gatewayNodeInvocations).values({
        requestId: request.requestId,
        operationId: request.operationId,
        nodeId: request.nodeId,
        capability: request.capability,
        parameters: request.parameters,
        nonce: request.nonce,
        status: 'pending',
        issuedAt: new Date(request.issuedAt),
        expiresAt: new Date(request.expiresAt),
      });
      return request;
    });
  }

  async poll(
    nodeId: string,
    now: Date = new Date(),
  ): Promise<readonly GatewayNodeInvocationRequest[]> {
    const pairing = await this.getActive(nodeId);
    if (!pairing)
      throw new GatewayPersistenceError('forbidden', 'Node revoked');
    await this.database
      .update(gatewayNodeInvocations)
      .set({ status: 'expired', completedAt: now })
      .where(
        and(
          eq(gatewayNodeInvocations.nodeId, nodeId),
          eq(gatewayNodeInvocations.status, 'pending'),
          lte(gatewayNodeInvocations.expiresAt, now),
        ),
      );
    const rows = await this.database
      .select()
      .from(gatewayNodeInvocations)
      .where(
        and(
          eq(gatewayNodeInvocations.nodeId, nodeId),
          eq(gatewayNodeInvocations.status, 'pending'),
          gt(gatewayNodeInvocations.expiresAt, now),
        ),
      )
      .orderBy(asc(gatewayNodeInvocations.issuedAt))
      .limit(20);
    return rows.map((row) =>
      gatewayNodeInvocationRequestSchema.parse({
        requestId: row.requestId,
        operationId: row.operationId,
        nodeId: row.nodeId,
        capability: row.capability,
        parameters: row.parameters,
        nonce: row.nonce,
        issuedAt: row.issuedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      }),
    );
  }

  async settle(raw: unknown): Promise<GatewayNodeInvocationResult> {
    const result = gatewayNodeInvocationResultSchema.parse(raw);
    const [updated] = await this.database
      .update(gatewayNodeInvocations)
      .set({
        status: result.status,
        result,
        completedAt: new Date(result.completedAt),
      })
      .where(
        and(
          eq(gatewayNodeInvocations.requestId, result.requestId),
          eq(gatewayNodeInvocations.nodeId, result.nodeId),
          eq(gatewayNodeInvocations.status, 'pending'),
        ),
      )
      .returning({ requestId: gatewayNodeInvocations.requestId });
    if (!updated) {
      throw new GatewayPersistenceError(
        'invalid_event_sequence',
        'Node result is replayed or unknown',
      );
    }
    return result;
  }

  async revoke(nodeId: string, now: Date = new Date()): Promise<void> {
    await this.database
      .update(gatewayNodePairings)
      .set({ status: 'revoked', revokedAt: now })
      .where(eq(gatewayNodePairings.nodeId, nodeId));
  }
}

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

  async resolve(input: {
    approvalId: string;
    actorUserId: string;
    status: 'approved' | 'denied';
    reason?: string;
    now?: Date;
  }): Promise<{ operationId: string; decision: GatewayApprovalDecision }> {
    const now = input.now ?? new Date();
    const [approval] = await this.database
      .select()
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
    if (!approval) {
      throw new GatewayPersistenceError(
        'forbidden',
        'Approval is unavailable or expired',
      );
    }
    return {
      operationId: approval.operationId,
      decision: {
        approvalId: approval.id,
        status: input.status,
        decidedByUserId: input.actorUserId,
        decidedAt: now.toISOString(),
        ...(input.reason ? { reason: input.reason } : {}),
      },
    };
  }
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
        .returning({ id: agentOperations.id });
      if (!created) {
        throw new GatewayPersistenceError(
          'operation_not_found',
          'Operation insert failed',
        );
      }
      return {
        operationId: created.id,
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
      const [operation] = await transaction
        .select({
          status: agentOperations.status,
          actorUserId: agentOperations.actorUserId,
        })
        .from(agentOperations)
        .where(eq(agentOperations.id, operationId))
        .limit(1);
      if (!operation) {
        throw new GatewayPersistenceError(
          'operation_not_found',
          'Operation not found',
        );
      }
      const terminalStatus =
        payload.type === 'operation.completed'
          ? 'completed'
          : payload.type === 'operation.cancelled'
            ? 'cancelled'
            : payload.type === 'operation.failed'
              ? 'failed'
              : null;
      const normalizedStatus = normalizeOperationStatus(operation.status);
      if (
        operation.status !== 'running' &&
        (terminalStatus === null || terminalStatus !== normalizedStatus)
      ) {
        throw new GatewayPersistenceError(
          'invalid_event_sequence',
          'Cannot append after operation terminal state',
        );
      }
      const [sequenceRow] = await transaction
        .select({
          next: sql<number>`coalesce(max(${gatewayOperationEvents.sequence}), -1) + 1`,
        })
        .from(gatewayOperationEvents)
        .where(eq(gatewayOperationEvents.operationId, operationId));
      const sequence = Number(sequenceRow?.next ?? 0);
      const event = gatewayOperationEventSchema.parse({
        ...payload,
        protocol: gatewayProtocolVersion,
        eventId: randomUUID(),
        operationId,
        sequence,
        occurredAt: now.toISOString(),
      });
      await transaction.insert(gatewayOperationEvents).values({
        id: event.eventId,
        operationId,
        sequence,
        type: event.type,
        payload: event,
        occurredAt: now,
      });
      if (event.type === 'approval.required') {
        if (event.approval.actorUserId !== operation.actorUserId) {
          throw new GatewayPersistenceError(
            'invalid_event_sequence',
            'Approval actor does not own operation',
          );
        }
        await transaction.insert(gatewayApprovals).values({
          id: event.approval.approvalId,
          operationId,
          actorUserId: event.approval.actorUserId,
          capability: event.approval.capability,
          risk: event.approval.risk,
          summary: event.approval.summary,
          status: 'pending',
          requestedAt: new Date(event.approval.requestedAt),
          expiresAt: new Date(event.approval.expiresAt),
        });
      } else if (event.type === 'approval.resolved') {
        const [approval] = await transaction
          .update(gatewayApprovals)
          .set({
            status: event.decision.status,
            decidedByUserId: event.decision.decidedByUserId,
            decidedAt: new Date(event.decision.decidedAt),
            reason: event.decision.reason ?? null,
          })
          .where(
            and(
              eq(gatewayApprovals.id, event.decision.approvalId),
              eq(gatewayApprovals.operationId, operationId),
              eq(gatewayApprovals.status, 'pending'),
            ),
          )
          .returning({ id: gatewayApprovals.id });
        if (!approval) {
          throw new GatewayPersistenceError(
            'invalid_event_sequence',
            'Approval is unknown or already resolved',
          );
        }
      }
      if (isGatewayTerminalEvent(event)) {
        await transaction
          .update(agentOperations)
          .set({
            status:
              event.type === 'operation.completed'
                ? 'completed'
                : event.type === 'operation.cancelled'
                  ? 'cancelled'
                  : 'failed',
            failureCode: event.type === 'operation.failed' ? event.code : null,
            completedAt: now,
          })
          .where(eq(agentOperations.id, operationId));
      }
      return event;
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
