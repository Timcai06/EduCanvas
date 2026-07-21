import { createHash } from 'node:crypto';
import type {
  AgentToolCallLedgerPort,
  AgentToolCallSnapshot,
  AgentToolCallStatus,
  AgentToolCallTerminalStatus,
  CreateAgentToolCallInput,
} from '@educanvas/agent-core';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { agentOperations, modelRuns, toolCalls } from './schema';
import {
  summarizeRedactedValue,
  type RedactedValueSummary,
} from './tool-call-repository';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;
type ConcreteCreateInput = CreateAgentToolCallInput & { now?: Date };

export class AgentToolCallOwnershipError extends Error {
  readonly code = 'agent_tool_call_not_found';

  constructor() {
    super('Tool Call不存在或不属于当前Actor');
    this.name = 'AgentToolCallOwnershipError';
  }
}

export class AgentToolCallConflictError extends Error {
  readonly code = 'agent_tool_call_conflict';

  constructor() {
    super('executionId或Provider tool call ID已绑定不同执行');
    this.name = 'AgentToolCallConflictError';
  }
}

export class AgentToolCallLifecycleError extends Error {
  readonly code = 'invalid_agent_tool_call_transition';

  constructor(message: string) {
    super(message);
    this.name = 'AgentToolCallLifecycleError';
  }
}

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function toSnapshot(row: typeof toolCalls.$inferSelect): AgentToolCallSnapshot {
  if (
    !row.agentOperationId ||
    row.sessionId ||
    row.turnId ||
    row.teachingState
  ) {
    throw new AgentToolCallLifecycleError('Tool Call不是有效agent_turn形状');
  }
  return {
    id: row.id,
    operationId: row.agentOperationId,
    answerModelRunId: row.answerModelRunId,
    providerToolCallId: row.providerToolCallId,
    executionId: row.executionId,
    traceId: row.traceId,
    toolName: row.toolName,
    exposure: row.exposure as AgentToolCallSnapshot['exposure'],
    effect: row.effect as AgentToolCallSnapshot['effect'],
    argumentSummary: row.argumentSummary as unknown as RedactedValueSummary,
    resultSummary:
      row.resultSummary === null
        ? null
        : (row.resultSummary as unknown as RedactedValueSummary),
    status: row.status as AgentToolCallStatus,
    code: row.code,
    retryable: row.retryable,
    durationMs: row.durationMs,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function requestHash(input: {
  answerModelRunId: string;
  providerToolCallId: string;
  executionId: string;
  toolName: string | null;
  exposure: CreateAgentToolCallInput['exposure'];
  effect: CreateAgentToolCallInput['effect'];
  argumentSummary: RedactedValueSummary;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.answerModelRunId,
        input.providerToolCallId,
        input.executionId,
        input.toolName,
        input.exposure,
        input.effect,
        input.argumentSummary.sha256,
      ]),
      'utf8',
    )
    .digest('hex');
}

function validateCreateInput(input: ConcreteCreateInput): void {
  if (
    !isUuid(input.operationId) ||
    !isUuid(input.answerModelRunId) ||
    input.actorId.length < 1 ||
    input.actorId.length > 160 ||
    !isSafeId(input.providerToolCallId) ||
    !isSafeId(input.executionId) ||
    (input.toolName !== null &&
      !/^[a-z][A-Za-z0-9_.-]{0,63}$/.test(input.toolName)) ||
    (input.exposure !== null &&
      !['model', 'runtime'].includes(input.exposure)) ||
    (input.effect !== null && !['read', 'write'].includes(input.effect))
  ) {
    throw new AgentToolCallLifecycleError('Tool Call创建参数无效');
  }
}

async function requireOwnedToolCall(
  executor: DatabaseExecutor,
  input: { operationId: string; actorId: string; toolCallId: string },
) {
  if (
    !isUuid(input.operationId) ||
    !isUuid(input.toolCallId) ||
    input.actorId.length < 1 ||
    input.actorId.length > 160
  ) {
    throw new AgentToolCallOwnershipError();
  }
  const [row] = await executor
    .select({ call: toolCalls, operation: agentOperations })
    .from(toolCalls)
    .innerJoin(
      agentOperations,
      eq(agentOperations.id, toolCalls.agentOperationId),
    )
    .where(
      and(
        eq(toolCalls.id, input.toolCallId),
        eq(toolCalls.agentOperationId, input.operationId),
        eq(agentOperations.actorUserId, input.actorId),
      ),
    )
    .limit(1);
  if (!row) throw new AgentToolCallOwnershipError();
  return row;
}

/** PostgreSQL统一Tool Call账本；只记录脱敏摘要，不把调用审计冒充副作用提交证据。 */
export class DrizzleAgentToolCallRepository implements AgentToolCallLedgerPort {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createOrGet(
    input: ConcreteCreateInput,
  ): Promise<{ call: AgentToolCallSnapshot; replayed: boolean }> {
    validateCreateInput(input);
    const argumentSummary = summarizeRedactedValue(input.arguments);
    const immutableHash = requestHash({ ...input, argumentSummary });
    const lockKeys = [
      `agent-tool-execution-v2:${input.executionId}`,
      `agent-tool-provider-v2:${input.answerModelRunId}:${input.providerToolCallId}`,
    ].sort();
    return this.database.transaction(async (transaction) => {
      for (const lockKey of lockKeys) {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
        );
      }
      const [scope] = await transaction
        .select({ run: modelRuns, operation: agentOperations })
        .from(modelRuns)
        .innerJoin(
          agentOperations,
          eq(agentOperations.id, modelRuns.agentOperationId),
        )
        .where(
          and(
            eq(modelRuns.id, input.answerModelRunId),
            eq(modelRuns.operationKind, 'agent_turn'),
            eq(modelRuns.agentOperationId, input.operationId),
            eq(modelRuns.phase, 'answer'),
            eq(agentOperations.id, input.operationId),
            eq(agentOperations.actorUserId, input.actorId),
            eq(agentOperations.kind, 'turn'),
          ),
        )
        .limit(1);
      if (!scope) throw new AgentToolCallOwnershipError();

      const existing = await transaction
        .select()
        .from(toolCalls)
        .where(
          or(
            eq(toolCalls.executionId, input.executionId),
            and(
              eq(toolCalls.answerModelRunId, input.answerModelRunId),
              eq(toolCalls.providerToolCallId, input.providerToolCallId),
            ),
          ),
        );
      if (existing.length > 0) {
        const matching = existing.find(
          (row) =>
            row.agentOperationId === input.operationId &&
            row.executionId === input.executionId &&
            row.answerModelRunId === input.answerModelRunId &&
            row.providerToolCallId === input.providerToolCallId,
        );
        if (!matching || matching.requestHash !== immutableHash) {
          throw new AgentToolCallConflictError();
        }
        return { call: toSnapshot(matching), replayed: true };
      }
      if (
        !['pending', 'running'].includes(scope.operation.status) ||
        !['pending', 'running', 'succeeded'].includes(scope.run.status)
      ) {
        throw new AgentToolCallLifecycleError(
          'Operation或answer Model Run已失败或进入不可执行终态',
        );
      }
      const [created] = await transaction
        .insert(toolCalls)
        .values({
          agentOperationId: input.operationId,
          answerModelRunId: input.answerModelRunId,
          providerToolCallId: input.providerToolCallId,
          executionId: input.executionId,
          requestHash: immutableHash,
          traceId: scope.operation.traceId,
          toolName: input.toolName,
          exposure: input.exposure,
          effect: input.effect,
          argumentSummary,
          createdAt: input.now ?? new Date(),
        })
        .returning();
      if (!created) throw new Error('Tool Call记录写入失败');
      return { call: toSnapshot(created), replayed: false };
    });
  }

  async markRunning(input: {
    operationId: string;
    actorId: string;
    toolCallId: string;
    now?: Date;
  }): Promise<{ call: AgentToolCallSnapshot; transitioned: boolean }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const owned = await requireOwnedToolCall(transaction, input);
      const [updated] = await transaction
        .update(toolCalls)
        .set({ status: 'running', startedAt: now })
        .where(
          and(eq(toolCalls.id, owned.call.id), eq(toolCalls.status, 'pending')),
        )
        .returning();
      if (updated) return { call: toSnapshot(updated), transitioned: true };
      const current = await requireOwnedToolCall(transaction, input);
      return { call: toSnapshot(current.call), transitioned: false };
    });
  }

  async settle(input: {
    operationId: string;
    actorId: string;
    toolCallId: string;
    status: AgentToolCallTerminalStatus;
    code?: string | null;
    retryable?: boolean;
    durationMs: number;
    result?: unknown;
    now?: Date;
  }): Promise<{ call: AgentToolCallSnapshot; transitioned: boolean }> {
    if (
      !Number.isInteger(input.durationMs) ||
      input.durationMs < 0 ||
      input.durationMs > 24 * 60 * 60_000
    ) {
      throw new AgentToolCallLifecycleError('durationMs无效');
    }
    if (input.status !== 'succeeded' && !isSafeId(input.code ?? '')) {
      throw new AgentToolCallLifecycleError(
        '非成功Tool Call终态必须包含稳定code',
      );
    }
    if (input.status === 'succeeded' && input.code) {
      throw new AgentToolCallLifecycleError('成功Tool Call不能包含错误code');
    }
    const resultSummary =
      input.status === 'succeeded'
        ? summarizeRedactedValue(input.result)
        : null;
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const owned = await requireOwnedToolCall(transaction, input);
      if (input.status === 'outcome_unknown' && owned.call.effect !== 'write') {
        throw new AgentToolCallLifecycleError(
          '只有write Tool Call可以进入outcome_unknown',
        );
      }
      const sourceStatuses =
        input.status === 'rejected'
          ? (['pending', 'running'] as const)
          : (['running'] as const);
      const [updated] = await transaction
        .update(toolCalls)
        .set({
          status: input.status,
          code: input.status === 'succeeded' ? null : input.code,
          retryable:
            input.status === 'succeeded' ? false : (input.retryable ?? false),
          durationMs: input.durationMs,
          resultSummary,
          completedAt: now,
        })
        .where(
          and(
            eq(toolCalls.id, owned.call.id),
            inArray(toolCalls.status, sourceStatuses),
          ),
        )
        .returning();
      if (updated) return { call: toSnapshot(updated), transitioned: true };
      const current = await requireOwnedToolCall(transaction, input);
      return { call: toSnapshot(current.call), transitioned: false };
    });
  }

  async listByOperation(input: {
    operationId: string;
    actorId: string;
  }): Promise<readonly AgentToolCallSnapshot[]> {
    if (
      !isUuid(input.operationId) ||
      input.actorId.length < 1 ||
      input.actorId.length > 160
    ) {
      throw new AgentToolCallOwnershipError();
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
    if (!owned) throw new AgentToolCallOwnershipError();
    const rows = await this.database
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.agentOperationId, input.operationId))
      .orderBy(asc(toolCalls.createdAt), asc(toolCalls.id));
    return rows.map(toSnapshot);
  }
}
