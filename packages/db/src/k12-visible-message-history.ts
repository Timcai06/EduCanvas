import type { AgentMessagePart } from '@educanvas/agent-core';
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import {
  ChatLifecycleError,
  DrizzleChatRepository,
  LearningSessionOwnershipError,
  type ChatHistoryCursor,
  type ChatHistoryPage,
  type ChatMessageSnapshot,
} from './chat-repository';
import { getDb } from './client';
import type { Database, DatabaseExecutor } from './internal/database-types';
import { isUuid } from './internal/identifiers';
import {
  mapK12ConversationRole,
  projectK12ConversationParts,
  resolveK12ConversationAuthorityContract,
  sameK12ConversationParts,
  type K12ConversationAuthorityContract,
} from './k12-conversation-dual-write';
import { auditK12Parity } from './k12-conversation-parity';
import { loadMessageParts } from './message-parts';
import {
  agentOperations,
  chatMessages,
  conversationMessages,
  conversations,
  k12ConversationMessageProjections,
  lessonSessions,
} from './schema';

type LegacyMessage = typeof chatMessages.$inferSelect;
type PlatformMessage = typeof conversationMessages.$inferSelect;

export interface K12VisibleMessageHistoryPort {
  listHistory(input: {
    sessionId: string;
    trustedStudentId: string;
    after?: ChatHistoryCursor | null;
    limit?: number;
  }): Promise<ChatHistoryPage>;
  listRecentHistory(input: {
    sessionId: string;
    trustedStudentId: string;
    limit?: number;
  }): Promise<readonly ChatMessageSnapshot[]>;
}

/** 对外只给稳定错误码，不携带消息正文、配置原值或底层查询细节。 */
export class K12VisibleHistoryConsistencyError extends Error {
  readonly code = 'k12_message_projection_inconsistent';

  constructor() {
    super('K12 visible message projection is inconsistent');
    this.name = 'K12VisibleHistoryConsistencyError';
  }
}

async function requireOwnedConversation(
  executor: DatabaseExecutor,
  sessionId: string,
  trustedStudentId: string,
): Promise<string> {
  const [session] = await executor
    .select({ conversationId: lessonSessions.conversationId })
    .from(lessonSessions)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, lessonSessions.conversationId),
        eq(conversations.ownerSubjectId, trustedStudentId),
      ),
    )
    .where(
      and(
        eq(lessonSessions.id, sessionId),
        eq(lessonSessions.studentId, trustedStudentId),
      ),
    )
    .limit(1);
  if (!session) throw new LearningSessionOwnershipError();
  if (!session.conversationId) throw new K12VisibleHistoryConsistencyError();
  return session.conversationId;
}

/** platform 初始观察期每次读取都在同一快照完成全量 shadow comparison。 */
async function assertCompleteProjectionParity(
  executor: DatabaseExecutor,
  conversationId: string,
): Promise<void> {
  let cursor: Awaited<ReturnType<typeof auditK12Parity>>['nextCursor'] = null;
  do {
    const page = await auditK12Parity(executor, {
      conversationId,
      after: cursor,
      limit: 500,
    });
    if (
      page.missingInConversation !== 0 ||
      page.mismatchedInConversation !== 0 ||
      page.orphanDetection.count !== 0
    ) {
      throw new K12VisibleHistoryConsistencyError();
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
}

function toPlatformVisibleSnapshot(
  legacy: LegacyMessage,
  platform: PlatformMessage,
): ChatMessageSnapshot {
  const role: ChatMessageSnapshot['role'] =
    platform.role === 'user' ? 'student' : 'assistant';
  return {
    id: legacy.id,
    sessionId: legacy.sessionId,
    turnId: legacy.turnId,
    clientMessageId: legacy.clientMessageId,
    role,
    status: platform.status as ChatMessageSnapshot['status'],
    content: platform.content,
    parts: platform.parts,
    failureCode: platform.failureCode,
    createdAt: platform.createdAt.toISOString(),
    completedAt: platform.completedAt?.toISOString() ?? null,
    // 教学运行态仍由 legacy 承载；这些字段不参与可见消息切读。
    cancelRequestedAt: legacy.cancelRequestedAt?.toISOString() ?? null,
    cancelledAt: legacy.cancelledAt?.toISOString() ?? null,
    leaseId: legacy.leaseId,
    leaseExpiresAt: legacy.leaseExpiresAt?.toISOString() ?? null,
    heartbeatAt: legacy.heartbeatAt?.toISOString() ?? null,
  };
}

async function verifyAndProjectRows(
  executor: DatabaseExecutor,
  input: {
    sessionId: string;
    conversationId: string;
    rows: readonly LegacyMessage[];
  },
): Promise<readonly ChatMessageSnapshot[]> {
  if (input.rows.length === 0) return [];
  const sourceIds = input.rows.map((row) => row.id);
  const [partsBySource, projections, operations] = await Promise.all([
    loadMessageParts(executor, sourceIds),
    executor
      .select({
        sourceChatMessageId:
          k12ConversationMessageProjections.sourceChatMessageId,
        mappedConversationId: k12ConversationMessageProjections.conversationId,
        platform: conversationMessages,
      })
      .from(k12ConversationMessageProjections)
      .innerJoin(
        conversationMessages,
        eq(
          conversationMessages.id,
          k12ConversationMessageProjections.conversationMessageId,
        ),
      )
      .where(
        and(
          eq(k12ConversationMessageProjections.sessionId, input.sessionId),
          inArray(
            k12ConversationMessageProjections.sourceChatMessageId,
            sourceIds,
          ),
        ),
      ),
    executor
      .select({ id: agentOperations.id })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.conversationId, input.conversationId),
          inArray(agentOperations.id, [
            ...new Set(input.rows.map((row) => row.turnId)),
          ]),
        ),
      ),
  ]);
  const platformBySource = new Map(
    projections.map((row) => [row.sourceChatMessageId, row]),
  );
  const operationIds = new Set(operations.map((row) => row.id));
  return input.rows.map((legacy) => {
    const mapped = platformBySource.get(legacy.id);
    const expectedParts: readonly AgentMessagePart[] =
      projectK12ConversationParts(legacy.content, partsBySource.get(legacy.id));
    if (
      !mapped ||
      mapped.mappedConversationId !== input.conversationId ||
      mapped.platform.conversationId !== input.conversationId ||
      mapped.platform.operationId !==
        (operationIds.has(legacy.turnId) ? legacy.turnId : null) ||
      mapped.platform.role !== mapK12ConversationRole(legacy.role) ||
      mapped.platform.status !== legacy.status ||
      mapped.platform.content !== legacy.content ||
      mapped.platform.failureCode !== legacy.failureCode ||
      mapped.platform.createdAt.getTime() !== legacy.createdAt.getTime() ||
      mapped.platform.completedAt?.getTime() !==
        legacy.completedAt?.getTime() ||
      !sameK12ConversationParts(mapped.platform.parts, expectedParts)
    ) {
      throw new K12VisibleHistoryConsistencyError();
    }
    return toPlatformVisibleSnapshot(legacy, mapped.platform);
  });
}

/**
 * K12 可见历史唯一切读适配器。authority 在构造时冻结；运行中修改环境变量不会
 * 改变当前进程，回退必须显式切回 legacy 并重启。
 */
export class DrizzleK12VisibleMessageHistoryRepository implements K12VisibleMessageHistoryPort {
  private readonly providedDatabase?: Database;
  private readonly legacy: DrizzleChatRepository;
  private readonly authority: Readonly<K12ConversationAuthorityContract>;

  constructor(
    options: {
      database?: Database;
      legacy?: DrizzleChatRepository;
      authority?: Readonly<K12ConversationAuthorityContract>;
    } = {},
  ) {
    this.providedDatabase = options.database;
    this.legacy = options.legacy ?? new DrizzleChatRepository(options.database);
    this.authority =
      options.authority ?? resolveK12ConversationAuthorityContract();
  }

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  listHistory(input: {
    sessionId: string;
    trustedStudentId: string;
    after?: ChatHistoryCursor | null;
    limit?: number;
  }): Promise<ChatHistoryPage> {
    if (this.authority.productionReadSource === 'chat_messages') {
      return this.legacy.listHistory(input);
    }
    return this.database.transaction(
      async (transaction) => {
        const conversationId = await requireOwnedConversation(
          transaction,
          input.sessionId,
          input.trustedStudentId,
        );
        await assertCompleteProjectionParity(transaction, conversationId);
        const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
        const afterDate = input.after ? new Date(input.after.createdAt) : null;
        if (afterDate && Number.isNaN(afterDate.getTime())) {
          throw new ChatLifecycleError('历史消息 cursor 时间无效');
        }
        if (input.after && !isUuid(input.after.id)) {
          throw new ChatLifecycleError('历史消息 cursor ID 无效');
        }
        const cursorCondition =
          input.after && afterDate
            ? or(
                gt(chatMessages.createdAt, afterDate),
                and(
                  eq(chatMessages.createdAt, afterDate),
                  gt(chatMessages.id, input.after.id),
                ),
              )
            : undefined;
        const rows = await transaction
          .select()
          .from(chatMessages)
          .where(
            cursorCondition
              ? and(
                  eq(chatMessages.sessionId, input.sessionId),
                  cursorCondition,
                )
              : eq(chatMessages.sessionId, input.sessionId),
          )
          .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
          .limit(limit + 1);
        const hasNext = rows.length > limit;
        const pageRows = rows.slice(0, limit);
        const messages = await verifyAndProjectRows(transaction, {
          sessionId: input.sessionId,
          conversationId,
          rows: pageRows,
        });
        const last = pageRows.at(-1);
        return {
          messages,
          nextCursor:
            hasNext && last
              ? { createdAt: last.createdAt.toISOString(), id: last.id }
              : null,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async listRecentHistory(input: {
    sessionId: string;
    trustedStudentId: string;
    limit?: number;
  }): Promise<readonly ChatMessageSnapshot[]> {
    if (this.authority.productionReadSource === 'chat_messages') {
      return this.legacy.listRecentHistory(input);
    }
    return this.database.transaction(
      async (transaction) => {
        const conversationId = await requireOwnedConversation(
          transaction,
          input.sessionId,
          input.trustedStudentId,
        );
        await assertCompleteProjectionParity(transaction, conversationId);
        const limit = Math.max(1, Math.min(input.limit ?? 24, 100));
        const rows = await transaction
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.sessionId, input.sessionId))
          .orderBy(
            desc(chatMessages.createdAt),
            sql`case when ${chatMessages.role} = 'assistant' then 1 else 0 end desc`,
            desc(chatMessages.id),
          )
          .limit(limit);
        rows.reverse();
        return verifyAndProjectRows(transaction, {
          sessionId: input.sessionId,
          conversationId,
          rows,
        });
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
