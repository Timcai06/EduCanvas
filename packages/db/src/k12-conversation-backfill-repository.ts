import { and, asc, eq, gt, inArray, isNotNull, or } from 'drizzle-orm';
import { getDb } from './client';
import type { Database, DatabaseTransaction } from './internal/database-types';
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

const DEFAULT_BACKFILL_LIMIT = 100;
const MAX_BACKFILL_LIMIT = 500;

export interface K12ConversationBackfillCursor {
  createdAt: string;
  messageId: string;
}

export interface K12ConversationBackfillInput {
  after?: K12ConversationBackfillCursor | null;
  limit?: number;
}

export interface K12ConversationBackfillResult {
  mode: 'dry-run' | 'apply';
  scannedMessageCount: number;
  missingBeforeCount: number;
  matchedBeforeCount: number;
  mismatchedBeforeCount: number;
  insertedCount: number;
  nextCursor: K12ConversationBackfillCursor | null;
}

interface ExpectedProjection {
  id: string;
  conversationId: string;
  operationId: string | null;
  role: 'user' | 'assistant';
  status:
    | 'pending'
    | 'streaming'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  content: string;
  parts: ReturnType<typeof projectK12ConversationParts>;
  failureCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

type ConversationMessageRow = typeof conversationMessages.$inferSelect;

function validateInput(input: K12ConversationBackfillInput): {
  afterDate: Date | null;
  limit: number;
} {
  const limit = input.limit ?? DEFAULT_BACKFILL_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BACKFILL_LIMIT) {
    throw new K12ConversationDualWriteInvariantError();
  }
  if (!input.after) return { afterDate: null, limit };
  const afterDate = new Date(input.after.createdAt);
  if (Number.isNaN(afterDate.getTime()) || !isUuid(input.after.messageId)) {
    throw new K12ConversationDualWriteInvariantError();
  }
  return { afterDate, limit };
}

function matchesExpected(
  actual: ConversationMessageRow,
  expected: ExpectedProjection,
): boolean {
  return (
    actual.conversationId === expected.conversationId &&
    actual.operationId === expected.operationId &&
    actual.role === expected.role &&
    actual.status === expected.status &&
    actual.content === expected.content &&
    actual.failureCode === expected.failureCode &&
    actual.createdAt.getTime() === expected.createdAt.getTime() &&
    actual.completedAt?.getTime() === expected.completedAt?.getTime() &&
    sameK12ConversationParts(actual.parts, expected.parts)
  );
}

async function runPage(
  transaction: DatabaseTransaction,
  input: K12ConversationBackfillInput,
  mode: K12ConversationBackfillResult['mode'],
): Promise<K12ConversationBackfillResult> {
  const { afterDate, limit } = validateInput(input);
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
  const sourceRows = await transaction
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      status: chatMessages.status,
      content: chatMessages.content,
      failureCode: chatMessages.failureCode,
      createdAt: chatMessages.createdAt,
      completedAt: chatMessages.completedAt,
      conversationId: lessonSessions.conversationId,
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
        ? and(isNotNull(lessonSessions.conversationId), cursorCondition)
        : isNotNull(lessonSessions.conversationId),
    )
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
    .limit(limit + 1);
  const hasNext = sourceRows.length > limit;
  const pageRows = sourceRows.slice(0, limit);
  const sourceParts = await loadMessageParts(
    transaction,
    pageRows.map((row) => row.id),
  );
  const expected: ExpectedProjection[] = pageRows.map((row) => {
    if (!row.conversationId) {
      throw new K12ConversationDualWriteInvariantError();
    }
    return {
      id: deterministicConversationMessageId(row.id),
      conversationId: row.conversationId,
      operationId: row.operationId,
      role: mapK12ConversationRole(row.role),
      status: mapK12ConversationStatus(row.status),
      content: row.content,
      parts: projectK12ConversationParts(row.content, sourceParts.get(row.id)),
      failureCode: row.failureCode,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    };
  });
  const existingRows =
    expected.length === 0
      ? []
      : await transaction
          .select()
          .from(conversationMessages)
          .where(
            inArray(
              conversationMessages.id,
              expected.map((row) => row.id),
            ),
          );
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const missing = expected.filter((row) => !existingById.has(row.id));
  let matchedBeforeCount = 0;
  let mismatchedBeforeCount = 0;
  for (const row of expected) {
    const existing = existingById.get(row.id);
    if (!existing) continue;
    if (matchesExpected(existing, row)) matchedBeforeCount++;
    else mismatchedBeforeCount++;
  }

  // A mismatch means the compatibility copy no longer represents the authority.
  // Refuse all writes for this page so an operator can investigate before retrying.
  let insertedCount = 0;
  if (mode === 'apply' && mismatchedBeforeCount === 0 && missing.length > 0) {
    const inserted = await transaction
      .insert(conversationMessages)
      .values(missing.map((row) => ({ ...row, parts: [...row.parts] })))
      .onConflictDoNothing({ target: conversationMessages.id })
      .returning({ id: conversationMessages.id });
    insertedCount = inserted.length;
    // A concurrent writer can win after the repeatable-read snapshot and make
    // ON CONFLICT skip rows. Do not report a partially applied page: aborting
    // the transaction preserves an operator-visible, retryable boundary.
    if (insertedCount !== missing.length) {
      throw new K12ConversationDualWriteInvariantError();
    }
  }
  const last = pageRows.at(-1);
  return {
    mode,
    scannedMessageCount: pageRows.length,
    missingBeforeCount: missing.length,
    matchedBeforeCount,
    mismatchedBeforeCount,
    insertedCount,
    nextCursor:
      hasNext && last
        ? {
            createdAt: last.createdAt.toISOString(),
            messageId: last.id,
          }
        : null,
  };
}

/**
 * R05 历史副本回填入口。
 *
 * 每次最多处理 500 条权威消息，以稳定游标续跑；dry-run 与 apply 都使用
 * repeatable-read 快照。apply 只补缺失行，发现任何既有不一致即整页零写入。
 * 返回值仅含计数和游标，不暴露消息正文。
 */
export class DrizzleK12ConversationBackfillRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  previewPage(
    input: K12ConversationBackfillInput = {},
  ): Promise<K12ConversationBackfillResult> {
    return this.database.transaction(
      (transaction) => runPage(transaction, input, 'dry-run'),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  applyPage(
    input: K12ConversationBackfillInput = {},
  ): Promise<K12ConversationBackfillResult> {
    return this.database.transaction(
      (transaction) => runPage(transaction, input, 'apply'),
      { isolationLevel: 'repeatable read', accessMode: 'read write' },
    );
  }
}
