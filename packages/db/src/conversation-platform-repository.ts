import type { NotebookPermission } from '@educanvas/gateway-core';
import { and, asc, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { getDb } from './client';
import { ensurePersonalIdentity } from './gateway-repository';
import { requireNotebookAccess } from './notebook-access';
import {
  boundedPageLimit,
  type CursorPage,
  type TemporalIdCursor,
} from './pagination';
import { appendSecurityAuditEvent } from './security-audit-repository';
import {
  conversationMessages,
  conversations,
  notebookMemberships,
  spaces,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

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

async function requireConversationAccess(
  executor: DatabaseExecutor,
  input: {
    conversationId: string;
    trustedSubjectId: string;
    requiredPermission: NotebookPermission;
    now?: Date;
  },
) {
  const [conversation] = await executor
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.status, 'active'),
      ),
    )
    .limit(1);
  if (!conversation) throw new PlatformConversationOwnershipError();
  const access = await requireNotebookAccess(executor, {
    notebookId: conversation.spaceId,
    trustedSubjectId: input.trustedSubjectId,
    requiredPermission: input.requiredPermission,
    now: input.now,
  }).catch(() => null);
  if (!access) throw new PlatformConversationOwnershipError();
  return conversation;
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
    const conversation = await requireConversationAccess(this.database, {
      ...input,
      requiredPermission: 'notebook.read',
    }).catch(() => null);
    return conversation === null ? null : toConversation(conversation);
  }

  /** 侧栏历史列表：按最近活动排序，只返回当前主体可读的 active 会话。 */
  async listOwnedRecent(input: {
    trustedSubjectId: string;
    limit?: number;
  }): Promise<readonly PlatformConversationSnapshot[]> {
    return (await this.listAccessibleRecentPage(input)).items;
  }

  async listAccessibleRecentPage(input: {
    trustedSubjectId: string;
    limit?: number;
    cursor?: TemporalIdCursor | null;
  }): Promise<CursorPage<PlatformConversationSnapshot>> {
    const limit = boundedPageLimit(input.limit ?? 30);
    const cursorCondition = input.cursor
      ? or(
          lt(conversations.lastActivityAt, input.cursor.timestamp),
          and(
            eq(conversations.lastActivityAt, input.cursor.timestamp),
            lt(conversations.id, input.cursor.id),
          ),
        )
      : undefined;
    const rows = await this.database
      .select()
      .from(conversations)
      .innerJoin(
        notebookMemberships,
        and(
          eq(notebookMemberships.notebookId, conversations.spaceId),
          eq(notebookMemberships.userId, input.trustedSubjectId),
        ),
      )
      .where(
        and(
          eq(conversations.status, 'active'),
          isNull(notebookMemberships.revokedAt),
          or(
            isNull(notebookMemberships.expiresAt),
            gt(notebookMemberships.expiresAt, new Date()),
          ),
          cursorCondition,
        ),
      )
      .orderBy(desc(conversations.lastActivityAt), desc(conversations.id))
      .limit(limit + 1);
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map(({ conversations: conversation }) =>
      toConversation(conversation),
    );
    const last = pageRows.at(-1)?.conversations;
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? { timestamp: last.lastActivityAt, id: last.id }
          : null,
    };
  }

  /** 历史记录删除采用归档语义，保留账本和外键完整性，避免 UI 删除导致数据级误删。 */
  async archiveOwned(input: {
    conversationId: string;
    trustedSubjectId: string;
    now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? new Date();
    const conversation = await requireConversationAccess(this.database, {
      ...input,
      requiredPermission: 'notebook.manage',
      now,
    }).catch(() => null);
    if (!conversation) return false;
    return this.database.transaction(async (transaction) => {
      const [archived] = await transaction
        .update(conversations)
        .set({
          status: 'archived',
          archivedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.status, 'active'),
          ),
        )
        .returning({ id: conversations.id });
      if (!archived) return false;
      await appendSecurityAuditEvent(transaction, {
        actorUserId: input.trustedSubjectId,
        eventType: 'conversation.archived',
        resourceType: 'conversation',
        resourceId: archived.id,
        outcome: 'succeeded',
        occurredAt: now,
      });
      return true;
    });
  }

  /**
   * 原子重命名一对一 Notebook 的 Space 与主 Conversation。
   * 主体归属和 active 状态由数据库条件强制校验，避免侧栏标题与 Notebook 标题分叉。
   */
  async renameOwned(input: {
    conversationId: string;
    trustedSubjectId: string;
    title: string;
    now?: Date;
  }): Promise<PlatformConversationSnapshot | null> {
    const title = input.title.normalize('NFC').trim();
    if (!title || title.length > 120) {
      throw new PlatformConversationOwnershipError();
    }
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const owned = await requireConversationAccess(transaction, {
        conversationId: input.conversationId,
        trustedSubjectId: input.trustedSubjectId,
        requiredPermission: 'notebook.manage',
        now,
      }).catch(() => null);
      if (!owned) return null;

      const [renamed] = await transaction
        .update(conversations)
        .set({ title, updatedAt: now })
        .where(
          and(
            eq(conversations.id, owned.id),
            eq(conversations.status, 'active'),
          ),
        )
        .returning();
      if (!renamed) throw new Error('Conversation重命名失败');

      const [renamedSpace] = await transaction
        .update(spaces)
        .set({ title, updatedAt: now })
        .where(and(eq(spaces.id, owned.spaceId), eq(spaces.status, 'active')))
        .returning({ id: spaces.id });
      if (!renamedSpace) throw new Error('Notebook Space重命名失败');
      await appendSecurityAuditEvent(transaction, {
        actorUserId: input.trustedSubjectId,
        eventType: 'notebook.renamed',
        resourceType: 'notebook',
        resourceId: owned.spaceId,
        outcome: 'succeeded',
        metadata: { conversation_id: owned.id },
        occurredAt: now,
      });
      return toConversation(renamed);
    });
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
      await requireConversationAccess(transaction, {
        conversationId: input.conversationId,
        trustedSubjectId: input.trustedSubjectId,
        requiredPermission: 'conversation.reply',
        now,
      });
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
    await requireConversationAccess(this.database, {
      conversationId: input.conversationId,
      trustedSubjectId: input.trustedSubjectId,
      requiredPermission: 'notebook.read',
    });
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
