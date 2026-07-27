/**
 * 统一只读消息历史投影。
 *
 * 本模块是兼容层：它不合并事实表，只提供跨 conversation_messages 与 chat_messages 的稳定只读视图。
 * 写入路径仍由 DrizzleChatRepository 和 DrizzlePlatformTurnRepository 独占。
 *
 * 设计约束：
 * - 浏览器无关、Provider 无关
 * - K12 role `student` 映射为 `user`，`assistant` 保持不变；不伪造 system/tool 消息
 * - 使用 lesson_sessions.conversation_id 做可信关联，不按标题、时间或客户端 ID 猜测
 * - 稳定排序：createdAt 相同时按 source（conversation < k12）再按 messageId 确定 tie-breaker
 * - 游标可验证、有界，不使用 offset
 * - 只能在服务端完成所有权/Notebook 访问校验后调用
 */

import type { AgentMessagePart } from '@educanvas/agent-core';
import { and, asc, eq, getTableColumns, gt, or } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { loadMessageParts } from './message-parts';
import { requireNotebookAccess } from './notebook-access';
import {
  chatMessages,
  conversations,
  conversationMessages,
  lessonSessions,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

/** 消息来源标识：conversation 来自 conversation_messages，k12 来自 chat_messages。 */
export type MessageHistorySource = 'conversation' | 'k12';

/** 统一角色：conversation_messages 原生 user/assistant/system/tool，K12 student->user。 */
export type MessageHistoryRole = 'user' | 'assistant' | 'system' | 'tool';

/** 统一终态：保留原始 status，不掩盖 failed/cancelled/interrupted。 */
export type MessageHistoryStatus =
  | 'pending'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface MessageHistoryItem {
  readonly id: string;
  readonly source: MessageHistorySource;
  readonly role: MessageHistoryRole;
  readonly status: MessageHistoryStatus;
  readonly content: string;
  readonly parts: readonly AgentMessagePart[];
  readonly failureCode: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly operationId: string | null;
  readonly turnId: string | null;
}

export interface MessageHistoryCursor {
  createdAt: string;
  source: MessageHistorySource;
  messageId: string;
}

export interface MessageHistoryPage {
  messages: readonly MessageHistoryItem[];
  nextCursor: MessageHistoryCursor | null;
}

export interface ListMessageHistoryInput {
  conversationId: string;
  trustedSubjectId: string;
  after?: MessageHistoryCursor | null;
  limit?: number;
}

/** 浏览器无关的兼容读取端口；写路径不属于该端口。 */
export interface UnifiedMessageHistoryPort {
  listHistory(input: ListMessageHistoryInput): Promise<MessageHistoryPage>;
}

export class MessageHistoryAccessError extends Error {
  readonly code = 'conversation_not_found';

  constructor() {
    super('Conversation不存在或不属于当前主体');
    this.name = 'MessageHistoryAccessError';
  }
}

function mapK12Role(role: string): MessageHistoryRole {
  if (role === 'student') return 'user';
  if (role === 'assistant') return 'assistant';
  throw new Error(`K12 chat_messages 包含意外角色: ${role}`);
}

function validateCursor(cursor: MessageHistoryCursor): void {
  const date = new Date(cursor.createdAt);
  if (Number.isNaN(date.getTime())) {
    throw new MessageHistoryAccessError();
  }
  if (cursor.source !== 'conversation' && cursor.source !== 'k12') {
    throw new MessageHistoryAccessError();
  }
  if (!isUuid(cursor.messageId)) {
    throw new MessageHistoryAccessError();
  }
}

/**
 * 验证调用者对 conversation 的访问权限。
 * 统一只读必须在所有权/Notebook 访问校验后才能调用。
 */
async function requireConversationReadAccess(
  executor: DatabaseExecutor,
  conversationId: string,
  trustedSubjectId: string,
): Promise<void> {
  const [conversation] = await executor
    .select({ id: conversations.id, spaceId: conversations.spaceId })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.status, 'active'),
      ),
    )
    .limit(1);
  if (!conversation) throw new MessageHistoryAccessError();
  const access = await requireNotebookAccess(executor, {
    notebookId: conversation.spaceId,
    trustedSubjectId,
    requiredPermission: 'notebook.read',
  }).catch(() => null);
  if (!access) throw new MessageHistoryAccessError();
}

function toConversationMessageItem(
  row: typeof conversationMessages.$inferSelect,
): MessageHistoryItem {
  return {
    id: row.id,
    source: 'conversation',
    role: row.role as MessageHistoryRole,
    status: row.status as MessageHistoryStatus,
    content: row.content,
    parts: row.parts,
    failureCode: row.failureCode,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    operationId: row.operationId,
    turnId: null,
  };
}

function toK12MessageItem(
  row: typeof chatMessages.$inferSelect,
): MessageHistoryItem {
  return {
    id: row.id,
    source: 'k12',
    role: mapK12Role(row.role),
    status: row.status as MessageHistoryStatus,
    content: row.content,
    parts: [],
    failureCode: row.failureCode,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    operationId: null,
    turnId: row.turnId,
  };
}

/**
 * 在应用层合并两个已排序流并稳定 tie-break。
 *
 * 排序规则：
 * 1. createdAt 升序
 * 2. source: 'conversation' < 'k12'（同一时间戳下 conversation 消息排在前面）
 * 3. messageId 升序（最终兜底）
 *
 * 因为 PostgreSQL 的 UNION ALL 不保证跨表同时间戳的确定顺序，
 * 我们在应用层做归并以确保游标语义正确。
 */
function mergeSorted(
  conversationItems: MessageHistoryItem[],
  k12Items: MessageHistoryItem[],
  limit: number,
): MessageHistoryItem[] {
  const result: MessageHistoryItem[] = [];
  let ci = 0;
  let ki = 0;
  while (
    result.length < limit &&
    (ci < conversationItems.length || ki < k12Items.length)
  ) {
    const c = ci < conversationItems.length ? conversationItems[ci] : null;
    const k = ki < k12Items.length ? k12Items[ki] : null;
    if (!c) {
      result.push(k!);
      ki++;
    } else if (!k) {
      result.push(c);
      ci++;
    } else {
      const cTime = new Date(c.createdAt).getTime();
      const kTime = new Date(k.createdAt).getTime();
      if (cTime < kTime) {
        result.push(c);
        ci++;
      } else if (kTime < cTime) {
        result.push(k);
        ki++;
      } else if (c.source < k.source) {
        result.push(c);
        ci++;
      } else if (k.source < c.source) {
        result.push(k);
        ki++;
      } else if (c.id < k.id) {
        result.push(c);
        ci++;
      } else {
        result.push(k);
        ki++;
      }
    }
  }
  return result;
}

export class DrizzleUnifiedMessageHistoryRepository implements UnifiedMessageHistoryPort {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async listHistory(
    input: ListMessageHistoryInput,
  ): Promise<MessageHistoryPage> {
    await requireConversationReadAccess(
      this.database,
      input.conversationId,
      input.trustedSubjectId,
    );

    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));

    if (input.after) {
      validateCursor(input.after);
    }

    const cursorDate = input.after ? new Date(input.after.createdAt) : null;

    // Fetch conversation_messages
    const convCursorCondition =
      input.after && cursorDate
        ? input.after.source === 'conversation'
          ? or(
              gt(conversationMessages.createdAt, cursorDate),
              and(
                eq(conversationMessages.createdAt, cursorDate),
                gt(conversationMessages.id, input.after.messageId),
              ),
            )
          : gt(conversationMessages.createdAt, cursorDate)
        : undefined;

    const convRows = await this.database
      .select()
      .from(conversationMessages)
      .where(
        convCursorCondition
          ? and(
              eq(conversationMessages.conversationId, input.conversationId),
              convCursorCondition,
            )
          : eq(conversationMessages.conversationId, input.conversationId),
      )
      .orderBy(
        asc(conversationMessages.createdAt),
        asc(conversationMessages.id),
      )
      .limit(limit + 1);

    const k12CursorCondition =
      input.after && cursorDate
        ? input.after.source === 'k12'
          ? or(
              gt(chatMessages.createdAt, cursorDate),
              and(
                eq(chatMessages.createdAt, cursorDate),
                gt(chatMessages.id, input.after.messageId),
              ),
            )
          : or(
              gt(chatMessages.createdAt, cursorDate),
              eq(chatMessages.createdAt, cursorDate),
            )
        : undefined;
    // 直接通过可信 FK 关联并在数据库侧限流，避免先加载无界 sessionId 集合。
    const k12Rows = await this.database
      .select({ ...getTableColumns(chatMessages) })
      .from(chatMessages)
      .innerJoin(lessonSessions, eq(lessonSessions.id, chatMessages.sessionId))
      .where(
        k12CursorCondition
          ? and(
              eq(lessonSessions.conversationId, input.conversationId),
              k12CursorCondition,
            )
          : eq(lessonSessions.conversationId, input.conversationId),
      )
      .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
      .limit(limit + 1);

    // Map to unified items
    const convItems = convRows.map((row) => toConversationMessageItem(row));
    const k12Items = k12Rows.map((row) => toK12MessageItem(row));

    // Merge sorted
    const merged = mergeSorted(convItems, k12Items, limit + 1);
    const hasNext = merged.length > limit;
    const pageItems = merged.slice(0, limit);

    // K12 Part 存在独立结构化表；通用消息的 Part 已在 conversation_messages 行内。
    const k12Ids = pageItems
      .filter((item) => item.source === 'k12')
      .map((item) => item.id);
    let partsMap: ReadonlyMap<string, readonly AgentMessagePart[]> = new Map();
    if (k12Ids.length > 0) {
      partsMap = await loadMessageParts(this.database, k12Ids);
    }

    const finalItems = pageItems.map((item) => {
      if (item.source === 'k12') {
        const parts = partsMap.get(item.id);
        return parts ? { ...item, parts } : item;
      }
      return item;
    });

    // Build next cursor from the last item
    const last = finalItems.at(-1);
    const nextCursor: MessageHistoryCursor | null =
      hasNext && last
        ? {
            createdAt: last.createdAt,
            source: last.source,
            messageId: last.id,
          }
        : null;

    return { messages: finalItems, nextCursor };
  }
}
