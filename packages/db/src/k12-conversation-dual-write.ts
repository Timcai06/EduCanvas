/**
 * K12 可见消息到平台消息账本的受控兼容双写（R 线 R05、R08）。
 *
 * ## 权威矩阵（R05 A1）
 *
 * | 角色 | 表 | 说明 |
 * |------|-----|------|
 * | **当前运行权威** | `chat_messages`（schema.ts:1373） | 切读前承载 K12 可见消息与教学运行态 |
 * | **长期平台权威** | `conversation_messages`（schema.ts:762） | ADR-0013 指定的跨入口长期消息事实；当前仍是迁移投影 |
 * | **唯一生产写入者（begin）** | `DrizzleTeachingTurnLedger.beginOrReplay`（turn-ledger-repository.ts:519） | 事务内同写两侧 |
 * | **唯一生产写入者（settle）** | `DrizzleChatRepository.settleAssistantMessage`（chat-repository.ts:561） | 始终收敛，不受开关控制 |
 * | **兼容读取者** | 平台 Conversation API、Web General 历史投影、Gateway 兼容查询 | 只读，不写 |
 *
 * ## 开关语义
 *
 * `EDUCANVAS_K12_CONVERSATION_DUAL_WRITE`（`isK12ConversationDualWriteEnabled`）：
 * - **仅精确 `"true"` 开启**（`"1"`、`"TRUE"`、`"yes"` 均视为关闭）
 * - **开关只控制 `begin`**（创建新副本）；`settle` 始终运行，不受开关影响
 * - **设计理由**：已经创建的副本必须跨部署切换继续收敛，避免平台副本永久留在 pending
 *
 * `EDUCANVAS_K12_CONVERSATION_AUTHORITY_STAGE` 是 CA08B 唯一读权威配置：
 * - `legacy`（默认）与 `observe` 都保持可见消息和教学运行态从 `chat_messages` 读取；
 * - `observe` 只允许对账/观测，不授予 `conversation_messages` 生产读权威；
 * - `platform` 只切可见字段，并强制新消息继续建立平台副本；教学运行态仍由 legacy 承载；
 * - 其他值安全失败且不回显原始配置。回退必须显式设回 `legacy` 并重启。
 *
 * ## 退出条件（R08）
 *
 * `chat_messages` 继续承载 K12 运行权威；可见权威由上述 stage 冻结。
 * 退出方向受 accepted ADR-0013 约束：先回填并对账，再把可见消息消费者切到
 * `conversation_messages`；`chat_messages` 中 lease、取消、heartbeat 等教学运行态在获得
 * 新归属前不得删除。
 *
 * - **截止版本**：本双写随 R08 收口审计决定保留或删除；当前为兼容过渡机制
 * - **任务归属**：R08 关闭本线全部遗留路径时一并评估；Owner = R 线负责人
 * - **删除前置（三条同时满足）**：
 *   1. Web、Gateway、TUI 与 K12 恢复路径已通过统一读取兼容测试，可见消息消费者完成
 *      向 `conversation_messages` 的切读；
 *   2. 对账零差异持续 ≥ 1 个完整发布周期（`auditK12Parity` 全量扫描
 *      `missingInConversation=0` 且 `mismatchedInConversation=0`）；
 *   3. `chat_messages` 的教学运行态字段已有明确长期归属，并完成独立退役批准；
 * - **回退路径**：设 authority=`legacy`、dual-write=`false` 并重启即可恢复 legacy 可见读；
 *   已创建的投影 `settle` 仍继续收敛，旧表与引用、lease、cancel、heartbeat 均不删除
 * - **当前阶段**：受控切读；缺失、漂移或 orphan 任一非零时 platform 读 fail closed
 *
 * ## 数据流
 *
 * ```
 * begin:  chat_messages (INSERT) ──[观察开关或platform权威]──→ conversation_messages (INSERT)
 * settle: chat_messages (UPDATE) ──[始终运行]──→ conversation_messages (UPDATE)
 * ```
 *
 * begin 负责在 chat_messages 的创建事务中建立平台副本；settle 根据同一事务内
 * 已更新的 chat_messages 事实推进副本。开关只控制新副本创建，已经创建的副本
 * 始终随源消息收敛，避免部署切换把平台副本永久留在 pending。
 */
import {
  agentMessagePartSchema,
  type AgentMessagePart,
} from '@educanvas/agent-core';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
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
  k12ConversationMessageProjections,
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

export interface K12ConversationMessageProjectionIdentity {
  sourceChatMessageId: string;
  conversationMessageId: string;
  sessionId: string;
  conversationId: string;
}

export const K12_CONVERSATION_AUTHORITY_STAGE_ENV =
  'EDUCANVAS_K12_CONVERSATION_AUTHORITY_STAGE';

export type K12ConversationAuthorityStage = 'legacy' | 'observe' | 'platform';

interface K12ConversationAuthorityBase {
  runtimeAuthority: 'chat_messages';
  longTermTarget: 'conversation_messages';
  rollback: Readonly<{
    stage: 'legacy';
    visibleAuthority: 'chat_messages';
    runtimeAuthority: 'chat_messages';
    dualWriteEnabled: false;
  }>;
}

/** 单一 authority 配置在类型上同时冻结可见读源与可回退能力。 */
export type K12ConversationAuthorityContract =
  | (K12ConversationAuthorityBase & {
      stage: 'legacy' | 'observe';
      currentVisibleAuthority: 'chat_messages';
      productionReadSource: 'chat_messages';
      cutoverSupported: false;
    })
  | (K12ConversationAuthorityBase & {
      stage: 'platform';
      currentVisibleAuthority: 'conversation_messages';
      productionReadSource: 'conversation_messages';
      cutoverSupported: true;
    });

/** 配置错误不回显原值，避免把误填的Secret带入日志或HTTP错误。 */
export class K12ConversationAuthorityConfigurationError extends Error {
  readonly code = 'invalid_k12_conversation_authority_stage';

  constructor() {
    super('K12 conversation authority stage is invalid');
    this.name = 'K12ConversationAuthorityConfigurationError';
  }
}

const STAGE_ONE_ROLLBACK = Object.freeze({
  stage: 'legacy' as const,
  visibleAuthority: 'chat_messages' as const,
  runtimeAuthority: 'chat_messages' as const,
  dualWriteEnabled: false as const,
});

/**
 * 冻结 CA08A 的读权威与回退契约。本函数只解析/报告状态，不参与任何消息查询；
 * 因而 `observe` 不能暗中切换既有 Web、Gateway 或 K12 恢复读路径。
 */
export function resolveK12ConversationAuthorityContract(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<K12ConversationAuthorityContract> {
  const configured = env[K12_CONVERSATION_AUTHORITY_STAGE_ENV];
  const stage = configured === undefined ? 'legacy' : configured;
  if (stage !== 'legacy' && stage !== 'observe' && stage !== 'platform') {
    throw new K12ConversationAuthorityConfigurationError();
  }
  if (stage === 'platform') {
    return Object.freeze({
      stage,
      currentVisibleAuthority: 'conversation_messages',
      runtimeAuthority: 'chat_messages',
      longTermTarget: 'conversation_messages',
      productionReadSource: 'conversation_messages',
      cutoverSupported: true,
      rollback: STAGE_ONE_ROLLBACK,
    });
  }
  return Object.freeze({
    stage,
    currentVisibleAuthority: 'chat_messages',
    runtimeAuthority: 'chat_messages',
    longTermTarget: 'conversation_messages',
    productionReadSource: 'chat_messages',
    cutoverSupported: false,
    rollback: STAGE_ONE_ROLLBACK,
  });
}

/** 关闭默认；只有精确的 `true` 才允许为新 K12 消息创建平台副本。 */
export function isK12ConversationDualWriteEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE === 'true';
}

/** platform 可见权威必须持续创建副本；legacy/observe 仍服从独立双写观察开关。 */
export function shouldCreateK12ConversationProjection(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    resolveK12ConversationAuthorityContract(env).stage === 'platform' ||
    isK12ConversationDualWriteEnabled(env)
  );
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

async function findProjectionIdentities(
  transaction: DatabaseTransaction,
  expected: K12ConversationMessageProjectionIdentity,
) {
  return transaction
    .select()
    .from(k12ConversationMessageProjections)
    .where(
      or(
        eq(
          k12ConversationMessageProjections.sourceChatMessageId,
          expected.sourceChatMessageId,
        ),
        eq(
          k12ConversationMessageProjections.conversationMessageId,
          expected.conversationMessageId,
        ),
      ),
    )
    .limit(2);
}

function isExactProjectionIdentity(
  actual: typeof k12ConversationMessageProjections.$inferSelect,
  expected: K12ConversationMessageProjectionIdentity,
): boolean {
  return (
    actual.sourceChatMessageId === expected.sourceChatMessageId &&
    actual.conversationMessageId === expected.conversationMessageId &&
    actual.sessionId === expected.sessionId &&
    actual.conversationId === expected.conversationId
  );
}

/** 插入或验证 provenance 身份；任何稳定键或作用域漂移都只抛稳定 invariant。 */
export async function insertOrVerifyK12ConversationMessageProjection(
  transaction: DatabaseTransaction,
  expected: K12ConversationMessageProjectionIdentity,
): Promise<void> {
  const [inserted] = await transaction
    .insert(k12ConversationMessageProjections)
    .values(expected)
    .onConflictDoNothing()
    .returning({
      sourceChatMessageId:
        k12ConversationMessageProjections.sourceChatMessageId,
    });
  if (inserted) return;

  const existing = await findProjectionIdentities(transaction, expected);
  if (
    existing.length !== 1 ||
    !existing[0] ||
    !isExactProjectionIdentity(existing[0], expected)
  ) {
    throw new K12ConversationDualWriteInvariantError();
  }
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
  const projections = [student, assistant].map((row) => {
    const projection: K12SourceProjection = {
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
    };
    return {
      projection,
      identity: {
        sourceChatMessageId: row.id,
        conversationMessageId: projection.id,
        sessionId: input.sessionId,
        conversationId: input.conversationId,
      },
    };
  });
  for (const { projection, identity } of projections) {
    await insertOrVerifyBeginProjection(input.transaction, projection);
    await insertOrVerifyK12ConversationMessageProjection(
      input.transaction,
      identity,
    );
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
  const identity: K12ConversationMessageProjectionIdentity = {
    sourceChatMessageId: source.id,
    conversationMessageId: projection.id,
    sessionId: input.sessionId,
    conversationId: projection.conversationId,
  };
  const existingIdentities = await findProjectionIdentities(
    input.transaction,
    identity,
  );
  if (
    existingIdentities.length > 0 &&
    (existingIdentities.length !== 1 ||
      !existingIdentities[0] ||
      !isExactProjectionIdentity(existingIdentities[0], identity))
  ) {
    throw new K12ConversationDualWriteInvariantError();
  }
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
  if (updated) {
    await insertOrVerifyK12ConversationMessageProjection(
      input.transaction,
      identity,
    );
    return;
  }

  const [conflicting] = await input.transaction
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, projection.id))
    .limit(1);
  if (conflicting || existingIdentities.length > 0) {
    throw new K12ConversationDualWriteInvariantError();
  }
}
