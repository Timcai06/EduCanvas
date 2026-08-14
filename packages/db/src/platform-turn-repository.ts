import { randomUUID } from 'node:crypto';
import type { AgentMessagePart } from '@educanvas/agent-core';
import type { NotebookPermission } from '@educanvas/gateway-core';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  assertOwnedReadyAssetParts,
  prepareStudentMessage,
} from './message-parts';
import { requireNotebookAccess } from './notebook-access';
import {
  samePlatformMessageParts,
  settlePlatformTurn,
  type SettlePlatformTurnInput,
} from './platform-turn-settlement-repository';
export type {
  PlatformSettledCitationSnapshot,
  PlatformTurnSettlementSnapshot,
  PlatformTurnTerminalStatus,
} from './platform-turn-settlement-repository';
import type { PlatformTurnSettlementSnapshot } from './platform-turn-settlement-repository';
import {
  agentOperations,
  assetVersions,
  conversationMessageCitations,
  conversationMessages,
  conversations,
  operationSources,
  personalAgents,
  spaces,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

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
  cancelRequestedAt: string | null;
  replayed: boolean;
  studentMessage: PlatformTurnMessageSnapshot;
  assistantMessage: PlatformTurnMessageSnapshot;
}

/** Message 历史分页游标：指向已加载窗口里最旧的一条消息（用于加载更早页）。 */
export interface PlatformMessageHistoryCursor {
  createdAt: Date;
  messageId: string;
  /** 用于打破同一 turn 内 user/assistant 共享 createdAt 时的排序歧义。 */
  role: 'user' | 'assistant';
}

export interface PlatformMessageHistoryCitationSnapshot {
  citationId: string;
  marker: number;
  label: string;
  target: {
    kind: 'web';
    assetId: string;
    assetVersionId: string;
    url: string;
  };
}

export interface PlatformMessageHistoryEntry {
  messageId: string;
  clientMessageId: string;
  role: 'user' | 'assistant';
  status: PlatformTurnMessageSnapshot['status'];
  content: string;
  parts: readonly AgentMessagePart[];
  citations: readonly PlatformMessageHistoryCitationSnapshot[];
  createdAt: string;
  completedAt: string | null;
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

async function requireConversationAccess(
  executor: DatabaseExecutor,
  conversationId: string,
  trustedSubjectId: string,
  requiredPermission: NotebookPermission = 'conversation.reply',
) {
  const [conversation] = await executor
    .select({
      id: conversations.id,
      spaceId: conversations.spaceId,
      status: conversations.status,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation || conversation.status !== 'active') {
    throw new PlatformTurnOwnershipError();
  }
  const access = await requireNotebookAccess(executor, {
    notebookId: conversation.spaceId,
    trustedSubjectId,
    requiredPermission,
  }).catch(() => null);
  if (!access) throw new PlatformTurnOwnershipError();
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
    cancelRequestedAt: operation.cancelRequestedAt?.toISOString() ?? null,
    replayed,
    studentMessage: toMessage(student, operation.idempotencyKey),
    assistantMessage: toMessage(assistant, operation.idempotencyKey),
  };
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
      const conversation = await requireConversationAccess(
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
        if (
          !samePlatformMessageParts(turn.studentMessage.parts, prepared.parts)
        ) {
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
      const [actorAgent] = await transaction
        .select({ id: personalAgents.id })
        .from(personalAgents)
        .where(
          and(
            eq(personalAgents.userId, input.trustedSubjectId),
            eq(personalAgents.status, 'active'),
          ),
        )
        .limit(1);
      if (!actorAgent) {
        throw new PlatformTurnLifecycleError('当前主体缺少有效个人Agent');
      }
      await transaction.insert(agentOperations).values({
        id: operationId,
        actorUserId: input.trustedSubjectId,
        agentId: actorAgent.id,
        notebookId: conversation.spaceId,
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
      await transaction
        .update(spaces)
        .set({
          title: sql`case when ${spaces.title} in ('我的空间', '未命名笔记本') then ${title} else ${spaces.title} end`,
          updatedAt: now,
        })
        .where(eq(spaces.id, conversation.spaceId));
      return loadTurn(transaction, operationId, false);
    });
  }

  /**
   * 将 Gateway 已建立的 operation 接到现有消息账本。Gateway 负责身份、路由、
   * 幂等和事件恢复；本方法只在同一个 operation 下创建 user/assistant 消息，
   * 避免迁移期出现第二条 Turn 记录。
   */
  async attachGatewayTurn(input: {
    operationId: string;
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
      const conversation = await requireConversationAccess(
        transaction,
        input.conversationId,
        input.trustedSubjectId,
      );
      const [operation] = await transaction
        .select({
          id: agentOperations.id,
          actorUserId: agentOperations.actorUserId,
          conversationId: agentOperations.conversationId,
          gatewayEnvelopeId: agentOperations.gatewayEnvelopeId,
          idempotencyKey: agentOperations.idempotencyKey,
          kind: agentOperations.kind,
          status: agentOperations.status,
        })
        .from(agentOperations)
        .where(eq(agentOperations.id, input.operationId))
        .limit(1);
      if (
        !operation ||
        operation.kind !== 'turn' ||
        operation.gatewayEnvelopeId === null ||
        operation.actorUserId !== input.trustedSubjectId ||
        operation.conversationId !== input.conversationId ||
        operation.idempotencyKey !== input.clientMessageId
      ) {
        throw new PlatformTurnOwnershipError();
      }

      const [existingMessage] = await transaction
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(eq(conversationMessages.operationId, input.operationId))
        .limit(1);
      if (existingMessage) {
        const turn = await loadTurn(transaction, input.operationId, true);
        if (
          !samePlatformMessageParts(turn.studentMessage.parts, prepared.parts)
        ) {
          throw new PlatformMessageIdConflictError();
        }
        return turn;
      }
      if (operation.status !== 'running') {
        throw new PlatformTurnLifecycleError(
          '只有运行中的 Gateway operation 可以创建消息',
        );
      }

      const [otherActive] = await transaction
        .select({ id: agentOperations.id })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.conversationId, input.conversationId),
            eq(agentOperations.kind, 'turn'),
            inArray(agentOperations.status, ['pending', 'running']),
            sql`${agentOperations.id} <> ${input.operationId}`,
          ),
        )
        .limit(1);
      if (otherActive) throw new PlatformTurnInProgressError(otherActive.id);

      await assertOwnedReadyAssetParts(transaction, {
        ownerSubjectId: input.trustedSubjectId,
        spaceId: conversation.spaceId,
        parts: prepared.parts,
      });
      await transaction.insert(conversationMessages).values([
        {
          conversationId: input.conversationId,
          operationId: input.operationId,
          role: 'user',
          status: 'completed',
          content: prepared.content,
          parts: [...prepared.parts],
          createdAt: now,
          completedAt: now,
        },
        {
          conversationId: input.conversationId,
          operationId: input.operationId,
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
      await transaction
        .update(spaces)
        .set({
          title: sql`case when ${spaces.title} in ('我的空间', '未命名笔记本') then ${title} else ${spaces.title} end`,
          updatedAt: now,
        })
        .where(eq(spaces.id, conversation.spaceId));
      return loadTurn(transaction, input.operationId, false);
    });
  }

  async settleTurn(
    input: SettlePlatformTurnInput,
  ): Promise<PlatformTurnSettlementSnapshot> {
    return settlePlatformTurn(input, {
      database: this.database,
      requireConversationAccess,
      loadTurn,
      ownershipError: () => new PlatformTurnOwnershipError(),
      lifecycleError: (message) => new PlatformTurnLifecycleError(message),
    });
  }

  async requestTurnCancellation(input: {
    trustedSubjectId: string;
    turnId: string;
    now?: Date;
  }): Promise<{ turn: PlatformTurnSnapshot | null; accepted: boolean }> {
    if (!/^[0-9a-f-]{36}$/i.test(input.turnId)) {
      throw new PlatformTurnLifecycleError('turnId格式无效');
    }
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const [owned] = await transaction
        .select({
          id: agentOperations.id,
          status: agentOperations.status,
          cancelRequestedAt: agentOperations.cancelRequestedAt,
        })
        .from(agentOperations)
        .innerJoin(
          conversations,
          eq(conversations.id, agentOperations.conversationId),
        )
        .where(
          and(
            eq(agentOperations.id, input.turnId),
            eq(agentOperations.kind, 'turn'),
            or(
              eq(agentOperations.actorUserId, input.trustedSubjectId),
              and(
                isNull(agentOperations.actorUserId),
                eq(conversations.ownerSubjectId, input.trustedSubjectId),
              ),
            ),
          ),
        )
        .limit(1);
      if (!owned) return { turn: null, accepted: false };
      const [updated] = await transaction
        .update(agentOperations)
        .set({ cancelRequestedAt: now })
        .where(
          and(
            eq(agentOperations.id, input.turnId),
            inArray(agentOperations.status, ['pending', 'running']),
            isNull(agentOperations.cancelRequestedAt),
          ),
        )
        .returning({ id: agentOperations.id });
      return {
        turn: await loadTurn(transaction, input.turnId, false),
        accepted:
          Boolean(updated) ||
          (['pending', 'running'].includes(owned.status) &&
            owned.cancelRequestedAt !== null),
      };
    });
  }

  async isTurnCancellationRequested(input: {
    trustedSubjectId: string;
    turnId: string;
  }): Promise<boolean> {
    const [owned] = await this.database
      .select({ cancelRequestedAt: agentOperations.cancelRequestedAt })
      .from(agentOperations)
      .innerJoin(
        conversations,
        eq(conversations.id, agentOperations.conversationId),
      )
      .where(
        and(
          eq(agentOperations.id, input.turnId),
          eq(agentOperations.kind, 'turn'),
          or(
            eq(agentOperations.actorUserId, input.trustedSubjectId),
            and(
              isNull(agentOperations.actorUserId),
              eq(conversations.ownerSubjectId, input.trustedSubjectId),
            ),
          ),
        ),
      )
      .limit(1);
    return Boolean(owned?.cancelRequestedAt);
  }

  async listMessages(input: {
    conversationId: string;
    trustedSubjectId: string;
    limit?: number;
  }): Promise<readonly PlatformTurnMessageSnapshot[]> {
    await requireConversationAccess(
      this.database,
      input.conversationId,
      input.trustedSubjectId,
      'notebook.read',
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
        desc(conversationMessages.createdAt),
        asc(
          sql`case when ${conversationMessages.role} = 'assistant' then 0 else 1 end`,
        ),
        desc(conversationMessages.id),
      )
      .limit(Math.max(1, Math.min(input.limit ?? 100, 100)));
    return rows
      .reverse()
      .filter(
        (row) =>
          row.message.role === 'user' || row.message.role === 'assistant',
      )
      .map((row) => toMessage(row.message, row.operation.idempotencyKey));
  }

  /**
   * DP03 canonical Message 历史：按 (createdAt, id) 游标向后翻页读取更早消息，
   * 并为页内 Assistant 消息附带已冻结的 web 引用。返回顺序为 oldest → newest。
   */
  async listMessagePage(input: {
    conversationId: string;
    trustedSubjectId: string;
    limit?: number;
    cursor?: PlatformMessageHistoryCursor | null;
  }): Promise<{
    items: readonly PlatformMessageHistoryEntry[];
    nextCursor: PlatformMessageHistoryCursor | null;
  }> {
    await requireConversationAccess(
      this.database,
      input.conversationId,
      input.trustedSubjectId,
      'notebook.read',
    );
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
    // 同一 turn 的 user/assistant 共享 createdAt，必须用 role 打破歧义，
    // 否则 uuid 主键的随机顺序会让 assistant 与 user 颠倒。
    const roleOrder = sql`case when ${conversationMessages.role} = 'assistant' then 0 else 1 end`;
    const cursorRoleOrder = input.cursor?.role === 'assistant' ? 0 : 1;
    const cursorCondition = input.cursor
      ? or(
          lt(conversationMessages.createdAt, input.cursor.createdAt),
          and(
            eq(conversationMessages.createdAt, input.cursor.createdAt),
            sql`${roleOrder} > ${cursorRoleOrder}`,
          ),
          and(
            eq(conversationMessages.createdAt, input.cursor.createdAt),
            sql`${roleOrder} = ${cursorRoleOrder}`,
            lt(conversationMessages.id, input.cursor.messageId),
          ),
        )
      : undefined;
    const rows = await this.database
      .select({ message: conversationMessages, operation: agentOperations })
      .from(conversationMessages)
      .innerJoin(
        agentOperations,
        eq(agentOperations.id, conversationMessages.operationId),
      )
      .where(
        and(
          eq(conversationMessages.conversationId, input.conversationId),
          cursorCondition,
        ),
      )
      .orderBy(
        desc(conversationMessages.createdAt),
        asc(roleOrder),
        desc(conversationMessages.id),
      )
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    const assistantIds = page
      .filter((row) => row.message.role === 'assistant')
      .map((row) => row.message.id);
    const citationRows =
      assistantIds.length === 0
        ? []
        : await this.database
            .select({
              assistantMessageId:
                conversationMessageCitations.assistantMessageId,
              citationId: conversationMessageCitations.id,
              ordinal: operationSources.ordinal,
              assetId: assetVersions.assetId,
              assetVersionId: operationSources.assetVersionId,
              label: operationSources.label,
              url: operationSources.locatorUrl,
            })
            .from(conversationMessageCitations)
            .innerJoin(
              operationSources,
              eq(
                operationSources.id,
                conversationMessageCitations.operationSourceId,
              ),
            )
            .innerJoin(
              assetVersions,
              eq(assetVersions.id, operationSources.assetVersionId),
            )
            .where(
              inArray(
                conversationMessageCitations.assistantMessageId,
                assistantIds,
              ),
            )
            .orderBy(
              asc(conversationMessageCitations.assistantMessageId),
              asc(operationSources.ordinal),
            );
    const citationsByMessage = new Map<
      string,
      PlatformMessageHistoryCitationSnapshot[]
    >();
    for (const row of citationRows) {
      const citations = citationsByMessage.get(row.assistantMessageId) ?? [];
      citations.push({
        citationId: row.citationId,
        marker: row.ordinal,
        label: row.label,
        target: {
          kind: 'web',
          assetId: row.assetId,
          assetVersionId: row.assetVersionId,
          url: row.url,
        },
      });
      citationsByMessage.set(row.assistantMessageId, citations);
    }

    const items = page
      .reverse()
      .filter(
        (row) =>
          row.message.role === 'user' || row.message.role === 'assistant',
      )
      .map((row) => {
        const message = toMessage(row.message, row.operation.idempotencyKey);
        return {
          messageId: message.id,
          clientMessageId: message.clientMessageId,
          role: message.role,
          status: message.status,
          content: message.content,
          parts: message.parts,
          citations: citationsByMessage.get(message.id) ?? [],
          createdAt: message.createdAt,
          completedAt: message.completedAt,
        };
      });

    const oldest = page[page.length - 1];
    return {
      items,
      nextCursor:
        hasMore && oldest
          ? {
              createdAt: oldest.message.createdAt,
              messageId: oldest.message.id,
              role: oldest.message.role === 'assistant' ? 'assistant' : 'user',
            }
          : null,
    };
  }
}
