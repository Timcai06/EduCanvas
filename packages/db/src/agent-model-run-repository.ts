import type {
  AgentModelRunLedgerPort,
  AgentModelRunProviderResult,
  AgentModelRunSnapshot,
  AgentModelRunStatus,
  AgentModelRunTerminalStatus,
  CreateAgentModelRunInput,
  ModelAlias,
  TurnModelPhase,
} from '@educanvas/agent-core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from './client';
import { agentOperations, conversationMessages, modelRuns } from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

type ConcreteCreateInput = CreateAgentModelRunInput & { now?: Date };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AgentModelRunOwnershipError extends Error {
  readonly code = 'agent_model_run_not_found';

  constructor() {
    super('Model Run不存在或不属于当前Actor');
    this.name = 'AgentModelRunOwnershipError';
  }
}

export class AgentModelRunConflictError extends Error {
  readonly code = 'agent_model_run_conflict';

  constructor() {
    super('该operation/phase/attempt已绑定不同的Model Run');
    this.name = 'AgentModelRunConflictError';
  }
}

export class AgentModelRunLifecycleError extends Error {
  readonly code = 'invalid_agent_model_run_transition';

  constructor(message: string) {
    super(message);
    this.name = 'AgentModelRunLifecycleError';
  }
}

function toSnapshot(row: typeof modelRuns.$inferSelect): AgentModelRunSnapshot {
  if (
    row.operationKind !== 'agent_turn' ||
    !row.agentOperationId ||
    !row.conversationMessageId
  ) {
    throw new AgentModelRunLifecycleError('Model Run不是有效agent_turn形状');
  }
  return {
    id: row.id,
    operationId: row.agentOperationId,
    assistantMessageId: row.conversationMessageId,
    phase: row.phase as TurnModelPhase,
    attempt: row.attempt,
    traceId: row.traceId,
    taskAlias: 'agent.turn',
    modelAlias: row.modelAlias as ModelAlias,
    promptVersion: row.promptVersion,
    promptHash: row.promptHash,
    provider: row.provider,
    providerModelId: row.providerModelId,
    modelRevision: row.modelRevision,
    providerResponseId: row.providerResponseId,
    systemFingerprint: row.systemFingerprint,
    finishReason: row.finishReason as AgentModelRunSnapshot['finishReason'],
    status: row.status as AgentModelRunStatus,
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

function validateCreateInput(input: ConcreteCreateInput): number {
  const attempt = input.attempt ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 100) {
    throw new AgentModelRunLifecycleError('attempt必须是1到100的整数');
  }
  if (
    !UUID_PATTERN.test(input.operationId) ||
    !UUID_PATTERN.test(input.assistantMessageId) ||
    input.actorId.length < 1 ||
    input.actorId.length > 160 ||
    !['answer', 'synthesis'].includes(input.phase) ||
    !['primary', 'fast', 'structured', 'speech'].includes(input.modelAlias) ||
    input.promptVersion.length < 1 ||
    input.promptVersion.length > 128 ||
    !/^[a-f0-9]{64}$/.test(input.promptHash) ||
    (input.provider !== undefined &&
      input.provider !== null &&
      (input.provider.length < 1 || input.provider.length > 128))
  ) {
    throw new AgentModelRunLifecycleError('Model Run创建参数无效');
  }
  return attempt;
}

function immutableFieldsMatch(
  row: typeof modelRuns.$inferSelect,
  input: ConcreteCreateInput,
  attempt: number,
  traceId: string,
): boolean {
  return (
    row.operationKind === 'agent_turn' &&
    row.agentOperationId === input.operationId &&
    row.operationId === input.operationId &&
    row.conversationMessageId === input.assistantMessageId &&
    row.phase === input.phase &&
    row.attempt === attempt &&
    row.traceId === traceId &&
    row.taskAlias === 'agent.turn' &&
    row.modelAlias === input.modelAlias &&
    row.promptVersion === input.promptVersion &&
    row.promptHash === input.promptHash &&
    row.provider === (input.provider ?? null)
  );
}

async function requireOwnedRun(
  executor: DatabaseExecutor,
  input: { operationId: string; actorId: string; runId: string },
) {
  if (
    !UUID_PATTERN.test(input.operationId) ||
    !UUID_PATTERN.test(input.runId) ||
    input.actorId.length < 1 ||
    input.actorId.length > 160
  ) {
    throw new AgentModelRunOwnershipError();
  }
  const [row] = await executor
    .select({ run: modelRuns, operation: agentOperations })
    .from(modelRuns)
    .innerJoin(
      agentOperations,
      eq(agentOperations.id, modelRuns.agentOperationId),
    )
    .where(
      and(
        eq(modelRuns.id, input.runId),
        eq(modelRuns.operationKind, 'agent_turn'),
        eq(modelRuns.agentOperationId, input.operationId),
        eq(agentOperations.actorUserId, input.actorId),
      ),
    )
    .limit(1);
  if (!row) throw new AgentModelRunOwnershipError();
  return row;
}

function validateProviderResult(result?: AgentModelRunProviderResult): void {
  if (!result) return;
  const bounded = [
    [result.provider, 128],
    [result.providerModelId, 256],
    [result.modelRevision, 256],
    [result.providerResponseId, 512],
    [result.systemFingerprint, 512],
  ] as const;
  if (
    bounded.some(
      ([value, max]) =>
        value !== undefined &&
        value !== null &&
        (value.length < 1 || value.length > max),
    ) ||
    (result.latencyMs !== undefined &&
      result.latencyMs !== null &&
      (!Number.isInteger(result.latencyMs) || result.latencyMs < 0)) ||
    (result.finishReason !== undefined &&
      result.finishReason !== null &&
      ![
        'stop',
        'tool_calls',
        'length',
        'content_filter',
        'cancelled',
        'error',
        'other',
      ].includes(result.finishReason)) ||
    (result.usage !== undefined &&
      Object.values(result.usage).some(
        (value) => !Number.isInteger(value) || value < 0,
      ))
  ) {
    throw new AgentModelRunLifecycleError('Provider审计结果无效');
  }
}

/** PostgreSQL统一Model Run账本；只接受Gateway解析后的Actor/Operation归属。 */
export class DrizzleAgentModelRunRepository implements AgentModelRunLedgerPort {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createOrGet(
    input: ConcreteCreateInput,
  ): Promise<{ run: AgentModelRunSnapshot; replayed: boolean }> {
    const attempt = validateCreateInput(input);
    const lockKey = [
      'model-run-v2',
      input.operationId,
      input.phase,
      attempt,
    ].join(':');
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const [scope] = await transaction
        .select({ operation: agentOperations, message: conversationMessages })
        .from(agentOperations)
        .innerJoin(
          conversationMessages,
          and(
            eq(conversationMessages.id, input.assistantMessageId),
            eq(conversationMessages.operationId, agentOperations.id),
            eq(
              conversationMessages.conversationId,
              agentOperations.conversationId,
            ),
          ),
        )
        .where(
          and(
            eq(agentOperations.id, input.operationId),
            eq(agentOperations.actorUserId, input.actorId),
            eq(agentOperations.kind, 'turn'),
            eq(conversationMessages.role, 'assistant'),
          ),
        )
        .limit(1);
      if (!scope) throw new AgentModelRunOwnershipError();

      const [existing] = await transaction
        .select()
        .from(modelRuns)
        .where(
          and(
            eq(modelRuns.operationKind, 'agent_turn'),
            eq(modelRuns.operationId, input.operationId),
            eq(modelRuns.phase, input.phase),
            eq(modelRuns.attempt, attempt),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          !immutableFieldsMatch(
            existing,
            input,
            attempt,
            scope.operation.traceId,
          )
        ) {
          throw new AgentModelRunConflictError();
        }
        return { run: toSnapshot(existing), replayed: true };
      }
      if (
        !['pending', 'running'].includes(scope.operation.status) ||
        !['pending', 'streaming'].includes(scope.message.status)
      ) {
        throw new AgentModelRunLifecycleError(
          'Operation或assistant消息已进入终态，不能创建Model Run',
        );
      }
      const [created] = await transaction
        .insert(modelRuns)
        .values({
          operationId: input.operationId,
          operationKind: 'agent_turn',
          agentOperationId: input.operationId,
          conversationMessageId: input.assistantMessageId,
          phase: input.phase,
          attempt,
          traceId: scope.operation.traceId,
          taskAlias: 'agent.turn',
          modelAlias: input.modelAlias,
          promptVersion: input.promptVersion,
          promptHash: input.promptHash,
          provider: input.provider ?? null,
          createdAt: input.now ?? new Date(),
        })
        .returning();
      if (!created) throw new Error('Model Run记录写入失败');
      return { run: toSnapshot(created), replayed: false };
    });
  }

  async markRunning(input: {
    operationId: string;
    actorId: string;
    runId: string;
    now?: Date;
  }): Promise<{ run: AgentModelRunSnapshot; transitioned: boolean }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const owned = await requireOwnedRun(transaction, input);
      const [updated] = await transaction
        .update(modelRuns)
        .set({ status: 'running', startedAt: now })
        .where(
          and(eq(modelRuns.id, owned.run.id), eq(modelRuns.status, 'pending')),
        )
        .returning();
      if (updated) return { run: toSnapshot(updated), transitioned: true };
      const current = await requireOwnedRun(transaction, input);
      return { run: toSnapshot(current.run), transitioned: false };
    });
  }

  async settle(input: {
    operationId: string;
    actorId: string;
    runId: string;
    status: AgentModelRunTerminalStatus;
    errorCode?: string | null;
    providerResult?: AgentModelRunProviderResult;
    now?: Date;
  }): Promise<{ run: AgentModelRunSnapshot; transitioned: boolean }> {
    validateProviderResult(input.providerResult);
    if (
      input.status !== 'succeeded' &&
      !/^[a-z][a-z0-9._:-]{0,127}$/.test(input.errorCode ?? '')
    ) {
      throw new AgentModelRunLifecycleError(
        '失败Model Run必须包含稳定errorCode',
      );
    }
    if (input.status === 'succeeded' && input.errorCode) {
      throw new AgentModelRunLifecycleError('成功Model Run不能包含errorCode');
    }
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const owned = await requireOwnedRun(transaction, input);
      if (
        input.status === 'cancelled' &&
        owned.operation.cancelRequestedAt === null
      ) {
        throw new AgentModelRunLifecycleError(
          'Provider aborted只能在服务端已记录显式取消时收敛为cancelled',
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
          provider: provider?.provider ?? owned.run.provider,
          providerModelId:
            provider?.providerModelId ?? owned.run.providerModelId,
          modelRevision: provider?.modelRevision ?? owned.run.modelRevision,
          providerResponseId:
            provider?.providerResponseId ?? owned.run.providerResponseId,
          systemFingerprint:
            provider?.systemFingerprint ?? owned.run.systemFingerprint,
          finishReason: provider?.finishReason ?? owned.run.finishReason,
          inputTokens: provider?.usage?.inputTokens ?? owned.run.inputTokens,
          outputTokens: provider?.usage?.outputTokens ?? owned.run.outputTokens,
          cacheHitTokens:
            provider?.usage?.cacheHitTokens ?? owned.run.cacheHitTokens,
          reasoningTokens:
            provider?.usage?.reasoningTokens ?? owned.run.reasoningTokens,
          latencyMs: provider?.latencyMs ?? owned.run.latencyMs,
          completedAt: now,
        })
        .where(
          and(
            eq(modelRuns.id, owned.run.id),
            inArray(modelRuns.status, sourceStatuses),
          ),
        )
        .returning();
      if (updated) return { run: toSnapshot(updated), transitioned: true };
      const current = await requireOwnedRun(transaction, input);
      return { run: toSnapshot(current.run), transitioned: false };
    });
  }

  async listByOperation(input: {
    operationId: string;
    actorId: string;
  }): Promise<readonly AgentModelRunSnapshot[]> {
    if (
      !UUID_PATTERN.test(input.operationId) ||
      input.actorId.length < 1 ||
      input.actorId.length > 160
    ) {
      throw new AgentModelRunOwnershipError();
    }
    const [owned] = await this.database
      .select({ id: agentOperations.id })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, input.operationId),
          eq(agentOperations.actorUserId, input.actorId),
        ),
      )
      .limit(1);
    if (!owned) throw new AgentModelRunOwnershipError();
    const rows = await this.database
      .select()
      .from(modelRuns)
      .where(
        and(
          eq(modelRuns.operationKind, 'agent_turn'),
          eq(modelRuns.agentOperationId, input.operationId),
        ),
      )
      .orderBy(asc(modelRuns.createdAt), asc(modelRuns.id));
    return rows.map(toSnapshot);
  }
}
