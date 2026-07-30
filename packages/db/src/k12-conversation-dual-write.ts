/**
 * K12 可见消息到平台消息账本的受控兼容双写。
 *
 * begin 负责在 chat_messages 的创建事务中建立平台副本；settle 根据同一事务内
 * 已更新的 chat_messages 事实推进副本。开关只控制新副本创建，已经创建的副本
 * 始终随源消息收敛，避免部署切换把平台副本永久留在 pending。
 */
import {
  agentMessagePartSchema,
  type AgentMessagePart,
} from '@educanvas/agent-core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import type { DatabaseTransaction } from './internal/database-types';
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

type ConversationMessageStatus =
  | 'pending'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

interface K12SourceProjection {
  id: string;
  conversationId: string;
  operationId: string | null;
  role: 'user' | 'assistant';
  status: ConversationMessageStatus;
  content: string;
  parts: readonly AgentMessagePart[];
  failureCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

/** 关闭默认；只有精确的 `true` 才允许为新 K12 消息创建平台副本。 */
export function isK12ConversationDualWriteEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE === 'true';
}

export function mapK12ConversationRole(role: string): 'user' | 'assistant' {
  if (role === 'student') return 'user';
  if (role === 'assistant') return 'assistant';
  throw new K12ConversationDualWriteInvariantError();
}

export function mapK12ConversationStatus(
  status: string,
): ConversationMessageStatus {
  if (
    status !== 'pending' &&
    status !== 'streaming' &&
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'cancelled' &&
    status !== 'interrupted'
  ) {
    throw new K12ConversationDualWriteInvariantError();
  }
  return status;
}

export function projectK12ConversationParts(
  content: string,
  storedParts: readonly AgentMessagePart[] | undefined,
): readonly AgentMessagePart[] {
  if (storedParts && storedParts.length > 0) return storedParts;
  if (!content.trim()) return [];
  const parsed = agentMessagePartSchema.safeParse({
    type: 'text',
    text: content,
  });
  if (!parsed.success) {
    throw new K12ConversationDualWriteInvariantError();
  }
  return [parsed.data];
}

export function sameK12ConversationParts(
  left: readonly AgentMessagePart[],
  right: readonly AgentMessagePart[],
): boolean {
  // PostgreSQL jsonb 不保留对象键顺序，Part 对账必须比较结构语义而非序列化文本。
  return isDeepStrictEqual(left, right);
}

async function insertOrVerifyBeginProjection(
  transaction: DatabaseTransaction,
  projection: K12SourceProjection,
): Promise<void> {
  const [inserted] = await transaction
    .insert(conversationMessages)
    .values({ ...projection, parts: [...projection.parts] })
    .onConflictDoNothing({ target: conversationMessages.id })
    .returning({ id: conversationMessages.id });
  if (inserted) return;

  const [existing] = await transaction
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, projection.id))
    .limit(1);
  const sameIdentity =
    existing?.conversationId === projection.conversationId &&
    existing.operationId === projection.operationId &&
    existing.role === projection.role &&
    existing.createdAt.getTime() === projection.createdAt.getTime();
  const compatibleState =
    projection.role === 'assistant'
      ? existing?.status === 'pending' ||
        existing?.status === 'streaming' ||
        existing?.status === 'completed' ||
        existing?.status === 'failed' ||
        existing?.status === 'cancelled' ||
        existing?.status === 'interrupted'
      : existing?.status === projection.status &&
        existing.content === projection.content &&
        existing.failureCode === projection.failureCode &&
        sameK12ConversationParts(existing.parts, projection.parts) &&
        existing.completedAt?.getTime() === projection.completedAt?.getTime();
  if (!sameIdentity || !compatibleState) {
    throw new K12ConversationDualWriteInvariantError();
  }
}

export interface DualWriteBeginInput {
  transaction: DatabaseTransaction;
  sessionId: string;
  conversationId: string;
  operationId: string | null;
  studentChatMessageId: string;
  assistantChatMessageId: string;
}

/**
 * 从同一事务刚写入的 K12 消息事实建立平台副本。
 * 所有跨 Conversation、角色或状态漂移都会回滚整个 begin 事务。
 */
export async function dualWriteBeginMessages(
  input: DualWriteBeginInput,
): Promise<void> {
  if (input.studentChatMessageId === input.assistantChatMessageId) {
    throw new K12ConversationDualWriteInvariantError();
  }
  const sourceRows = await input.transaction
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      status: chatMessages.status,
      content: chatMessages.content,
      failureCode: chatMessages.failureCode,
      createdAt: chatMessages.createdAt,
      completedAt: chatMessages.completedAt,
      conversationId: lessonSessions.conversationId,
    })
    .from(chatMessages)
    .innerJoin(lessonSessions, eq(lessonSessions.id, chatMessages.sessionId))
    .where(
      and(
        eq(chatMessages.sessionId, input.sessionId),
        eq(lessonSessions.conversationId, input.conversationId),
        inArray(chatMessages.id, [
          input.studentChatMessageId,
          input.assistantChatMessageId,
        ]),
      ),
    );
  const student = sourceRows.find(
    (row) => row.id === input.studentChatMessageId,
  );
  const assistant = sourceRows.find(
    (row) => row.id === input.assistantChatMessageId,
  );
  if (
    !student ||
    student.role !== 'student' ||
    student.status !== 'completed' ||
    !student.completedAt ||
    !assistant ||
    assistant.role !== 'assistant' ||
    assistant.status !== 'pending' ||
    assistant.completedAt
  ) {
    throw new K12ConversationDualWriteInvariantError();
  }
  const sourceParts = await loadMessageParts(input.transaction, [
    student.id,
    assistant.id,
  ]);
  const projections: K12SourceProjection[] = [student, assistant].map(
    (row) => ({
      id: deterministicConversationMessageId(row.id),
      conversationId: input.conversationId,
      operationId: input.operationId,
      role: mapK12ConversationRole(row.role),
      status: mapK12ConversationStatus(row.status),
      content: row.content,
      parts: projectK12ConversationParts(row.content, sourceParts.get(row.id)),
      failureCode: row.failureCode,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    }),
  );
  for (const projection of projections) {
    await insertOrVerifyBeginProjection(input.transaction, projection);
  }
}

export interface DualWriteSettleInput {
  transaction: DatabaseTransaction;
  sessionId: string;
  assistantChatMessageId: string;
}

/**
 * 将已存在的平台副本推进到 K12 源消息的真实终态。
 * 若 begin 时开关关闭、平台副本不存在，则保持兼容 no-op；若同一派生 ID
 * 指向错误 Conversation 或角色，则回滚 K12 settle，禁止静默更新错对象。
 */
export async function dualWriteSettleAssistant(
  input: DualWriteSettleInput,
): Promise<void> {
  const [source] = await input.transaction
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
      and(
        eq(chatMessages.id, input.assistantChatMessageId),
        eq(chatMessages.sessionId, input.sessionId),
        eq(chatMessages.role, 'assistant'),
      ),
    )
    .limit(1);
  if (!source || !source.completedAt) {
    throw new K12ConversationDualWriteInvariantError();
  }
  if (!source.conversationId) return;

  const storedParts = await loadMessageParts(input.transaction, [source.id]);
  const projection: K12SourceProjection = {
    id: deterministicConversationMessageId(source.id),
    conversationId: source.conversationId,
    operationId: source.operationId,
    role: mapK12ConversationRole(source.role),
    status: mapK12ConversationStatus(source.status),
    content: source.content,
    parts: projectK12ConversationParts(
      source.content,
      storedParts.get(source.id),
    ),
    failureCode: source.failureCode,
    createdAt: source.createdAt,
    completedAt: source.completedAt,
  };
  const [updated] = await input.transaction
    .update(conversationMessages)
    .set({
      status: projection.status,
      content: projection.content,
      parts: [...projection.parts],
      failureCode: projection.failureCode,
      completedAt: projection.completedAt,
    })
    .where(
      and(
        eq(conversationMessages.id, projection.id),
        eq(conversationMessages.conversationId, projection.conversationId),
        eq(conversationMessages.role, 'assistant'),
        projection.operationId
          ? eq(conversationMessages.operationId, projection.operationId)
          : sql`${conversationMessages.operationId} is null`,
      ),
    )
    .returning({ id: conversationMessages.id });
  if (updated) return;

  const [conflicting] = await input.transaction
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, projection.id))
    .limit(1);
  if (conflicting) {
    throw new K12ConversationDualWriteInvariantError();
  }
}
