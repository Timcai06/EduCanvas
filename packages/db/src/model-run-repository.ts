import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  LearningSessionOwnershipError,
  type ChatMessageStatus,
} from './chat-repository';
import { chatMessages, lessonSessions, modelRuns } from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

export type TeachingModelRunPhase = 'answer' | 'synthesis';
export type ModelRunStatus =
  'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type ModelRunTerminalStatus = Extract<
  ModelRunStatus,
  'succeeded' | 'failed' | 'cancelled' | 'interrupted'
>;

export interface ModelRunUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheHitTokens?: number | null;
  reasoningTokens?: number | null;
}

export interface ModelRunProviderResult {
  provider?: string | null;
  providerModelId?: string | null;
  modelRevision?: string | null;
  providerResponseId?: string | null;
  systemFingerprint?: string | null;
  finishReason?: string | null;
  latencyMs?: number | null;
  usage?: ModelRunUsage;
}

export interface ModelRunSnapshot {
  id: string;
  sessionId: string;
  operationId: string;
  operationKind: 'teaching_turn';
  assistantMessageId: string;
  turnId: string;
  phase: TeachingModelRunPhase;
  attempt: number;
  traceId: string;
  taskAlias: 'teaching.turn';
  modelAlias: string;
  promptVersion: string;
  promptHash: string;
  provider: string | null;
  providerModelId: string | null;
  modelRevision: string | null;
  providerResponseId: string | null;
  systemFingerprint: string | null;
  finishReason: string | null;
  status: ModelRunStatus;
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheHitTokens: number | null;
  reasoningTokens: number | null;
  latencyMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateTeachingModelRunInput {
  sessionId: string;
  trustedStudentId: string;
  operationId: string;
  assistantMessageId: string;
  turnId: string;
  phase: TeachingModelRunPhase;
  attempt?: number;
  traceId: string;
  taskAlias: 'teaching.turn';
  modelAlias: string;
  promptVersion: string;
  promptHash: string;
  provider?: string | null;
}

export class ModelRunConflictError extends Error {
  readonly code = 'model_run_conflict';

  constructor() {
    super('该 operation/phase/attempt 已绑定不同的模型运行');
    this.name = 'ModelRunConflictError';
  }
}

export class ModelRunLifecycleError extends Error {
  readonly code = 'invalid_model_run_transition';

  constructor(message: string) {
    super(message);
    this.name = 'ModelRunLifecycleError';
  }
}

function toSnapshot(row: typeof modelRuns.$inferSelect): ModelRunSnapshot {
  return {
    id: row.id,
    sessionId: row.sessionId as string,
    operationId: row.operationId,
    operationKind: row.operationKind as 'teaching_turn',
    assistantMessageId: row.assistantMessageId as string,
    turnId: row.turnId as string,
    phase: row.phase as TeachingModelRunPhase,
    attempt: row.attempt,
    traceId: row.traceId,
    taskAlias: row.taskAlias as 'teaching.turn',
    modelAlias: row.modelAlias,
    promptVersion: row.promptVersion,
    promptHash: row.promptHash,
    provider: row.provider,
    providerModelId: row.providerModelId,
    modelRevision: row.modelRevision,
    providerResponseId: row.providerResponseId,
    systemFingerprint: row.systemFingerprint,
    finishReason: row.finishReason,
    status: row.status as ModelRunStatus,
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

async function requireOwnedAssistantMessage(
  executor: DatabaseExecutor,
  input: {
    sessionId: string;
    trustedStudentId: string;
    assistantMessageId: string;
    turnId?: string;
  },
) {
  const [row] = await executor
    .select({
      id: chatMessages.id,
      turnId: chatMessages.turnId,
      status: chatMessages.status,
      cancelRequestedAt: chatMessages.cancelRequestedAt,
    })
    .from(chatMessages)
    .innerJoin(lessonSessions, eq(lessonSessions.id, chatMessages.sessionId))
    .where(
      and(
        eq(chatMessages.id, input.assistantMessageId),
        eq(chatMessages.sessionId, input.sessionId),
        eq(chatMessages.role, 'assistant'),
        eq(lessonSessions.studentId, input.trustedStudentId),
        input.turnId ? eq(chatMessages.turnId, input.turnId) : undefined,
      ),
    )
    .limit(1);
  if (!row) throw new LearningSessionOwnershipError();
  return {
    ...row,
    status: row.status as ChatMessageStatus,
  };
}

function immutableRunFieldsMatch(
  row: typeof modelRuns.$inferSelect,
  input: CreateTeachingModelRunInput,
  attempt: number,
): boolean {
  return (
    row.sessionId === input.sessionId &&
    row.operationId === input.operationId &&
    row.operationKind === 'teaching_turn' &&
    row.assistantMessageId === input.assistantMessageId &&
    row.turnId === input.turnId &&
    row.phase === input.phase &&
    row.attempt === attempt &&
    row.traceId === input.traceId &&
    row.taskAlias === input.taskAlias &&
    row.modelAlias === input.modelAlias &&
    row.promptVersion === input.promptVersion &&
    row.promptHash === input.promptHash &&
    row.provider === (input.provider ?? null)
  );
}

/** Provider 运行审计仓储；该层不保存 Prompt 原文或供应商推理内容。 */
export class DrizzleModelRunRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createOrGetTeachingRun(
    input: CreateTeachingModelRunInput,
  ): Promise<{ run: ModelRunSnapshot; replayed: boolean }> {
    if (input.operationId !== input.turnId) {
      throw new ModelRunLifecycleError(
        'teaching_turn 的 operationId 必须等于 turnId',
      );
    }
    const attempt = input.attempt ?? 1;
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new ModelRunLifecycleError('attempt 必须是正整数');
    }
    const lockKey = [
      'model-run-v1',
      'teaching_turn',
      input.operationId,
      input.phase,
      attempt,
    ].join(':');
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const assistant = await requireOwnedAssistantMessage(transaction, {
        sessionId: input.sessionId,
        trustedStudentId: input.trustedStudentId,
        assistantMessageId: input.assistantMessageId,
        turnId: input.turnId,
      });
      const [existing] = await transaction
        .select()
        .from(modelRuns)
        .where(
          and(
            eq(modelRuns.operationKind, 'teaching_turn'),
            eq(modelRuns.operationId, input.operationId),
            eq(modelRuns.phase, input.phase),
            eq(modelRuns.attempt, attempt),
          ),
        )
        .limit(1);
      if (existing) {
        if (!immutableRunFieldsMatch(existing, input, attempt)) {
          throw new ModelRunConflictError();
        }
        return { run: toSnapshot(existing), replayed: true };
      }
      if (!['pending', 'streaming'].includes(assistant.status)) {
        throw new ModelRunLifecycleError(
          '老师消息已进入终态，不能再创建 model run',
        );
      }
      const [created] = await transaction
        .insert(modelRuns)
        .values({
          sessionId: input.sessionId,
          operationId: input.operationId,
          operationKind: 'teaching_turn',
          assistantMessageId: input.assistantMessageId,
          turnId: input.turnId,
          phase: input.phase,
          attempt,
          traceId: input.traceId,
          taskAlias: input.taskAlias,
          modelAlias: input.modelAlias,
          promptVersion: input.promptVersion,
          promptHash: input.promptHash,
          provider: input.provider ?? null,
        })
        .returning();
      if (!created) throw new Error('模型运行记录写入失败');
      return { run: toSnapshot(created), replayed: false };
    });
  }

  async markRunning(input: {
    sessionId: string;
    trustedStudentId: string;
    runId: string;
    now?: Date;
  }): Promise<{ run: ModelRunSnapshot; transitioned: boolean }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const run = await this.requireOwnedRun(transaction, input);
      if (!run.assistantMessageId || !run.turnId) {
        throw new ModelRunLifecycleError(
          'teaching_turn 缺少 assistantMessageId 或 turnId',
        );
      }
      const assistant = await requireOwnedAssistantMessage(transaction, {
        sessionId: input.sessionId,
        trustedStudentId: input.trustedStudentId,
        assistantMessageId: run.assistantMessageId,
        turnId: run.turnId,
      });
      if (!['pending', 'streaming'].includes(assistant.status)) {
        throw new ModelRunLifecycleError(
          '老师消息已进入终态，不能启动 model run',
        );
      }
      const [updated] = await transaction
        .update(modelRuns)
        .set({ status: 'running', startedAt: now })
        .where(and(eq(modelRuns.id, run.id), eq(modelRuns.status, 'pending')))
        .returning();
      if (updated) return { run: toSnapshot(updated), transitioned: true };
      const current = await this.requireOwnedRun(transaction, input);
      return { run: toSnapshot(current), transitioned: false };
    });
  }

  async settle(input: {
    sessionId: string;
    trustedStudentId: string;
    runId: string;
    status: ModelRunTerminalStatus;
    errorCode?: string | null;
    providerResult?: ModelRunProviderResult;
    now?: Date;
  }): Promise<{ run: ModelRunSnapshot; transitioned: boolean }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const run = await this.requireOwnedRun(transaction, input);
      if (!run.assistantMessageId || !run.turnId) {
        throw new ModelRunLifecycleError(
          'teaching_turn 缺少 assistantMessageId 或 turnId',
        );
      }
      const assistant = await requireOwnedAssistantMessage(transaction, {
        sessionId: input.sessionId,
        trustedStudentId: input.trustedStudentId,
        assistantMessageId: run.assistantMessageId,
        turnId: run.turnId,
      });
      if (input.status === 'cancelled' && !assistant.cancelRequestedAt) {
        throw new ModelRunLifecycleError(
          'Provider aborted 只能在服务端已记录显式取消时收敛为 cancelled',
        );
      }
      const sourceStatuses =
        input.status === 'succeeded'
          ? (['running'] as const)
          : (['pending', 'running'] as const);
      const provider = input.providerResult;
      const [updated] = await transaction
        .update(modelRuns)
        .set({
          status: input.status,
          errorCode:
            input.status === 'succeeded' ? null : (input.errorCode ?? null),
          provider: provider?.provider ?? run.provider,
          providerModelId: provider?.providerModelId ?? run.providerModelId,
          modelRevision: provider?.modelRevision ?? run.modelRevision,
          providerResponseId:
            provider?.providerResponseId ?? run.providerResponseId,
          systemFingerprint:
            provider?.systemFingerprint ?? run.systemFingerprint,
          finishReason: provider?.finishReason ?? run.finishReason,
          inputTokens: provider?.usage?.inputTokens ?? run.inputTokens,
          outputTokens: provider?.usage?.outputTokens ?? run.outputTokens,
          cacheHitTokens: provider?.usage?.cacheHitTokens ?? run.cacheHitTokens,
          reasoningTokens:
            provider?.usage?.reasoningTokens ?? run.reasoningTokens,
          latencyMs: provider?.latencyMs ?? run.latencyMs,
          completedAt: now,
        })
        .where(
          and(
            eq(modelRuns.id, run.id),
            inArray(modelRuns.status, sourceStatuses),
          ),
        )
        .returning();
      if (updated) return { run: toSnapshot(updated), transitioned: true };
      const current = await this.requireOwnedRun(transaction, input);
      return { run: toSnapshot(current), transitioned: false };
    });
  }

  async listByTurn(input: {
    sessionId: string;
    trustedStudentId: string;
    turnId: string;
  }): Promise<readonly ModelRunSnapshot[]> {
    const [owned] = await this.database
      .select({ id: lessonSessions.id })
      .from(lessonSessions)
      .where(
        and(
          eq(lessonSessions.id, input.sessionId),
          eq(lessonSessions.studentId, input.trustedStudentId),
        ),
      )
      .limit(1);
    if (!owned) throw new LearningSessionOwnershipError();
    const rows = await this.database
      .select()
      .from(modelRuns)
      .where(
        and(
          eq(modelRuns.sessionId, input.sessionId),
          eq(modelRuns.turnId, input.turnId),
        ),
      )
      .orderBy(asc(modelRuns.createdAt), asc(modelRuns.id));
    return rows.map(toSnapshot);
  }

  private async requireOwnedRun(
    executor: DatabaseExecutor,
    input: {
      sessionId: string;
      trustedStudentId: string;
      runId: string;
    },
  ) {
    const [row] = await executor
      .select({ run: modelRuns })
      .from(modelRuns)
      .innerJoin(lessonSessions, eq(lessonSessions.id, modelRuns.sessionId))
      .where(
        and(
          eq(modelRuns.id, input.runId),
          eq(modelRuns.sessionId, input.sessionId),
          eq(lessonSessions.studentId, input.trustedStudentId),
        ),
      )
      .limit(1);
    if (!row) throw new LearningSessionOwnershipError();
    return row.run;
  }
}
