import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from './client';
import { ensurePersonalIdentity } from './gateway-repository';
import {
  conversationMessages,
  conversations,
  notebookMemberships,
  spaces,
} from './schema';

type Database = ReturnType<typeof getDb>;

export interface PlatformConversationSnapshot {
  id: string;
  spaceId: string;
  ownerSubjectId: string;
  agentProfileId: string;
  title: string | null;
  status: 'active' | 'archived';
  lastActivityAt: string;
}

export interface PlatformMessageSnapshot {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  status:
    | 'pending'
    | 'streaming'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  content: string;
  createdAt: string;
  completedAt: string | null;
}

export class PlatformConversationOwnershipError extends Error {
  readonly code = 'conversation_not_found';

  constructor() {
    super('Conversation不存在或不属于当前主体');
    this.name = 'PlatformConversationOwnershipError';
  }
}

function toConversation(
  row: typeof conversations.$inferSelect,
): PlatformConversationSnapshot {
  return {
    id: row.id,
    spaceId: row.spaceId,
    ownerSubjectId: row.ownerSubjectId,
    agentProfileId: row.agentProfileId,
    title: row.title,
    status: row.status as PlatformConversationSnapshot['status'],
    lastActivityAt: row.lastActivityAt.toISOString(),
  };
}

function toMessage(
  row: typeof conversationMessages.$inferSelect,
): PlatformMessageSnapshot {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as PlatformMessageSnapshot['role'],
    status: row.status as PlatformMessageSnapshot['status'],
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/** P1 通用持久化边界；不读取 lesson_sessions 或任何 K12 领域表。 */
export class DrizzlePlatformConversationRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async getOwned(input: {
    conversationId: string;
    trustedSubjectId: string;
  }): Promise<PlatformConversationSnapshot | null> {
    const [conversation] = await this.database
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.ownerSubjectId, input.trustedSubjectId),
          eq(conversations.status, 'active'),
        ),
      )
      .limit(1);
    return conversation ? toConversation(conversation) : null;
  }

  /** 侧栏历史列表:按最近活动排序,只返回本主体的 active 会话公开投影。 */
  async listOwnedRecent(input: {
    trustedSubjectId: string;
    limit?: number;
  }): Promise<readonly PlatformConversationSnapshot[]> {
    const rows = await this.database
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.ownerSubjectId, input.trustedSubjectId),
          eq(conversations.status, 'active'),
        ),
      )
      .orderBy(desc(conversations.lastActivityAt), desc(conversations.id))
      .limit(Math.min(input.limit ?? 30, 100));
    return rows.map(toConversation);
  }

  async create(input: {
    ownerSubjectId: string;
    spaceKind: 'personal' | 'notebook' | 'course';
    spaceTitle: string;
    agentProfileId?: string;
    conversationTitle?: string | null;
    now?: Date;
  }): Promise<PlatformConversationSnapshot> {
    if (
      !input.ownerSubjectId.trim() ||
      input.ownerSubjectId.length > 160 ||
      !input.spaceTitle.trim() ||
      input.spaceTitle.trim().length > 300 ||
      !/^[a-z][a-z0-9._-]{0,127}$/.test(input.agentProfileId ?? 'general') ||
      (input.conversationTitle?.trim().length ?? 0) > 300
    ) {
      throw new PlatformConversationOwnershipError();
    }
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await ensurePersonalIdentity(transaction, {
        userId: input.ownerSubjectId,
        kind: input.ownerSubjectId.startsWith('anon:')
          ? 'anonymous_compat'
          : 'registered',
        now,
      });
      const [space] = await transaction
        .insert(spaces)
        .values({
          ownerSubjectId: input.ownerSubjectId,
          kind: input.spaceKind,
          title: input.spaceTitle.trim(),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: spaces.id });
      if (!space) throw new Error('Space写入失败');
      await transaction.insert(notebookMemberships).values({
        notebookId: space.id,
        userId: input.ownerSubjectId,
        role: 'owner',
        grantedByUserId: input.ownerSubjectId,
        grantedAt: now,
      });
      const [conversation] = await transaction
        .insert(conversations)
        .values({
          spaceId: space.id,
          ownerSubjectId: input.ownerSubjectId,
          agentProfileId: input.agentProfileId ?? 'general',
          title: input.conversationTitle?.trim() || null,
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!conversation) throw new Error('Conversation写入失败');
      return toConversation(conversation);
    });
  }

  async appendCompletedMessage(input: {
    conversationId: string;
    trustedSubjectId: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    now?: Date;
  }): Promise<PlatformMessageSnapshot> {
    const content = input.content
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      .trim();
    if (!content || content.length > 64_000) {
      throw new PlatformConversationOwnershipError();
    }
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const [owned] = await transaction
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.ownerSubjectId, input.trustedSubjectId),
            eq(conversations.status, 'active'),
          ),
        )
        .limit(1);
      if (!owned) throw new PlatformConversationOwnershipError();
      const [message] = await transaction
        .insert(conversationMessages)
        .values({
          conversationId: input.conversationId,
          role: input.role,
          status: 'completed',
          content,
          createdAt: now,
          completedAt: now,
        })
        .returning();
      if (!message) throw new Error('Conversation Message写入失败');
      await transaction
        .update(conversations)
        .set({ lastActivityAt: now, updatedAt: now })
        .where(eq(conversations.id, input.conversationId));
      return toMessage(message);
    });
  }

  async listMessages(input: {
    conversationId: string;
    trustedSubjectId: string;
    limit?: number;
  }): Promise<readonly PlatformMessageSnapshot[]> {
    const [owned] = await this.database
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.ownerSubjectId, input.trustedSubjectId),
        ),
      )
      .limit(1);
    if (!owned) throw new PlatformConversationOwnershipError();
    const limit = Math.max(1, Math.min(input.limit ?? 100, 100));
    const rows = await this.database
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, input.conversationId))
      .orderBy(
        asc(conversationMessages.createdAt),
        asc(conversationMessages.id),
      )
      .limit(limit);
    return rows.map(toMessage);
  }
}
