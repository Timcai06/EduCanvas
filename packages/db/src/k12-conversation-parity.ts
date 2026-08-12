import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import type { Database, DatabaseExecutor } from './internal/database-types';
import { isUuid } from './internal/identifiers';
import {
  mapK12ConversationRole,
  mapK12ConversationStatus,
  projectK12ConversationParts,
  sameK12ConversationParts,
} from './k12-conversation-dual-write';
import {
  deterministicConversationMessageId,
  K12ConversationDualWriteInvariantError,
} from './k12-conversation-message-identity';
import { loadMessageParts } from './message-parts';
import {
  agentOperations,
  chatMessages,
  conversationMessages,
  lessonSessions,
} from './schema';

export interface K12ParityAuditCursor {
  createdAt: string;
  messageId: string;
}

export interface ParityAuditResult {
  conversationId: string;
  sessionCount: number;
  scannedMessageCount: number;
  dualWrittenCount: number;
  missingInConversation: number;
  mismatchedInConversation: number;
  /** @deprecated 使用 orphanDetection；保留 null 以免消费者把未知误读为 0。 */
  orphanedConversationMessages: null;
  orphanDetection: {
    status: 'unavailable';
    count: null;
    reason: 'k12_projection_provenance_unavailable';
  };
  /** 阶段一缺少孤立副本来源标记，因此即使本页零差异也不能宣称具备切读资格。 */
  readCutoverEligible: false;
  nextCursor: K12ParityAuditCursor | null;
}

function validateAuditInput(input: {
  after?: K12ParityAuditCursor | null;
  limit?: number;
}): { afterDate: Date | null; limit: number } {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new K12ConversationDualWriteInvariantError();
  }
  if (!input.after) return { afterDate: null, limit };
  const afterDate = new Date(input.after.createdAt);
  if (Number.isNaN(afterDate.getTime()) || !isUuid(input.after.messageId)) {
    throw new K12ConversationDualWriteInvariantError();
  }
  return { afterDate, limit };
}

/**
 * 有界对账页：内部比较内容与结构化 Part，但响应只返回计数和稳定游标。
 * 调用方迭代 nextCursor 才能审计长 Conversation，单次最多扫描 500 条。
 */
export async function auditK12Parity(
  executor: DatabaseExecutor,
  input: {
    conversationId: string;
    after?: K12ParityAuditCursor | null;
    limit?: number;
  },
): Promise<ParityAuditResult> {
  const { afterDate, limit } = validateAuditInput(input);
  const [sessionRow] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(lessonSessions)
    .where(eq(lessonSessions.conversationId, input.conversationId));
  const cursorCondition =
    input.after && afterDate
      ? or(
          gt(chatMessages.createdAt, afterDate),
          and(
            eq(chatMessages.createdAt, afterDate),
            gt(chatMessages.id, input.after.messageId),
          ),
        )
      : undefined;
  const sourceRows = await executor
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      status: chatMessages.status,
      content: chatMessages.content,
      failureCode: chatMessages.failureCode,
      createdAt: chatMessages.createdAt,
      completedAt: chatMessages.completedAt,
      operationId: agentOperations.id,
    })
    .from(chatMessages)
    .innerJoin(lessonSessions, eq(lessonSessions.id, chatMessages.sessionId))
    .leftJoin(
      agentOperations,
      and(
        eq(agentOperations.id, chatMessages.turnId),
        eq(agentOperations.conversationId, lessonSessions.conversationId),
      ),
    )
    .where(
      cursorCondition
        ? and(
            eq(lessonSessions.conversationId, input.conversationId),
            cursorCondition,
          )
        : eq(lessonSessions.conversationId, input.conversationId),
    )
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
    .limit(limit + 1);
  const hasNext = sourceRows.length > limit;
  const pageRows = sourceRows.slice(0, limit);
  const expectedIds = pageRows.map((row) =>
    deterministicConversationMessageId(row.id),
  );
  const [sourceParts, platformRows] = await Promise.all([
    loadMessageParts(
      executor,
      pageRows.map((row) => row.id),
    ),
    expectedIds.length === 0
      ? Promise.resolve([])
      : executor
          .select()
          .from(conversationMessages)
          .where(inArray(conversationMessages.id, expectedIds)),
  ]);
  const platformById = new Map(platformRows.map((row) => [row.id, row]));
  let dualWrittenCount = 0;
  let mismatchedInConversation = 0;
  for (const source of pageRows) {
    const platform = platformById.get(
      deterministicConversationMessageId(source.id),
    );
    if (!platform) continue;
    dualWrittenCount++;
    const expectedParts = projectK12ConversationParts(
      source.content,
      sourceParts.get(source.id),
    );
    if (
      platform.conversationId !== input.conversationId ||
      platform.operationId !== source.operationId ||
      platform.role !== mapK12ConversationRole(source.role) ||
      platform.status !== mapK12ConversationStatus(source.status) ||
      platform.content !== source.content ||
      platform.failureCode !== source.failureCode ||
      platform.createdAt.getTime() !== source.createdAt.getTime() ||
      platform.completedAt?.getTime() !== source.completedAt?.getTime() ||
      !sameK12ConversationParts(platform.parts, expectedParts)
    ) {
      mismatchedInConversation++;
    }
  }
  const last = pageRows.at(-1);
  return {
    conversationId: input.conversationId,
    sessionCount: sessionRow?.count ?? 0,
    scannedMessageCount: pageRows.length,
    dualWrittenCount,
    missingInConversation: pageRows.length - dualWrittenCount,
    mismatchedInConversation,
    orphanedConversationMessages: null,
    orphanDetection: {
      status: 'unavailable',
      count: null,
      reason: 'k12_projection_provenance_unavailable',
    },
    readCutoverEligible: false,
    nextCursor:
      hasNext && last
        ? {
            createdAt: last.createdAt.toISOString(),
            messageId: last.id,
          }
        : null,
  };
}

/** Worker/operator 边界使用的命名仓储；结果仅含计数、能力状态与稳定游标。 */
export class DrizzleK12ConversationParityRepository {
  constructor(private readonly providedDatabase?: Database) {}

  auditPage(input: {
    conversationId: string;
    after?: K12ParityAuditCursor | null;
    limit?: number;
  }): Promise<ParityAuditResult> {
    return auditK12Parity(this.providedDatabase ?? getDb(), input);
  }
}
