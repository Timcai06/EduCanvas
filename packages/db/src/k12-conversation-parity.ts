import type { AgentMessagePart } from '@educanvas/agent-core';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
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
  k12ConversationMessageProjections,
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
  /** @deprecated 使用 orphanDetection。 */
  orphanedConversationMessages: number;
  orphanDetection: {
    status: 'available';
    count: number;
  };
  readCutoverEligible: boolean;
  nextCursor: K12ParityAuditCursor | null;
}

interface K12ParitySourceRow {
  id: string;
  sessionId: string;
  role: string;
  status: string;
  content: string;
  failureCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
  operationId: string | null;
}

interface K12ParityProjectionRow {
  sourceChatMessageId: string;
  conversationMessageId: string;
  sessionId: string;
  conversationId: string;
}

type K12ParityPlatformRow = typeof conversationMessages.$inferSelect;

export interface K12ProvenanceAuditRow {
  sourceChatMessageId: string;
  conversationMessageId: string;
  projectionSessionId: string;
  projectionConversationId: string;
  sourceId: string | null;
  sourceSessionId: string | null;
  sourceConversationId: string | null;
  platformId: string | null;
  platformConversationId: string | null;
}

/** v8 是当前 K12 确定性消息 ID 的保留信号；未知 v8 必须 fail-closed。 */
export function isK12ProjectionCandidateId(id: string): boolean {
  return isUuid(id) && id[14]?.toLowerCase() === '8';
}

/** 每条 sidecar 身份至多计一个异常，避免多个漂移字段放大 operator 数字。 */
export function countInvalidK12Provenance(
  rows: readonly K12ProvenanceAuditRow[],
): number {
  return rows.filter((row) => {
    const deterministicId = row.sourceId
      ? deterministicConversationMessageId(row.sourceId)
      : null;
    return (
      row.sourceId === null ||
      row.sourceId !== row.sourceChatMessageId ||
      row.sourceSessionId !== row.projectionSessionId ||
      row.sourceConversationId !== row.projectionConversationId ||
      row.platformId === null ||
      row.platformId !== row.conversationMessageId ||
      row.platformConversationId !== row.projectionConversationId ||
      deterministicId !== row.conversationMessageId
    );
  }).length;
}

/** 纯计数边界，便于验证任何正文或内部错误信息都不会进入审计响应。 */
export function summarizeK12ParityPage(input: {
  conversationId: string;
  sourceRows: readonly K12ParitySourceRow[];
  sourceParts: ReadonlyMap<string, readonly AgentMessagePart[]>;
  projectionRows: readonly K12ParityProjectionRow[];
  platformRows: readonly K12ParityPlatformRow[];
}): {
  dualWrittenCount: number;
  missingInConversation: number;
  mismatchedInConversation: number;
} {
  const projectionBySourceId = new Map(
    input.projectionRows.map((row) => [row.sourceChatMessageId, row]),
  );
  const platformById = new Map(input.platformRows.map((row) => [row.id, row]));
  let dualWrittenCount = 0;
  let missingInConversation = 0;
  let mismatchedInConversation = 0;

  for (const source of input.sourceRows) {
    const projection = projectionBySourceId.get(source.id);
    const platform = projection
      ? platformById.get(projection.conversationMessageId)
      : undefined;
    if (!projection || !platform) {
      missingInConversation++;
    } else {
      dualWrittenCount++;
    }

    const expectedId = deterministicConversationMessageId(source.id);
    const projectionMismatch =
      projection !== undefined &&
      (projection.conversationMessageId !== expectedId ||
        projection.sessionId !== source.sessionId ||
        projection.conversationId !== input.conversationId);
    const expectedParts = projectK12ConversationParts(
      source.content,
      input.sourceParts.get(source.id),
    );
    const platformMismatch =
      platform !== undefined &&
      (platform.id !== expectedId ||
        platform.conversationId !== input.conversationId ||
        platform.operationId !== source.operationId ||
        platform.role !== mapK12ConversationRole(source.role) ||
        platform.status !== mapK12ConversationStatus(source.status) ||
        platform.content !== source.content ||
        platform.failureCode !== source.failureCode ||
        platform.createdAt.getTime() !== source.createdAt.getTime() ||
        platform.completedAt?.getTime() !== source.completedAt?.getTime() ||
        !sameK12ConversationParts(platform.parts, expectedParts));
    if (projectionMismatch || platformMismatch) {
      mismatchedInConversation++;
    }
  }

  return {
    dualWrittenCount,
    missingInConversation,
    mismatchedInConversation,
  };
}

/** 把内部比对结果收敛为公开计数；正文、Part 和错误对象没有进入参数的通道。 */
export function buildK12ParityAuditResult(input: {
  conversationId: string;
  sessionCount: number;
  scannedMessageCount: number;
  summary: ReturnType<typeof summarizeK12ParityPage>;
  orphanCount: number;
  nextCursor: K12ParityAuditCursor | null;
  startedAtBeginning: boolean;
}): ParityAuditResult {
  return {
    conversationId: input.conversationId,
    sessionCount: input.sessionCount,
    scannedMessageCount: input.scannedMessageCount,
    dualWrittenCount: input.summary.dualWrittenCount,
    missingInConversation: input.summary.missingInConversation,
    mismatchedInConversation: input.summary.mismatchedInConversation,
    orphanedConversationMessages: input.orphanCount,
    orphanDetection: {
      status: 'available',
      count: input.orphanCount,
    },
    readCutoverEligible:
      input.startedAtBeginning &&
      input.nextCursor === null &&
      input.sessionCount > 0 &&
      input.summary.missingInConversation === 0 &&
      input.summary.mismatchedInConversation === 0 &&
      input.orphanCount === 0,
    nextCursor: input.nextCursor,
  };
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
      sessionId: chatMessages.sessionId,
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
  const sourceIds = pageRows.map((row) => row.id);
  const [sourceParts, projectionRows, provenanceRows, unmappedV8PlatformRow] =
    await Promise.all([
      loadMessageParts(executor, sourceIds),
      sourceIds.length === 0
        ? Promise.resolve([])
        : executor
            .select()
            .from(k12ConversationMessageProjections)
            .where(
              inArray(
                k12ConversationMessageProjections.sourceChatMessageId,
                sourceIds,
              ),
            ),
      executor
        .select({
          sourceChatMessageId:
            k12ConversationMessageProjections.sourceChatMessageId,
          conversationMessageId:
            k12ConversationMessageProjections.conversationMessageId,
          projectionSessionId: k12ConversationMessageProjections.sessionId,
          projectionConversationId:
            k12ConversationMessageProjections.conversationId,
          sourceId: chatMessages.id,
          sourceSessionId: chatMessages.sessionId,
          sourceConversationId: lessonSessions.conversationId,
          platformId: conversationMessages.id,
          platformConversationId: conversationMessages.conversationId,
        })
        .from(k12ConversationMessageProjections)
        .leftJoin(
          chatMessages,
          eq(
            chatMessages.id,
            k12ConversationMessageProjections.sourceChatMessageId,
          ),
        )
        .leftJoin(lessonSessions, eq(lessonSessions.id, chatMessages.sessionId))
        .leftJoin(
          conversationMessages,
          eq(
            conversationMessages.id,
            k12ConversationMessageProjections.conversationMessageId,
          ),
        )
        .where(
          or(
            eq(
              k12ConversationMessageProjections.conversationId,
              input.conversationId,
            ),
            eq(lessonSessions.conversationId, input.conversationId),
            eq(conversationMessages.conversationId, input.conversationId),
          ),
        ),
      executor
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationMessages)
        .leftJoin(
          k12ConversationMessageProjections,
          eq(
            k12ConversationMessageProjections.conversationMessageId,
            conversationMessages.id,
          ),
        )
        .where(
          and(
            eq(conversationMessages.conversationId, input.conversationId),
            isNull(k12ConversationMessageProjections.conversationMessageId),
            sql`substring(${conversationMessages.id}::text from 15 for 1) = '8'`,
          ),
        ),
    ]);
  const platformIds = projectionRows.map((row) => row.conversationMessageId);
  const platformRows =
    platformIds.length === 0
      ? []
      : await executor
          .select()
          .from(conversationMessages)
          .where(inArray(conversationMessages.id, platformIds));
  const summary = summarizeK12ParityPage({
    conversationId: input.conversationId,
    sourceRows: pageRows,
    sourceParts,
    projectionRows,
    platformRows,
  });
  const orphanCount =
    countInvalidK12Provenance(provenanceRows) +
    (unmappedV8PlatformRow[0]?.count ?? 0);
  const last = pageRows.at(-1);
  const nextCursor =
    hasNext && last
      ? {
          createdAt: last.createdAt.toISOString(),
          messageId: last.id,
        }
      : null;
  return buildK12ParityAuditResult({
    conversationId: input.conversationId,
    sessionCount: sessionRow?.count ?? 0,
    scannedMessageCount: pageRows.length,
    summary,
    orphanCount,
    nextCursor,
    startedAtBeginning: input.after == null,
  });
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

  /** 在单个 repeatable-read 快照中扫描至 EOF，只有完整零差异才授予切读资格。 */
  auditAll(input: {
    conversationId: string;
    pageLimit?: number;
  }): Promise<ParityAuditResult> {
    const database = this.providedDatabase ?? getDb();
    return database.transaction(
      async (transaction) => {
        let cursor: K12ParityAuditCursor | null = null;
        let aggregate: ParityAuditResult | null = null;
        do {
          const page = await auditK12Parity(transaction, {
            conversationId: input.conversationId,
            after: cursor,
            limit: input.pageLimit,
          });
          aggregate = aggregate
            ? {
                ...page,
                scannedMessageCount:
                  aggregate.scannedMessageCount + page.scannedMessageCount,
                dualWrittenCount:
                  aggregate.dualWrittenCount + page.dualWrittenCount,
                missingInConversation:
                  aggregate.missingInConversation + page.missingInConversation,
                mismatchedInConversation:
                  aggregate.mismatchedInConversation +
                  page.mismatchedInConversation,
              }
            : page;
          cursor = page.nextCursor;
        } while (cursor !== null);
        if (!aggregate) throw new K12ConversationDualWriteInvariantError();
        return {
          ...aggregate,
          readCutoverEligible:
            aggregate.sessionCount > 0 &&
            aggregate.missingInConversation === 0 &&
            aggregate.mismatchedInConversation === 0 &&
            aggregate.orphanDetection.count === 0,
          nextCursor: null,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
