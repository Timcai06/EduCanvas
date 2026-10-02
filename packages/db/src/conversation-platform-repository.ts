import {
  toConversation,
  toMessage,
  type PlatformConversationSnapshot,
  type PlatformMessageSnapshot,
} from './platform-conversation-projection';
export type {
  PlatformConversationSnapshot,
  PlatformMessageSnapshot,
} from './platform-conversation-projection';
import { PlatformNotebookDirectory } from './platform-notebook-directory';
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
type TransactionCallback = Parameters<Database['transaction']>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];
type DatabaseExecutor = Database | DatabaseTransaction;
export class PlatformConversationOwnershipError extends Error {
  readonly code = 'conversation_not_found';

  constructor() {
    super('Conversation不存在或不属于当前主体');
    this.name = 'PlatformConversationOwnershipError';
  }
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

  private get notebooks() {
    return new PlatformNotebookDirectory(this.database);
  }
  getNotebook(input: Parameters<PlatformNotebookDirectory['getNotebook']>[0]) {
    return this.notebooks.getNotebook(input);
  }
  listNotebooks(
    input: Parameters<PlatformNotebookDirectory['listNotebooks']>[0],
  ) {
    return this.notebooks.listNotebooks(input);
  }
  async listInNotebook(
    input: Parameters<PlatformNotebookDirectory['listInNotebook']>[0],
  ) {
    return (await this.notebooks.listInNotebook(input)).map(toConversation);
  }
  async createInNotebook(
    input: Parameters<PlatformNotebookDirectory['createInNotebook']>[0],
  ) {
    return toConversation(await this.notebooks.createInNotebook(input));
  }
  renameNotebook(
    input: Parameters<PlatformNotebookDirectory['renameNotebook']>[0],
  ) {
    return this.notebooks.renameNotebook(input);
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
    agentProfileId?: string;
  }): Promise<readonly PlatformConversationSnapshot[]> {
    return (await this.listAccessibleRecentPage(input)).items;
  }

  async listAccessibleRecentPage(input: {
    trustedSubjectId: string;
    limit?: number;
    cursor?: TemporalIdCursor | null;
    agentProfileId?: string;
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
          input.agentProfileId
            ? eq(conversations.agentProfileId, input.agentProfileId)
            : undefined,
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

  /** 只重命名所选 Conversation；Notebook 标题通过独立入口修改。 */
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

      await appendSecurityAuditEvent(transaction, {
        actorUserId: input.trustedSubjectId,
        eventType: 'conversation.renamed',
        resourceType: 'conversation',
        resourceId: owned.id,
        outcome: 'succeeded',
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
