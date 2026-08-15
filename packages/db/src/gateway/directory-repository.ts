import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import {
  type GatewayConversationDirectoryEntry as GatewayConversationDirectoryContractEntry,
  type GatewayResolvedRoute,
} from '@educanvas/gateway-core';
import { getDb } from '../client';
import { conversations, notebookMemberships, spaces } from '../schema';
import { ensurePersonalIdentity } from './identity-repository';
import { GatewayPersistenceError, type Database } from './persistence';

/**
 * Conversation Directory 边界：列出用户可见的会话，并在本地/IdP 引导时原子确保一个可用的个人 Notebook。
 */

export interface GatewayConversationDirectoryEntry {
  notebookId: string;
  conversationId: string;
  title: string | null;
  agentProfileId: string;
  membershipRole: GatewayResolvedRoute['membershipRole'];
}

export type GatewayConversationDirectoryPageEntry =
  GatewayConversationDirectoryContractEntry;

export interface GatewayConversationDirectoryCursor {
  lastActivityAt: Date;
  conversationId: string;
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

  async listConversationPage(input: {
    userId: string;
    limit: number;
    cursor?: GatewayConversationDirectoryCursor | null;
    now?: Date;
  }): Promise<{
    items: readonly GatewayConversationDirectoryPageEntry[];
    nextCursor: GatewayConversationDirectoryCursor | null;
  }> {
    const now = input.now ?? new Date();
    const cursorCondition = input.cursor
      ? or(
          lt(conversations.lastActivityAt, input.cursor.lastActivityAt),
          and(
            eq(conversations.lastActivityAt, input.cursor.lastActivityAt),
            lt(conversations.id, input.cursor.conversationId),
          ),
        )
      : undefined;
    const rows = await this.database
      .select({
        notebookId: conversations.spaceId,
        notebookTitle: spaces.title,
        conversationId: conversations.id,
        title: conversations.title,
        agentProfileId: conversations.agentProfileId,
        membershipRole: notebookMemberships.role,
        lastActivityAt: conversations.lastActivityAt,
      })
      .from(conversations)
      .innerJoin(spaces, eq(spaces.id, conversations.spaceId))
      .innerJoin(
        notebookMemberships,
        eq(notebookMemberships.notebookId, conversations.spaceId),
      )
      .where(
        and(
          eq(notebookMemberships.userId, input.userId),
          eq(spaces.status, 'active'),
          eq(conversations.status, 'active'),
          isNull(notebookMemberships.revokedAt),
          or(
            isNull(notebookMemberships.expiresAt),
            gt(notebookMemberships.expiresAt, now),
          ),
          cursorCondition,
        ),
      )
      .orderBy(desc(conversations.lastActivityAt), desc(conversations.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        ...row,
        lastActivityAt: row.lastActivityAt.toISOString(),
        membershipRole:
          row.membershipRole as GatewayResolvedRoute['membershipRole'],
      })),
      nextCursor:
        hasMore && last
          ? {
              lastActivityAt: last.lastActivityAt,
              conversationId: last.conversationId,
            }
          : null,
    };
  }

  async createConversation(input: {
    userId: string;
    notebookId?: string;
    title: string;
    now?: Date;
  }): Promise<GatewayConversationDirectoryPageEntry> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      if (!input.notebookId) {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, 0))`,
        );
        await ensurePersonalIdentity(transaction, {
          userId: input.userId,
          kind: 'registered',
          now,
        });
      }

      const membershipQuery = transaction
        .select({
          notebookId: spaces.id,
          notebookTitle: spaces.title,
          membershipRole: notebookMemberships.role,
        })
        .from(spaces)
        .innerJoin(
          notebookMemberships,
          and(
            eq(notebookMemberships.notebookId, spaces.id),
            eq(notebookMemberships.userId, input.userId),
          ),
        )
        .where(
          and(
            input.notebookId ? eq(spaces.id, input.notebookId) : undefined,
            eq(spaces.status, 'active'),
            isNull(notebookMemberships.revokedAt),
            or(
              isNull(notebookMemberships.expiresAt),
              gt(notebookMemberships.expiresAt, now),
            ),
            or(
              eq(notebookMemberships.role, 'owner'),
              eq(notebookMemberships.role, 'editor'),
            ),
          ),
        )
        .orderBy(desc(spaces.updatedAt), desc(spaces.id))
        .limit(1);
      let [membership] = await membershipQuery;
      if (!membership && !input.notebookId) {
        const [notebook] = await transaction
          .insert(spaces)
          .values({
            ownerSubjectId: input.userId,
            kind: 'notebook',
            title: '我的学习笔记本',
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: spaces.id, title: spaces.title });
        if (!notebook) throw new Error('Default Notebook write failed');
        await transaction.insert(notebookMemberships).values({
          notebookId: notebook.id,
          userId: input.userId,
          role: 'owner',
          grantedByUserId: input.userId,
          grantedAt: now,
        });
        membership = {
          notebookId: notebook.id,
          notebookTitle: notebook.title,
          membershipRole: 'owner',
        };
      }
      if (!membership)
        throw new GatewayPersistenceError(
          'forbidden',
          'Conversation creation denied',
        );
      const [created] = await transaction
        .insert(conversations)
        .values({
          spaceId: membership.notebookId,
          ownerSubjectId: input.userId,
          agentProfileId: 'general',
          title: input.title,
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          conversationId: conversations.id,
          title: conversations.title,
          agentProfileId: conversations.agentProfileId,
          lastActivityAt: conversations.lastActivityAt,
        });
      if (!created) throw new Error('Conversation write failed');
      return {
        notebookId: membership.notebookId,
        notebookTitle: membership.notebookTitle,
        conversationId: created.conversationId,
        title: created.title,
        agentProfileId: created.agentProfileId,
        membershipRole:
          membership.membershipRole as GatewayResolvedRoute['membershipRole'],
        lastActivityAt: created.lastActivityAt.toISOString(),
      };
    });
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
