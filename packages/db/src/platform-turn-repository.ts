import { randomUUID } from 'node:crypto';
import type { AgentMessagePart } from '@educanvas/agent-core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  assertOwnedReadyAssetParts,
  prepareStudentMessage,
} from './message-parts';
import { agentOperations, conversationMessages, conversations } from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

export type PlatformTurnTerminalStatus =
  'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface PlatformTurnMessageSnapshot {
  id: string;
  conversationId: string;
  operationId: string;
  clientMessageId: string;
  role: 'user' | 'assistant';
  status:
    | 'pending'
    | 'streaming'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  content: string;
  parts: readonly AgentMessagePart[];
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface PlatformTurnSnapshot {
  turnId: string;
  traceId: string;
  replayed: boolean;
  studentMessage: PlatformTurnMessageSnapshot;
  assistantMessage: PlatformTurnMessageSnapshot;
}

export class PlatformTurnOwnershipError extends Error {
  readonly code = 'conversation_not_found';

  constructor() {
    super('Conversation不存在或不属于当前主体');
    this.name = 'PlatformTurnOwnershipError';
  }
}

export class PlatformMessageIdConflictError extends Error {
  readonly code = 'message_id_conflict';

  constructor() {
    super('clientMessageId已绑定其他消息内容');
    this.name = 'PlatformMessageIdConflictError';
  }
}

export class PlatformTurnInProgressError extends Error {
  readonly code = 'turn_in_progress';

  constructor(readonly activeTurnId: string) {
    super(`当前Conversation已有未完成Turn ${activeTurnId}`);
    this.name = 'PlatformTurnInProgressError';
  }
}

export class PlatformTurnLifecycleError extends Error {
  readonly code = 'invalid_turn_transition';

  constructor(message: string) {
    super(message);
    this.name = 'PlatformTurnLifecycleError';
  }
}

function toMessage(
  row: typeof conversationMessages.$inferSelect,
  clientMessageId: string,
): PlatformTurnMessageSnapshot {
  if (!row.operationId || (row.role !== 'user' && row.role !== 'assistant')) {
    throw new PlatformTurnLifecycleError('通用Turn消息形状无效');
  }
  return {
    id: row.id,
    conversationId: row.conversationId,
    operationId: row.operationId,
    clientMessageId,
    role: row.role,
    status: row.status as PlatformTurnMessageSnapshot['status'],
    content: row.content,
    parts: row.parts,
    failureCode: row.failureCode,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function requireOwnedConversation(
  executor: DatabaseExecutor,
  conversationId: string,
  trustedSubjectId: string,
) {
  const [conversation] = await executor
    .select({
      id: conversations.id,
      spaceId: conversations.spaceId,
      status: conversations.status,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.ownerSubjectId, trustedSubjectId),
      ),
    )
    .limit(1);
  if (!conversation || conversation.status !== 'active') {
    throw new PlatformTurnOwnershipError();
  }
  return conversation;
}

async function loadTurn(
  executor: DatabaseExecutor,
  operationId: string,
  replayed: boolean,
): Promise<PlatformTurnSnapshot> {
  const [operation] = await executor
    .select()
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);
  if (!operation || operation.kind !== 'turn') {
    throw new PlatformTurnLifecycleError('通用Turn不存在');
  }
  const rows = await executor
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.operationId, operationId))
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
  const student = rows.find((row) => row.role === 'user');
  const assistant = rows.find((row) => row.role === 'assistant');
  if (!student || !assistant) {
    throw new PlatformTurnLifecycleError('通用Turn消息不完整');
  }
  return {
    turnId: operation.id,
    traceId: operation.traceId,
    replayed,
    studentMessage: toMessage(student, operation.idempotencyKey),
    assistantMessage: toMessage(assistant, operation.idempotencyKey),
  };
}

function sameParts(
  left: readonly AgentMessagePart[],
  right: readonly AgentMessagePart[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((part, index) => {
    const candidate = right[index];
    if (!candidate || part.type !== candidate.type) return false;
    if (part.type === 'text' && candidate.type === 'text') {
      return part.text === candidate.text;
    }
    if (part.type === 'asset_ref' && candidate.type === 'asset_ref') {
      return (
        part.usage === candidate.usage &&
        part.reference.assetId === candidate.reference.assetId &&
        part.reference.versionId === candidate.reference.versionId &&
        part.reference.kind === candidate.reference.kind
      );
    }
    if (part.type === 'artifact_ref' && candidate.type === 'artifact_ref') {
      return (
        part.artifactId === candidate.artifactId &&
        part.versionId === candidate.versionId &&
        part.kind === candidate.kind
      );
    }
    return false;
  });
}

/** 通用Agent Turn账本；它只依赖Conversation/Asset，不接触任何K12领域表。 */
export class DrizzlePlatformTurnRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createOrGetTurn(input: {
    conversationId: string;
    trustedSubjectId: string;
    clientMessageId: string;
    text?: string;
    parts?: readonly AgentMessagePart[];
    now?: Date;
  }): Promise<PlatformTurnSnapshot> {
    const prepared = prepareStudentMessage(input);
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`platform-turn-v1:${input.conversationId}`}, 0))`,
      );
      const conversation = await requireOwnedConversation(
        transaction,
        input.conversationId,
        input.trustedSubjectId,
      );
      const [existing] = await transaction
        .select({ id: agentOperations.id })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.conversationId, input.conversationId),
            eq(agentOperations.idempotencyKey, input.clientMessageId),
            eq(agentOperations.kind, 'turn'),
          ),
        )
        .limit(1);
      if (existing) {
        const turn = await loadTurn(transaction, existing.id, true);
        if (!sameParts(turn.studentMessage.parts, prepared.parts)) {
          throw new PlatformMessageIdConflictError();
        }
        return turn;
      }

      const [active] = await transaction
        .select({ id: agentOperations.id })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.conversationId, input.conversationId),
            eq(agentOperations.kind, 'turn'),
            inArray(agentOperations.status, ['pending', 'running']),
          ),
        )
        .limit(1);
      if (active) throw new PlatformTurnInProgressError(active.id);

      await assertOwnedReadyAssetParts(transaction, {
        ownerSubjectId: input.trustedSubjectId,
        spaceId: conversation.spaceId,
        parts: prepared.parts,
      });

      const operationId = randomUUID();
      const traceId = randomUUID();
      await transaction.insert(agentOperations).values({
        id: operationId,
        conversationId: input.conversationId,
        kind: 'turn',
        idempotencyKey: input.clientMessageId,
        traceId,
        status: 'running',
        createdAt: now,
      });
      await transaction.insert(conversationMessages).values([
        {
          conversationId: input.conversationId,
          operationId,
          role: 'user',
          status: 'completed',
          content: prepared.content,
          parts: [...prepared.parts],
          createdAt: now,
          completedAt: now,
        },
        {
          conversationId: input.conversationId,
          operationId,
          role: 'assistant',
          status: 'streaming',
          content: '',
          parts: [],
          createdAt: now,
        },
      ]);
      const titleSource = prepared.content || '附件对话';
      const title = [...titleSource.replace(/\s+/g, ' ')].slice(0, 64).join('');
      await transaction
        .update(conversations)
        .set({
          title: sql`coalesce(${conversations.title}, ${title})`,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(eq(conversations.id, input.conversationId));
      return loadTurn(transaction, operationId, false);
    });
  }

  async settleTurn(input: {
    conversationId: string;
    trustedSubjectId: string;
    turnId: string;
    status: PlatformTurnTerminalStatus;
    content: string;
    failureCode?: string | null;
    now?: Date;
  }): Promise<PlatformTurnSnapshot> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireOwnedConversation(
        transaction,
        input.conversationId,
        input.trustedSubjectId,
      );
      const [operation] = await transaction
        .select({ id: agentOperations.id })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.id, input.turnId),
            eq(agentOperations.conversationId, input.conversationId),
            eq(agentOperations.kind, 'turn'),
          ),
        )
        .limit(1);
      if (!operation) throw new PlatformTurnOwnershipError();

      const [updated] = await transaction
        .update(agentOperations)
        .set({
          status: input.status,
          failureCode: input.failureCode ?? null,
          completedAt: now,
        })
        .where(
          and(
            eq(agentOperations.id, input.turnId),
            inArray(agentOperations.status, ['pending', 'running']),
          ),
        )
        .returning({ id: agentOperations.id });
      if (updated) {
        await transaction
          .update(conversationMessages)
          .set({
            status: input.status,
            content: input.content,
            failureCode: input.failureCode ?? null,
            completedAt: now,
          })
          .where(
            and(
              eq(conversationMessages.operationId, input.turnId),
              eq(conversationMessages.role, 'assistant'),
              inArray(conversationMessages.status, ['pending', 'streaming']),
            ),
          );
        await transaction
          .update(conversations)
          .set({ lastActivityAt: now, updatedAt: now })
          .where(eq(conversations.id, input.conversationId));
      }
      return loadTurn(transaction, input.turnId, false);
    });
  }

  async listMessages(input: {
    conversationId: string;
    trustedSubjectId: string;
    limit?: number;
  }): Promise<readonly PlatformTurnMessageSnapshot[]> {
    await requireOwnedConversation(
      this.database,
      input.conversationId,
      input.trustedSubjectId,
    );
    const rows = await this.database
      .select({ message: conversationMessages, operation: agentOperations })
      .from(conversationMessages)
      .innerJoin(
        agentOperations,
        eq(agentOperations.id, conversationMessages.operationId),
      )
      .where(eq(conversationMessages.conversationId, input.conversationId))
      .orderBy(
        asc(conversationMessages.createdAt),
        asc(conversationMessages.id),
      )
      .limit(Math.max(1, Math.min(input.limit ?? 100, 100)));
    return rows
      .filter(
        (row) =>
          row.message.role === 'user' || row.message.role === 'assistant',
      )
      .map((row) => toMessage(row.message, row.operation.idempotencyKey));
  }
}
