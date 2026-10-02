import type { ArtifactProposalKind } from '@educanvas/agent-core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from './client';
import {
  agentOperations,
  artifactConfirmationRequests,
  conversationMessages,
} from './schema';

type Database = ReturnType<typeof getDb>;

export interface ArtifactConfirmationScope {
  actorUserId: string;
  notebookId: string;
  conversationId: string;
}

export interface ArtifactConfirmationSnapshot {
  id: string;
  operationId: string;
  userMessageId: string;
  artifactKind: ArtifactProposalKind;
  title: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  confirmedKind: ArtifactProposalKind | null;
  confirmationMessageId: string | null;
  createdAt: string;
}

export class ArtifactConfirmationNotFoundError extends Error {
  readonly code = 'artifact_confirmation_not_found';
  constructor() {
    super('Artifact confirmation not found');
    this.name = 'ArtifactConfirmationNotFoundError';
  }
}

function snapshot(
  row: typeof artifactConfirmationRequests.$inferSelect,
): ArtifactConfirmationSnapshot {
  return {
    id: row.id,
    operationId: row.operationId,
    userMessageId: row.userMessageId,
    artifactKind: row.artifactKind as ArtifactProposalKind,
    title: row.title,
    status: row.status as ArtifactConfirmationSnapshot['status'],
    confirmedKind: row.confirmedKind as ArtifactProposalKind | null,
    confirmationMessageId: row.confirmationMessageId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function artifactConfirmationMessageId(confirmationId: string): string {
  return `artifact.confirm.${confirmationId.replaceAll('-', '')}`;
}

/** Durable one-shot user confirmation, always read and mutated through its full scope. */
export class DrizzleArtifactConfirmationRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createPending(
    input: ArtifactConfirmationScope & {
      operationId: string;
      userMessageId: string;
      artifactKind: ArtifactProposalKind;
      title: string;
    },
  ): Promise<ArtifactConfirmationSnapshot> {
    return this.database.transaction(async (tx) => {
      const [scope] = await tx
        .select({
          operationId: agentOperations.id,
          actorUserId: agentOperations.actorUserId,
          notebookId: agentOperations.notebookId,
          conversationId: agentOperations.conversationId,
          userMessageId: conversationMessages.id,
        })
        .from(agentOperations)
        .innerJoin(
          conversationMessages,
          and(
            eq(conversationMessages.operationId, agentOperations.id),
            eq(conversationMessages.id, input.userMessageId),
            eq(conversationMessages.role, 'user'),
          ),
        )
        .where(
          and(
            eq(agentOperations.id, input.operationId),
            eq(agentOperations.actorUserId, input.actorUserId),
            eq(agentOperations.notebookId, input.notebookId),
            eq(agentOperations.conversationId, input.conversationId),
          ),
        )
        .limit(1);
      if (!scope) throw new ArtifactConfirmationNotFoundError();
      const [row] = await tx
        .insert(artifactConfirmationRequests)
        .values({
          operationId: input.operationId,
          userMessageId: input.userMessageId,
          actorUserId: input.actorUserId,
          notebookId: input.notebookId,
          conversationId: input.conversationId,
          artifactKind: input.artifactKind,
          title: input.title,
        })
        .onConflictDoNothing({
          target: artifactConfirmationRequests.operationId,
        })
        .returning();
      if (row) return snapshot(row);
      const [existing] = await tx
        .select()
        .from(artifactConfirmationRequests)
        .where(eq(artifactConfirmationRequests.operationId, input.operationId))
        .limit(1);
      if (
        !existing ||
        existing.actorUserId !== input.actorUserId ||
        existing.notebookId !== input.notebookId ||
        existing.conversationId !== input.conversationId ||
        existing.userMessageId !== input.userMessageId
      )
        throw new ArtifactConfirmationNotFoundError();
      return snapshot(existing);
    });
  }

  async listRecoverable(
    scope: ArtifactConfirmationScope,
  ): Promise<readonly ArtifactConfirmationSnapshot[]> {
    const rows = await this.database
      .select()
      .from(artifactConfirmationRequests)
      .where(
        and(
          eq(artifactConfirmationRequests.actorUserId, scope.actorUserId),
          eq(artifactConfirmationRequests.notebookId, scope.notebookId),
          eq(artifactConfirmationRequests.conversationId, scope.conversationId),
          inArray(artifactConfirmationRequests.status, ['pending', 'confirmed']),
        ),
      )
      .orderBy(desc(artifactConfirmationRequests.createdAt));
    return rows.map(snapshot);
  }

  async getForExecution(
    input: ArtifactConfirmationScope & { confirmationId: string },
  ): Promise<ArtifactConfirmationSnapshot> {
    const [row] = await this.database
      .select()
      .from(artifactConfirmationRequests)
      .where(
        and(
          eq(artifactConfirmationRequests.id, input.confirmationId),
          eq(artifactConfirmationRequests.actorUserId, input.actorUserId),
          eq(artifactConfirmationRequests.notebookId, input.notebookId),
          eq(artifactConfirmationRequests.conversationId, input.conversationId),
          inArray(artifactConfirmationRequests.status, ['pending', 'confirmed']),
        ),
      )
      .limit(1);
    if (!row) throw new ArtifactConfirmationNotFoundError();
    return snapshot(row);
  }

  async updateKind(
    input: ArtifactConfirmationScope & {
      confirmationId: string;
      artifactKind: ArtifactProposalKind;
    },
  ): Promise<ArtifactConfirmationSnapshot> {
    const [row] = await this.database
      .update(artifactConfirmationRequests)
      .set({ artifactKind: input.artifactKind, updatedAt: new Date() })
      .where(
        and(
          eq(artifactConfirmationRequests.id, input.confirmationId),
          eq(artifactConfirmationRequests.actorUserId, input.actorUserId),
          eq(artifactConfirmationRequests.notebookId, input.notebookId),
          eq(artifactConfirmationRequests.conversationId, input.conversationId),
          eq(artifactConfirmationRequests.status, 'pending'),
        ),
      )
      .returning();
    if (row) return snapshot(row);
    // A retry after a lost response must not reopen or alter an already consumed
    // confirmation. Return its committed kind so the caller can replay safely.
    const [confirmed] = await this.database
      .select()
      .from(artifactConfirmationRequests)
      .where(
        and(
          eq(artifactConfirmationRequests.id, input.confirmationId),
          eq(artifactConfirmationRequests.actorUserId, input.actorUserId),
          eq(artifactConfirmationRequests.notebookId, input.notebookId),
          eq(artifactConfirmationRequests.conversationId, input.conversationId),
          eq(artifactConfirmationRequests.status, 'confirmed'),
        ),
      )
      .limit(1);
    if (!confirmed) throw new ArtifactConfirmationNotFoundError();
    return snapshot(confirmed);
  }

  async cancel(
    input: ArtifactConfirmationScope & { confirmationId: string },
  ): Promise<ArtifactConfirmationSnapshot> {
    const [row] = await this.database
      .update(artifactConfirmationRequests)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(artifactConfirmationRequests.id, input.confirmationId),
          eq(artifactConfirmationRequests.actorUserId, input.actorUserId),
          eq(artifactConfirmationRequests.notebookId, input.notebookId),
          eq(artifactConfirmationRequests.conversationId, input.conversationId),
          eq(artifactConfirmationRequests.status, 'pending'),
        ),
      )
      .returning();
    if (row) return snapshot(row);
    const [cancelled] = await this.database
      .select()
      .from(artifactConfirmationRequests)
      .where(
        and(
          eq(artifactConfirmationRequests.id, input.confirmationId),
          eq(artifactConfirmationRequests.actorUserId, input.actorUserId),
          eq(artifactConfirmationRequests.notebookId, input.notebookId),
          eq(artifactConfirmationRequests.conversationId, input.conversationId),
          eq(artifactConfirmationRequests.status, 'cancelled'),
        ),
      )
      .limit(1);
    if (!cancelled) throw new ArtifactConfirmationNotFoundError();
    return snapshot(cancelled);
  }

  async confirm(
    input: ArtifactConfirmationScope & {
      confirmationId: string;
      artifactKind?: ArtifactProposalKind;
    },
  ): Promise<ArtifactConfirmationSnapshot> {
    return this.database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(artifactConfirmationRequests)
        .where(
          and(
            eq(artifactConfirmationRequests.id, input.confirmationId),
            eq(artifactConfirmationRequests.actorUserId, input.actorUserId),
            eq(artifactConfirmationRequests.notebookId, input.notebookId),
            eq(
              artifactConfirmationRequests.conversationId,
              input.conversationId,
            ),
          ),
        )
        .limit(1)
        .for('update');
      if (!current) throw new ArtifactConfirmationNotFoundError();
      if (current.status === 'confirmed') return snapshot(current);
      if (current.status !== 'pending')
        throw new ArtifactConfirmationNotFoundError();
      const confirmedKind = input.artifactKind ?? current.artifactKind;
      const confirmationMessageId = artifactConfirmationMessageId(current.id);
      const [updated] = await tx
        .update(artifactConfirmationRequests)
        .set({
          status: 'confirmed',
          confirmedKind,
          confirmationMessageId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(artifactConfirmationRequests.id, current.id),
            eq(artifactConfirmationRequests.status, 'pending'),
          ),
        )
        .returning();
      if (!updated) throw new ArtifactConfirmationNotFoundError();
      return snapshot(updated);
    });
  }
}
