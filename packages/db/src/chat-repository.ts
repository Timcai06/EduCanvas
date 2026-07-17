import type { AgentMessagePart } from '@educanvas/agent-core';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { chatMessages, lessonSessions, modelRuns } from './schema';
import { loadMessageParts } from './message-parts';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

export type ChatMessageRole = 'student' | 'assistant';
export type ChatMessageStatus =
  | 'pending'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export type AssistantTerminalStatus = Extract<
  ChatMessageStatus,
  'completed' | 'failed' | 'cancelled' | 'interrupted'
>;

export interface ChatMessageSnapshot {
  id: string;
  sessionId: string;
  turnId: string;
  clientMessageId: string | null;
  role: ChatMessageRole;
  status: ChatMessageStatus;
  content: string;
  parts: readonly AgentMessagePart[];
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
}

export interface TeachingTurnSnapshot {
  turnId: string;
  studentMessage: ChatMessageSnapshot;
  assistantMessage: ChatMessageSnapshot;
}

export interface ChatHistoryCursor {
  createdAt: string;
  id: string;
}

export interface ChatHistoryPage {
  messages: readonly ChatMessageSnapshot[];
  nextCursor: ChatHistoryCursor | null;
}

export class ChatMessageIdConflictError extends Error {
  readonly code = 'message_id_conflict';

  constructor(clientMessageId: string) {
    super(`clientMessageId ${clientMessageId}已绑定其他消息`);
    this.name = 'ChatMessageIdConflictError';
  }
}

export class TurnInProgressError extends Error {
  readonly code = 'turn_in_progress';

  constructor(readonly activeTurnId: string) {
    super(`当前会话已有未完成 Turn ${activeTurnId}`);
    this.name = 'TurnInProgressError';
  }
}

export class LearningSessionOwnershipError extends Error {
  readonly code = 'session_not_found';

  constructor() {
    super('学习会话不存在或不属于当前学生');
    this.name = 'LearningSessionOwnershipError';
  }
}

export class ChatLifecycleError extends Error {
  readonly code = 'invalid_message_transition';

  constructor(message: string) {
    super(message);
    this.name = 'ChatLifecycleError';
  }
}

export const DEFAULT_ASSISTANT_LEASE_MS = 45_000;
export const MIN_ASSISTANT_LEASE_MS = 5_000;
export const MAX_ASSISTANT_LEASE_MS = 5 * 60_000;

export function validateAssistantLeaseDuration(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_ASSISTANT_LEASE_MS ||
    value > MAX_ASSISTANT_LEASE_MS
  ) {
    throw new ChatLifecycleError(
      `leaseDurationMs 必须为 ${MIN_ASSISTANT_LEASE_MS}-${MAX_ASSISTANT_LEASE_MS} 之间的整数`,
    );
  }
  return value;
}

/** 所有创建 Turn 的仓储必须共用该session级锁键。 */
export function teachingTurnSessionLockKey(sessionId: string): string {
  return `teaching-turn-session-v1:${sessionId}`;
}

/**
 * 发送幂等的唯一内容口径：NFC、统一 LF，并只移除整段首尾空白。
 * 不合并段内空格或空行，避免改变学生原意。
 */
export function normalizeStudentMessageContent(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

function toSnapshot(
  row: typeof chatMessages.$inferSelect,
  parts?: readonly AgentMessagePart[],
): ChatMessageSnapshot {
  const projectedParts =
    parts ??
    (row.content.trim()
      ? ([{ type: 'text', text: row.content }] satisfies AgentMessagePart[])
      : []);
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    clientMessageId: row.clientMessageId,
    role: row.role as ChatMessageRole,
    status: row.status as ChatMessageStatus,
    content: row.content,
    parts: projectedParts,
    failureCode: row.failureCode,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    leaseId: row.leaseId,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    heartbeatAt: row.heartbeatAt?.toISOString() ?? null,
  };
}

async function requireOwnedSession(
  executor: DatabaseExecutor,
  sessionId: string,
  trustedStudentId: string,
  options: { requireActive?: boolean } = {},
) {
  const conditions = [
    eq(lessonSessions.id, sessionId),
    eq(lessonSessions.studentId, trustedStudentId),
  ];
  if (options.requireActive) {
    conditions.push(eq(lessonSessions.status, 'active'));
  }
  const [session] = await executor
    .select({
      id: lessonSessions.id,
      courseSlug: lessonSessions.courseSlug,
    })
    .from(lessonSessions)
    .where(and(...conditions))
    .limit(1);
  if (!session) throw new LearningSessionOwnershipError();
  return session;
}

async function loadTurn(
  executor: DatabaseExecutor,
  sessionId: string,
  turnId: string,
): Promise<TeachingTurnSnapshot> {
  const rows = await executor
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, sessionId),
        eq(chatMessages.turnId, turnId),
      ),
    );
  const studentMessage = rows.find((row) => row.role === 'student');
  const assistantMessage = rows.find((row) => row.role === 'assistant');
  if (!studentMessage || !assistantMessage) {
    throw new ChatLifecycleError('教学 Turn 的学生/老师消息不完整');
  }
  const parts = await loadMessageParts(
    executor,
    rows.map((row) => row.id),
  );
  return {
    turnId,
    studentMessage: toSnapshot(studentMessage, parts.get(studentMessage.id)),
    assistantMessage: toSnapshot(
      assistantMessage,
      parts.get(assistantMessage.id),
    ),
  };
}

/** 最小对话账本；身份校验、幂等与消息终态都在数据库边界收口。 */
export class DrizzleChatRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async getTurnByClientMessageId(input: {
    sessionId: string;
    trustedStudentId: string;
    clientMessageId: string;
  }): Promise<TeachingTurnSnapshot | null> {
    await requireOwnedSession(
      this.database,
      input.sessionId,
      input.trustedStudentId,
    );
    const [row] = await this.database
      .select({ turnId: chatMessages.turnId })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, input.sessionId),
          eq(chatMessages.clientMessageId, input.clientMessageId),
          eq(chatMessages.role, 'student'),
        ),
      )
      .limit(1);
    return row ? loadTurn(this.database, input.sessionId, row.turnId) : null;
  }

  /** Cancel Route 只接受 turnId；session 必须由可信学生身份反查。 */
  async getOwnedTurnByTurnId(input: {
    trustedStudentId: string;
    turnId: string;
  }): Promise<TeachingTurnSnapshot | null> {
    if (!isUuid(input.turnId)) throw new ChatLifecycleError('turnId 无效');
    const [owned] = await this.database
      .select({ sessionId: chatMessages.sessionId })
      .from(chatMessages)
      .innerJoin(lessonSessions, eq(lessonSessions.id, chatMessages.sessionId))
      .where(
        and(
          eq(chatMessages.turnId, input.turnId),
          eq(chatMessages.role, 'assistant'),
          eq(lessonSessions.studentId, input.trustedStudentId),
        ),
      )
      .limit(1);
    return owned
      ? loadTurn(this.database, owned.sessionId, input.turnId)
      : null;
  }

  async requestTurnCancellation(input: {
    trustedStudentId: string;
    turnId: string;
    now?: Date;
  }): Promise<{
    turn: TeachingTurnSnapshot | null;
    accepted: boolean;
  }> {
    if (!isUuid(input.turnId)) throw new ChatLifecycleError('turnId 无效');
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const [owned] = await transaction
        .select({
          id: chatMessages.id,
          sessionId: chatMessages.sessionId,
        })
        .from(chatMessages)
        .innerJoin(
          lessonSessions,
          eq(lessonSessions.id, chatMessages.sessionId),
        )
        .where(
          and(
            eq(chatMessages.turnId, input.turnId),
            eq(chatMessages.role, 'assistant'),
            eq(lessonSessions.studentId, input.trustedStudentId),
          ),
        )
        .limit(1);
      if (!owned) return { turn: null, accepted: false };
      const [updated] = await transaction
        .update(chatMessages)
        .set({ cancelRequestedAt: now })
        .where(
          and(
            eq(chatMessages.id, owned.id),
            inArray(chatMessages.status, ['pending', 'streaming']),
            isNull(chatMessages.cancelRequestedAt),
          ),
        )
        .returning({ id: chatMessages.id });
      const turn = await loadTurn(transaction, owned.sessionId, input.turnId);
      return {
        turn,
        accepted:
          Boolean(updated) ||
          (['pending', 'streaming'].includes(turn.assistantMessage.status) &&
            turn.assistantMessage.cancelRequestedAt !== null),
      };
    });
  }

  async isTurnCancellationRequested(input: {
    trustedStudentId: string;
    turnId: string;
  }): Promise<boolean> {
    const turn = await this.getOwnedTurnByTurnId(input);
    return Boolean(turn?.assistantMessage.cancelRequestedAt);
  }

  async markAssistantStreaming(input: {
    sessionId: string;
    trustedStudentId: string;
    assistantMessageId: string;
    leaseId: string;
    now?: Date;
  }): Promise<{ message: ChatMessageSnapshot; transitioned: boolean }> {
    if (!isUuid(input.leaseId)) throw new ChatLifecycleError('leaseId 无效');
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireOwnedSession(
        transaction,
        input.sessionId,
        input.trustedStudentId,
      );
      const [updated] = await transaction
        .update(chatMessages)
        .set({ status: 'streaming' })
        .where(
          and(
            eq(chatMessages.id, input.assistantMessageId),
            eq(chatMessages.sessionId, input.sessionId),
            eq(chatMessages.role, 'assistant'),
            eq(chatMessages.status, 'pending'),
            eq(chatMessages.leaseId, input.leaseId),
            gt(chatMessages.leaseExpiresAt, now),
          ),
        )
        .returning();
      if (updated) return { message: toSnapshot(updated), transitioned: true };
      const existing = await this.requireAssistantMessage(
        transaction,
        input.sessionId,
        input.assistantMessageId,
      );
      if (
        ['pending', 'streaming'].includes(existing.status) &&
        existing.leaseId !== input.leaseId
      ) {
        throw new ChatLifecycleError('老师消息 lease 不匹配');
      }
      return { message: toSnapshot(existing), transitioned: false };
    });
  }

  async appendAssistantDelta(input: {
    sessionId: string;
    trustedStudentId: string;
    assistantMessageId: string;
    leaseId: string;
    delta: string;
    now?: Date;
  }): Promise<ChatMessageSnapshot> {
    if (!input.delta) {
      throw new ChatLifecycleError('消息 delta 不能为空');
    }
    if (!isUuid(input.leaseId)) throw new ChatLifecycleError('leaseId 无效');
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireOwnedSession(
        transaction,
        input.sessionId,
        input.trustedStudentId,
      );
      const [updated] = await transaction
        .update(chatMessages)
        .set({ content: sql`${chatMessages.content} || ${input.delta}` })
        .where(
          and(
            eq(chatMessages.id, input.assistantMessageId),
            eq(chatMessages.sessionId, input.sessionId),
            eq(chatMessages.role, 'assistant'),
            eq(chatMessages.status, 'streaming'),
            eq(chatMessages.leaseId, input.leaseId),
            gt(chatMessages.leaseExpiresAt, now),
          ),
        )
        .returning();
      if (!updated) {
        throw new ChatLifecycleError('只能向 streaming 老师消息追加文本');
      }
      return toSnapshot(updated);
    });
  }

  async requestAssistantCancellation(input: {
    sessionId: string;
    trustedStudentId: string;
    assistantMessageId: string;
    now?: Date;
  }): Promise<{ message: ChatMessageSnapshot; accepted: boolean }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireOwnedSession(
        transaction,
        input.sessionId,
        input.trustedStudentId,
      );
      const [updated] = await transaction
        .update(chatMessages)
        .set({ cancelRequestedAt: now })
        .where(
          and(
            eq(chatMessages.id, input.assistantMessageId),
            eq(chatMessages.sessionId, input.sessionId),
            eq(chatMessages.role, 'assistant'),
            inArray(chatMessages.status, ['pending', 'streaming']),
            isNull(chatMessages.cancelRequestedAt),
          ),
        )
        .returning();
      if (updated) return { message: toSnapshot(updated), accepted: true };
      const existing = await this.requireAssistantMessage(
        transaction,
        input.sessionId,
        input.assistantMessageId,
      );
      return {
        message: toSnapshot(existing),
        accepted:
          ['pending', 'streaming'].includes(existing.status) &&
          existing.cancelRequestedAt !== null,
      };
    });
  }

  async settleAssistantMessage(input: {
    sessionId: string;
    trustedStudentId: string;
    assistantMessageId: string;
    status: AssistantTerminalStatus;
    leaseId?: string;
    failureCode?: string | null;
    now?: Date;
  }): Promise<{ message: ChatMessageSnapshot; transitioned: boolean }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireOwnedSession(
        transaction,
        input.sessionId,
        input.trustedStudentId,
      );
      if (input.status === 'completed') {
        if (!input.leaseId || !isUuid(input.leaseId)) {
          throw new ChatLifecycleError('完成老师消息必须提供有效 leaseId');
        }
        const assistant = await this.requireAssistantMessage(
          transaction,
          input.sessionId,
          input.assistantMessageId,
        );
        if (!assistant.content.trim()) {
          throw new ChatLifecycleError('空老师消息不能标记为 completed');
        }
        const runs = await transaction
          .select({
            phase: modelRuns.phase,
            attempt: modelRuns.attempt,
            status: modelRuns.status,
            finishReason: modelRuns.finishReason,
          })
          .from(modelRuns)
          .where(eq(modelRuns.assistantMessageId, input.assistantMessageId));
        const latestFor = (phase: 'answer' | 'synthesis') =>
          runs
            .filter((run) => run.phase === phase)
            .sort((left, right) => right.attempt - left.attempt)[0];
        const synthesis = latestFor('synthesis');
        const answer = latestFor('answer');
        const hasValidFinalRun = synthesis
          ? synthesis.status === 'succeeded'
          : answer?.status === 'succeeded' &&
            answer.finishReason !== 'tool_calls';
        if (!hasValidFinalRun) {
          throw new ChatLifecycleError(
            '缺少成功的最终 answer/synthesis model run，不能完成老师消息',
          );
        }
      }

      const sourceStatuses =
        input.status === 'completed'
          ? ['streaming']
          : (['pending', 'streaming'] as const);
      const conditions = [
        eq(chatMessages.id, input.assistantMessageId),
        eq(chatMessages.sessionId, input.sessionId),
        eq(chatMessages.role, 'assistant'),
        inArray(chatMessages.status, sourceStatuses),
      ];
      if (input.status === 'cancelled') {
        conditions.push(isNotNull(chatMessages.cancelRequestedAt));
      }
      if (input.leaseId) {
        if (!isUuid(input.leaseId)) {
          throw new ChatLifecycleError('leaseId 无效');
        }
        conditions.push(eq(chatMessages.leaseId, input.leaseId));
      }
      const [updated] = await transaction
        .update(chatMessages)
        .set({
          status: input.status,
          failureCode:
            input.status === 'completed' ? null : (input.failureCode ?? null),
          completedAt: now,
          cancelledAt: input.status === 'cancelled' ? now : null,
          leaseId: null,
          leaseExpiresAt: null,
        })
        .where(and(...conditions))
        .returning();
      if (updated) {
        await transaction
          .update(lessonSessions)
          .set({ lastActivityAt: now, updatedAt: now })
          .where(eq(lessonSessions.id, input.sessionId));
        return { message: toSnapshot(updated), transitioned: true };
      }
      const existing = await this.requireAssistantMessage(
        transaction,
        input.sessionId,
        input.assistantMessageId,
      );
      return { message: toSnapshot(existing), transitioned: false };
    });
  }

  async listHistory(input: {
    sessionId: string;
    trustedStudentId: string;
    after?: ChatHistoryCursor | null;
    limit?: number;
  }): Promise<ChatHistoryPage> {
    await requireOwnedSession(
      this.database,
      input.sessionId,
      input.trustedStudentId,
    );
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
    const rows = await this.database
      .select()
      .from(chatMessages)
      .where(
        cursorCondition
          ? and(eq(chatMessages.sessionId, input.sessionId), cursorCondition)
          : eq(chatMessages.sessionId, input.sessionId),
      )
      .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
      .limit(limit + 1);
    const hasNext = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const parts = await loadMessageParts(
      this.database,
      pageRows.map((row) => row.id),
    );
    const last = pageRows.at(-1);
    return {
      messages: pageRows.map((row) => toSnapshot(row, parts.get(row.id))),
      nextCursor:
        hasNext && last
          ? { createdAt: last.createdAt.toISOString(), id: last.id }
          : null,
    };
  }

  /**
   * 为 Runtime 加载最近一段已持久化对话，并按时间升序返回。
   * 与面向 UI 的前向分页分离，避免长会话永远只把最早一页送给模型。
   */
  async listRecentHistory(input: {
    sessionId: string;
    trustedStudentId: string;
    limit?: number;
  }): Promise<readonly ChatMessageSnapshot[]> {
    await requireOwnedSession(
      this.database,
      input.sessionId,
      input.trustedStudentId,
    );
    const limit = Math.max(1, Math.min(input.limit ?? 24, 100));
    const rows = await this.database
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
    const parts = await loadMessageParts(
      this.database,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toSnapshot(row, parts.get(row.id)));
  }

  private async requireAssistantMessage(
    executor: DatabaseExecutor,
    sessionId: string,
    assistantMessageId: string,
  ) {
    const [row] = await executor
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.id, assistantMessageId),
          eq(chatMessages.sessionId, sessionId),
          eq(chatMessages.role, 'assistant'),
        ),
      )
      .limit(1);
    if (!row) throw new ChatLifecycleError('老师消息不存在');
    return row;
  }
}
