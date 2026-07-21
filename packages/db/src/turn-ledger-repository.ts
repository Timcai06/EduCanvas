import { randomUUID } from 'node:crypto';
import type { AgentMessagePart } from '@educanvas/agent-core';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  ChatLifecycleError,
  ChatMessageIdConflictError,
  DEFAULT_ASSISTANT_LEASE_MS,
  LearningSessionOwnershipError,
  TurnInProgressError,
  teachingTurnSessionLockKey,
  validateAssistantLeaseDuration,
  type ChatMessageSnapshot,
  type TeachingTurnSnapshot,
} from './chat-repository';
import type { ModelRunSnapshot } from './model-run-repository';
import {
  chatMessages,
  agentOperations,
  conversations,
  lessonSessions,
  modelRuns,
  turnContextSnapshots,
} from './schema';
import {
  prepareTurnContextMaterial,
  type PreparedTurnContextMaterial,
  type TurnContextMaterial,
} from './turn-context';
import {
  assertOwnedReadyAssetParts,
  insertMessageParts,
  loadMessageParts,
  prepareStudentMessage,
} from './message-parts';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export interface BeginTeachingTurnInput {
  sessionId: string;
  trustedStudentId: string;
  clientMessageId: string;
  text?: string;
  parts?: readonly AgentMessagePart[];
  traceId: string;
  /** Gateway 已建立 operation 时复用其 UUID，确保全链路只有一个 Turn ID。 */
  turnId?: string;
  modelAlias: string;
  promptVersion: string;
  promptHash: string;
  provider?: string | null;
  contextSnapshot?: TurnContextMaterial;
  leaseDurationMs?: number;
  rateLimit?: {
    maxTurns: number;
    windowMs: number;
  };
  now?: Date;
}

/** Teaching Profile 接入统一 Turn Application 时只创建K12可见消息，不预写第二套审计。 */
export type BeginTeachingApplicationTurnInput = Omit<
  BeginTeachingTurnInput,
  'modelAlias' | 'promptVersion' | 'promptHash' | 'provider' | 'contextSnapshot'
> & { turnId: string };

export interface TeachingApplicationTurnLedgerSnapshot {
  replayed: boolean;
  turn: TeachingTurnSnapshot;
  leaseId: string | null;
}

export interface TeachingTurnLedgerSnapshot {
  replayed: boolean;
  turn: TeachingTurnSnapshot;
  answerRun: ModelRunSnapshot;
  leaseId: string | null;
}

export class TurnLedgerInvariantError extends Error {
  readonly code = 'turn_ledger_incomplete';

  constructor(message: string) {
    super(message);
    this.name = 'TurnLedgerInvariantError';
  }
}

export class TurnRateLimitError extends Error {
  readonly code = 'turn_rate_limited';

  constructor(readonly retryAfterMs: number) {
    super(`教学 Turn 请求过于频繁，${retryAfterMs}ms后可重试`);
    this.name = 'TurnRateLimitError';
  }
}

export const DEFAULT_TURN_RATE_LIMIT = Object.freeze({
  maxTurns: 8,
  windowMs: 60_000,
});

function toMessageSnapshot(
  row: typeof chatMessages.$inferSelect,
  parts?: readonly AgentMessagePart[],
): ChatMessageSnapshot {
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    clientMessageId: row.clientMessageId,
    role: row.role as ChatMessageSnapshot['role'],
    status: row.status as ChatMessageSnapshot['status'],
    content: row.content,
    parts:
      parts ??
      (row.content.trim()
        ? ([{ type: 'text', text: row.content }] satisfies AgentMessagePart[])
        : []),
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

function toRunSnapshot(row: typeof modelRuns.$inferSelect): ModelRunSnapshot {
  if (!row.sessionId || !row.assistantMessageId || !row.turnId) {
    throw new TurnLedgerInvariantError(
      'teaching_turn model run 缺少 sessionId/assistantMessageId/turnId',
    );
  }
  return {
    id: row.id,
    sessionId: row.sessionId,
    operationId: row.operationId,
    operationKind: 'teaching_turn',
    assistantMessageId: row.assistantMessageId,
    turnId: row.turnId,
    phase: row.phase as ModelRunSnapshot['phase'],
    attempt: row.attempt,
    traceId: row.traceId,
    taskAlias: 'teaching.turn',
    modelAlias: row.modelAlias,
    promptVersion: row.promptVersion,
    promptHash: row.promptHash,
    provider: row.provider,
    providerModelId: row.providerModelId,
    modelRevision: row.modelRevision,
    providerResponseId: row.providerResponseId,
    systemFingerprint: row.systemFingerprint,
    finishReason: row.finishReason,
    status: row.status as ModelRunSnapshot['status'],
    errorCode: row.errorCode,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheHitTokens: row.cacheHitTokens,
    reasoningTokens: row.reasoningTokens,
    latencyMs: row.latencyMs,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function makeTitle(courseSlug: string, content: string): string {
  const preview = content.replace(/\s+/g, ' ');
  return [...`${courseSlug} · ${preview}`].slice(0, 64).join('');
}

interface PreparedTeachingMessageTurn {
  content: string;
  parts: readonly AgentMessagePart[];
  requestHash: string;
  leaseDurationMs: number;
  rateLimit: { maxTurns: number; windowMs: number };
}

function validateMessageInput(
  input: BeginTeachingApplicationTurnInput | BeginTeachingTurnInput,
): PreparedTeachingMessageTurn {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.clientMessageId)) {
    throw new ChatLifecycleError('clientMessageId 格式或长度无效');
  }
  const message = prepareStudentMessage({
    clientMessageId: input.clientMessageId,
    text: input.text,
    parts: input.parts,
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.traceId)) {
    throw new ChatLifecycleError('traceId 格式或长度无效');
  }
  if (
    input.turnId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.turnId,
    )
  ) {
    throw new ChatLifecycleError('Gateway turnId 必须是 UUID');
  }
  const rateLimit = input.rateLimit ?? DEFAULT_TURN_RATE_LIMIT;
  if (
    !Number.isInteger(rateLimit.maxTurns) ||
    rateLimit.maxTurns < 1 ||
    rateLimit.maxTurns > 100 ||
    !Number.isInteger(rateLimit.windowMs) ||
    rateLimit.windowMs < 1_000 ||
    rateLimit.windowMs > 60 * 60_000
  ) {
    throw new ChatLifecycleError(
      'Turn rate limit 必须为1-100次、1秒至1小时的窗口',
    );
  }
  return {
    content: message.content,
    parts: message.parts,
    requestHash: message.requestHash,
    leaseDurationMs: validateAssistantLeaseDuration(
      input.leaseDurationMs ?? DEFAULT_ASSISTANT_LEASE_MS,
    ),
    rateLimit,
  };
}

function validateInput(
  input: BeginTeachingTurnInput,
): PreparedTeachingMessageTurn & {
  contextSnapshot: PreparedTurnContextMaterial | null;
} {
  const message = validateMessageInput(input);
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(input.modelAlias)) {
    throw new ChatLifecycleError('modelAlias 格式或长度无效');
  }
  if (!input.promptVersion || input.promptVersion.length > 128) {
    throw new ChatLifecycleError('promptVersion 格式或长度无效');
  }
  if (!/^[0-9a-f]{64}$/i.test(input.promptHash)) {
    throw new ChatLifecycleError('promptHash 必须是SHA-256');
  }
  return {
    ...message,
    contextSnapshot: input.contextSnapshot
      ? prepareTurnContextMaterial(input.contextSnapshot)
      : null,
  };
}

async function loadLedgerSnapshot(
  transaction: DatabaseTransaction,
  sessionId: string,
  turnId: string,
  replayed: boolean,
): Promise<TeachingTurnLedgerSnapshot> {
  const messages = await transaction
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, sessionId),
        eq(chatMessages.turnId, turnId),
      ),
    );
  const student = messages.find((message) => message.role === 'student');
  const assistant = messages.find((message) => message.role === 'assistant');
  const [answerRun] = await transaction
    .select()
    .from(modelRuns)
    .where(
      and(
        eq(modelRuns.sessionId, sessionId),
        eq(modelRuns.turnId, turnId),
        eq(modelRuns.phase, 'answer'),
        eq(modelRuns.attempt, 1),
      ),
    )
    .limit(1);
  if (!student || !assistant || !answerRun) {
    throw new TurnLedgerInvariantError(
      '教学 Turn 缺少学生消息、老师消息或 answer model run',
    );
  }
  const parts = await loadMessageParts(transaction, [student.id, assistant.id]);
  return {
    replayed,
    turn: {
      turnId,
      studentMessage: toMessageSnapshot(student, parts.get(student.id)),
      assistantMessage: toMessageSnapshot(assistant, parts.get(assistant.id)),
    },
    answerRun: toRunSnapshot(answerRun),
    leaseId: assistant.leaseId,
  };
}

async function loadApplicationSnapshot(
  transaction: DatabaseTransaction,
  sessionId: string,
  turnId: string,
  replayed: boolean,
): Promise<TeachingApplicationTurnLedgerSnapshot> {
  const messages = await transaction
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, sessionId),
        eq(chatMessages.turnId, turnId),
      ),
    );
  const student = messages.find((message) => message.role === 'student');
  const assistant = messages.find((message) => message.role === 'assistant');
  if (!student || !assistant) {
    throw new TurnLedgerInvariantError('教学 Turn 缺少学生消息或老师消息');
  }
  const parts = await loadMessageParts(transaction, [student.id, assistant.id]);
  return {
    replayed,
    turn: {
      turnId,
      studentMessage: toMessageSnapshot(student, parts.get(student.id)),
      assistantMessage: toMessageSnapshot(assistant, parts.get(assistant.id)),
    },
    leaseId: assistant.leaseId,
  };
}

async function beginTeachingMessages(
  transaction: DatabaseTransaction,
  input: BeginTeachingApplicationTurnInput | BeginTeachingTurnInput,
  prepared: PreparedTeachingMessageTurn,
  now: Date,
): Promise<{ turnId: string; replayed: boolean }> {
  const [session] = await transaction
    .select({
      id: lessonSessions.id,
      courseSlug: lessonSessions.courseSlug,
      conversationId: lessonSessions.conversationId,
      notebookId: conversations.spaceId,
    })
    .from(lessonSessions)
    .leftJoin(
      conversations,
      eq(conversations.id, lessonSessions.conversationId),
    )
    .where(
      and(
        eq(lessonSessions.id, input.sessionId),
        eq(lessonSessions.studentId, input.trustedStudentId),
        eq(lessonSessions.status, 'active'),
      ),
    )
    .limit(1);
  if (!session) throw new LearningSessionOwnershipError();

  let gatewayOperationStatus: string | null = null;
  if (input.turnId !== undefined) {
    if (!session.conversationId || !session.notebookId) {
      throw new LearningSessionOwnershipError();
    }
    const conversationId = session.conversationId;
    const notebookId = session.notebookId;
    const [operation] = await transaction
      .select({
        id: agentOperations.id,
        gatewayEnvelopeId: agentOperations.gatewayEnvelopeId,
        idempotencyKey: agentOperations.idempotencyKey,
        status: agentOperations.status,
      })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, input.turnId),
          eq(agentOperations.actorUserId, input.trustedStudentId),
          eq(agentOperations.notebookId, notebookId),
          eq(agentOperations.conversationId, conversationId),
          eq(agentOperations.traceId, input.traceId),
          eq(agentOperations.kind, 'turn'),
        ),
      )
      .limit(1);
    if (
      !operation ||
      operation.gatewayEnvelopeId === null ||
      operation.idempotencyKey !== input.clientMessageId
    ) {
      throw new LearningSessionOwnershipError();
    }
    gatewayOperationStatus = operation.status;
  }

  const [existingStudent] = await transaction
    .select({
      turnId: chatMessages.turnId,
      requestHash: chatMessages.requestHash,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, input.sessionId),
        eq(chatMessages.role, 'student'),
        eq(chatMessages.clientMessageId, input.clientMessageId),
      ),
    )
    .limit(1);
  if (existingStudent) {
    if (
      existingStudent.requestHash !== prepared.requestHash ||
      (input.turnId !== undefined && existingStudent.turnId !== input.turnId)
    ) {
      throw new ChatMessageIdConflictError(input.clientMessageId);
    }
    return { turnId: existingStudent.turnId, replayed: true };
  }

  if (input.turnId !== undefined && gatewayOperationStatus !== 'running') {
    throw new ChatLifecycleError(
      '只有运行中的 Gateway operation 可以创建教学消息',
    );
  }

  const [activeAssistant] = await transaction
    .select({ turnId: chatMessages.turnId })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, input.sessionId),
        eq(chatMessages.role, 'assistant'),
        inArray(chatMessages.status, ['pending', 'streaming']),
      ),
    )
    .limit(1);
  if (activeAssistant) throw new TurnInProgressError(activeAssistant.turnId);

  await assertOwnedReadyAssetParts(transaction, {
    ownerSubjectId: input.trustedStudentId,
    spaceId: session.notebookId ?? input.sessionId,
    parts: prepared.parts,
  });

  const windowStart = new Date(now.getTime() - prepared.rateLimit.windowMs);
  const recentTurns = await transaction
    .select({ createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, input.sessionId),
        eq(chatMessages.role, 'student'),
        gte(chatMessages.createdAt, windowStart),
      ),
    )
    .orderBy(asc(chatMessages.createdAt))
    .limit(prepared.rateLimit.maxTurns);
  if (recentTurns.length >= prepared.rateLimit.maxTurns) {
    const oldest = recentTurns[0];
    const retryAfterMs = oldest
      ? Math.max(
          1,
          oldest.createdAt.getTime() +
            prepared.rateLimit.windowMs -
            now.getTime(),
        )
      : prepared.rateLimit.windowMs;
    throw new TurnRateLimitError(retryAfterMs);
  }

  const turnId = input.turnId ?? randomUUID();
  const leaseId = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + prepared.leaseDurationMs);
  const insertedMessages = await transaction
    .insert(chatMessages)
    .values([
      {
        sessionId: input.sessionId,
        turnId,
        clientMessageId: input.clientMessageId,
        requestHash: prepared.requestHash,
        role: 'student',
        status: 'completed',
        content: prepared.content,
        createdAt: now,
        completedAt: now,
      },
      {
        sessionId: input.sessionId,
        turnId,
        role: 'assistant',
        status: 'pending',
        content: '',
        leaseId,
        leaseExpiresAt,
        heartbeatAt: now,
        createdAt: now,
      },
    ])
    .returning();
  const student = insertedMessages.find(
    (message) => message.role === 'student',
  );
  if (
    !student ||
    !insertedMessages.some((message) => message.role === 'assistant')
  ) {
    throw new TurnLedgerInvariantError('学生或老师消息写入失败');
  }
  await insertMessageParts(transaction, student.id, prepared.parts);
  await transaction
    .update(lessonSessions)
    .set({
      title: sql`coalesce(${lessonSessions.title}, ${makeTitle(session.courseSlug, prepared.content || '附件消息')})`,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(eq(lessonSessions.id, input.sessionId));
  return { turnId, replayed: false };
}

/** 在一个短事务内写入学生消息、pending 老师消息和 pending answer run。 */
export class DrizzleTeachingTurnLedger {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async beginOrReplay(
    input: BeginTeachingTurnInput,
  ): Promise<TeachingTurnLedgerSnapshot> {
    const prepared = validateInput(input);
    const now = input.now ?? new Date();
    const lockKey = teachingTurnSessionLockKey(input.sessionId);
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const begun = await beginTeachingMessages(
        transaction,
        input,
        prepared,
        now,
      );
      if (!begun.replayed) {
        const snapshot = await loadApplicationSnapshot(
          transaction,
          input.sessionId,
          begun.turnId,
          false,
        );
        await transaction.insert(modelRuns).values({
          sessionId: input.sessionId,
          operationId: begun.turnId,
          operationKind: 'teaching_turn',
          assistantMessageId: snapshot.turn.assistantMessage.id,
          turnId: begun.turnId,
          phase: 'answer',
          attempt: 1,
          traceId: input.traceId,
          taskAlias: 'teaching.turn',
          modelAlias: input.modelAlias,
          promptVersion: input.promptVersion,
          promptHash: input.promptHash.toLowerCase(),
          provider: input.provider ?? null,
          status: 'pending',
          createdAt: now,
        });
        if (prepared.contextSnapshot) {
          await transaction.insert(turnContextSnapshots).values({
            sessionId: input.sessionId,
            turnId: begun.turnId,
            builderVersion: prepared.contextSnapshot.builderVersion,
            includedMessageIds: prepared.contextSnapshot.includedMessageIds,
            selectedAssetVersionIds:
              prepared.contextSnapshot.selectedAssetVersionIds,
            omittedMessageCount: prepared.contextSnapshot.omittedMessageCount,
            characterCount: prepared.contextSnapshot.characterCount,
            contextHash: prepared.contextSnapshot.contextHash,
            createdAt: now,
          });
        }
      }
      return loadLedgerSnapshot(
        transaction,
        input.sessionId,
        begun.turnId,
        begun.replayed,
      );
    });
  }

  /**
   * Gateway 已建立唯一 Operation 后，仅附着教学 UI 所需的消息与租约。
   * 通用 Context/Model/Tool/Effect 审计由 Turn Application 写入，禁止在这里复制。
   */
  async beginApplicationTurn(
    input: BeginTeachingApplicationTurnInput,
  ): Promise<TeachingApplicationTurnLedgerSnapshot> {
    const prepared = validateMessageInput(input);
    const now = input.now ?? new Date();
    const lockKey = teachingTurnSessionLockKey(input.sessionId);
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const begun = await beginTeachingMessages(
        transaction,
        input,
        prepared,
        now,
      );
      return loadApplicationSnapshot(
        transaction,
        input.sessionId,
        begun.turnId,
        begun.replayed,
      );
    });
  }
}
