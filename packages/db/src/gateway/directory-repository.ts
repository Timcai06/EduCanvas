import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { type GatewayResolvedRoute } from '@educanvas/gateway-core';
import { getDb } from '../client';
import { conversations, notebookMemberships, spaces } from '../schema';
import { ensurePersonalIdentity } from './identity-repository';
import { type Database } from './persistence';

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
