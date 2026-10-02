import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { getDb } from './client';
import { appendSecurityAuditEvent } from './security-audit-repository';
import {
  requireNotebookAccess,
  NotebookAccessNotFoundError,
} from './notebook-access';
import { conversations, notebookMemberships, spaces } from './schema';
type Database = ReturnType<typeof getDb>;
/** Space目录及子对话写入；不改变教学Session或历史资源归属。 */
export class PlatformNotebookDirectory {
  constructor(private readonly database: Database) {}
  async getNotebook(input: { notebookId: string; trustedSubjectId: string }) {
    const access = await requireNotebookAccess(this.database, {
      ...input,
      requiredPermission: 'notebook.read',
    }).catch(() => null);
    if (!access) return null;
    const [notebook] = await this.database
      .select()
      .from(spaces)
      .where(eq(spaces.id, input.notebookId))
      .limit(1);
    return notebook
      ? {
          id: notebook.id,
          title: notebook.title,
          kind: notebook.kind,
          permissions: access.permissions,
          updatedAt: notebook.updatedAt.toISOString(),
        }
      : null;
  }

  async listNotebooks(input: { trustedSubjectId: string }) {
    const now = new Date();
    const rows = await this.database
      .select()
      .from(spaces)
      .innerJoin(
        notebookMemberships,
        and(
          eq(notebookMemberships.notebookId, spaces.id),
          eq(notebookMemberships.userId, input.trustedSubjectId),
        ),
      )
      .where(
        and(
          eq(spaces.status, 'active'),
          isNull(notebookMemberships.revokedAt),
          or(
            isNull(notebookMemberships.expiresAt),
            gt(notebookMemberships.expiresAt, now),
          ),
        ),
      )
      .orderBy(desc(spaces.updatedAt), desc(spaces.id))
      .limit(100);
    return rows.map(({ spaces: notebook }) => ({
      id: notebook.id,
      title: notebook.title,
      kind: notebook.kind,
      lastActivityAt: notebook.updatedAt.toISOString(),
    }));
  }

  async listInNotebook(input: {
    notebookId: string;
    trustedSubjectId: string;
  }) {
    await requireNotebookAccess(this.database, {
      ...input,
      requiredPermission: 'notebook.read',
    });
    const rows = await this.database
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.spaceId, input.notebookId),
          eq(conversations.status, 'active'),
        ),
      )
      .orderBy(desc(conversations.lastActivityAt), desc(conversations.id))
      .limit(100);
    return rows;
  }

  async createInNotebook(input: {
    notebookId: string;
    trustedSubjectId: string;
    title?: string;
    now?: Date;
  }) {
    const title = input.title?.normalize('NFC').trim() || null;
    if (title && title.length > 120) throw new NotebookAccessNotFoundError();
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireNotebookAccess(transaction, {
        ...input,
        requiredPermission: 'conversation.create',
        now,
      });
      const [conversation] = await transaction
        .insert(conversations)
        .values({
          spaceId: input.notebookId,
          ownerSubjectId: input.trustedSubjectId,
          agentProfileId: 'general',
          title,
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!conversation) throw new Error('Conversation写入失败');
      return conversation;
    });
  }

  async renameNotebook(input: {
    notebookId: string;
    trustedSubjectId: string;
    title: string;
    now?: Date;
  }) {
    const title = input.title.normalize('NFC').trim();
    if (!title || title.length > 120) throw new NotebookAccessNotFoundError();
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const access = await requireNotebookAccess(transaction, {
        ...input,
        requiredPermission: 'notebook.manage',
        now,
      }).catch(() => null);
      if (!access) return null;
      const [notebook] = await transaction
        .update(spaces)
        .set({ title, updatedAt: now })
        .where(eq(spaces.id, input.notebookId))
        .returning();
      if (!notebook) return null;
      await appendSecurityAuditEvent(transaction, {
        actorUserId: input.trustedSubjectId,
        eventType: 'notebook.renamed',
        resourceType: 'notebook',
        resourceId: notebook.id,
        outcome: 'succeeded',
        occurredAt: now,
      });
      return { id: notebook.id, title: notebook.title };
    });
  }
}
