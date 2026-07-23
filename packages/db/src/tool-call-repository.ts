import { createHash } from 'node:crypto';
import {
  teachingStateSchema,
  type TeachingState,
} from '@educanvas/teaching-core';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import { LearningSessionOwnershipError } from './chat-repository';
import { lessonSessions, modelRuns, toolCalls } from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

export type ToolCallStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'outcome_unknown';
export type ToolCallTerminalStatus = Extract<
  ToolCallStatus,
  'succeeded' | 'rejected' | 'failed' | 'outcome_unknown'
>;
export type ToolExposure = 'model' | 'runtime';
export type ToolEffect = 'read' | 'write';

export interface RedactedValueSummary {
  schemaVersion: '1';
  kind:
    'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'undefined';
  byteLength: number;
  itemCount: number | null;
  sha256: string;
}

export interface ToolCallSnapshot {
  id: string;
  sessionId: string;
  turnId: string;
  answerModelRunId: string;
  providerToolCallId: string;
  executionId: string;
  traceId: string;
  toolName: string | null;
  teachingState: TeachingState;
  exposure: ToolExposure | null;
  effect: ToolEffect | null;
  argumentSummary: RedactedValueSummary;
  resultSummary: RedactedValueSummary | null;
  status: ToolCallStatus;
  code: string | null;
  retryable: boolean;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateToolCallInput {
  trustedStudentId: string;
  answerModelRunId: string;
  providerToolCallId: string;
  executionId: string;
  toolName: string | null;
  teachingState: TeachingState;
  exposure: ToolExposure | null;
  effect: ToolEffect | null;
  arguments: unknown;
  now?: Date;
}

export class ToolCallConflictError extends Error {
  readonly code = 'tool_call_conflict';

  constructor() {
    super('executionId或Provider tool call ID已绑定不同执行');
    this.name = 'ToolCallConflictError';
  }
}

export class ToolCallLifecycleError extends Error {
  readonly code = 'invalid_tool_call_transition';

  constructor(message: string) {
    super(message);
    this.name = 'ToolCallLifecycleError';
  }
}

export const MAX_TOOL_AUDIT_VALUE_BYTES = 1_000_000;

function canonicalize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : '"[non-finite]"';
  }
  if (typeof value === 'undefined') return '"[undefined]"';
  if (typeof value !== 'object') return `"[${typeof value}]"`;
  if (seen.has(value)) {
    throw new ToolCallLifecycleError('工具摘要不接受循环引用');
  }
  seen.add(value);
  const result = Array.isArray(value)
    ? `[${value.map((item) => canonicalize(item, seen)).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key], seen)}`,
        )
        .join(',')}}`;
  seen.delete(value);
  return result;
}

function valueKind(value: unknown): RedactedValueSummary['kind'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'undefined') return 'undefined';
  return 'undefined';
}

/** 摘要只保留类型、体积、元素数和不可逆digest，不保存键名或值。 */
export function summarizeRedactedValue(value: unknown): RedactedValueSummary {
  const canonical = canonicalize(value);
  const kind = valueKind(value);
  const byteLength = Buffer.byteLength(canonical, 'utf8');
  if (byteLength > MAX_TOOL_AUDIT_VALUE_BYTES) {
    throw new ToolCallLifecycleError('工具参数/结果超过审计摘要上限');
  }
  return {
    schemaVersion: '1',
    kind,
    byteLength,
    itemCount:
      kind === 'array'
        ? (value as readonly unknown[]).length
        : kind === 'object'
          ? Object.keys(value as object).length
          : null,
    sha256: createHash('sha256').update(canonical, 'utf8').digest('hex'),
  };
}

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function toSnapshot(row: typeof toolCalls.$inferSelect): ToolCallSnapshot {
  if (!row.sessionId || !row.turnId || !row.teachingState) {
    throw new ToolCallLifecycleError('Tool Call不是有效teaching_turn形状');
  }
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    answerModelRunId: row.answerModelRunId,
    providerToolCallId: row.providerToolCallId,
    executionId: row.executionId,
    traceId: row.traceId,
    toolName: row.toolName,
    teachingState: teachingStateSchema.parse(row.teachingState),
    exposure: row.exposure as ToolExposure | null,
    effect: row.effect as ToolEffect | null,
    argumentSummary: row.argumentSummary as unknown as RedactedValueSummary,
    resultSummary:
      row.resultSummary === null
        ? null
        : (row.resultSummary as unknown as RedactedValueSummary),
    status: row.status as ToolCallStatus,
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
  teachingState: TeachingState;
  exposure: ToolExposure | null;
  effect: ToolEffect | null;
  argumentSummary: RedactedValueSummary;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.answerModelRunId,
        input.providerToolCallId,
        input.executionId,
        input.toolName,
        input.teachingState,
        input.exposure,
        input.effect,
        input.argumentSummary.sha256,
      ]),
      'utf8',
    )
    .digest('hex');
}

async function requireOwnedToolCall(
  executor: DatabaseExecutor,
  input: {
    toolCallId: string;
    trustedStudentId: string;
  },
) {
  const [row] = await executor
    .select({ call: toolCalls })
    .from(toolCalls)
    .innerJoin(lessonSessions, eq(lessonSessions.id, toolCalls.sessionId))
    .where(
      and(
        eq(toolCalls.id, input.toolCallId),
        eq(lessonSessions.studentId, input.trustedStudentId),
      ),
    )
    .limit(1);
  if (!row) throw new LearningSessionOwnershipError();
  return row.call;
}

/** 工具执行持久幂等与脱敏审计仓储。 */
export class DrizzleToolCallRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createOrGet(
    input: CreateToolCallInput,
  ): Promise<{ call: ToolCallSnapshot; replayed: boolean }> {
    if (
      !isSafeId(input.providerToolCallId) ||
      !isSafeId(input.executionId) ||
      (input.toolName !== null &&
        !/^[a-z][A-Za-z0-9]{0,63}$/.test(input.toolName))
    ) {
      throw new ToolCallLifecycleError('工具调用ID或名称格式无效');
    }
    const parsedState = teachingStateSchema.safeParse(input.teachingState);
    if (!parsedState.success) {
      throw new ToolCallLifecycleError('教学状态无效');
    }
    if (
      (input.exposure !== null &&
        !['model', 'runtime'].includes(input.exposure)) ||
      (input.effect !== null && !['read', 'write'].includes(input.effect))
    ) {
      throw new ToolCallLifecycleError('工具 exposure/effect 无效');
    }
    const teachingState = parsedState.data;
    const argumentSummary = summarizeRedactedValue(input.arguments);
    const immutableHash = requestHash({
      ...input,
      teachingState,
      argumentSummary,
    });
    const lockKeys = [
      `tool-execution-v1:${input.executionId}`,
      `tool-provider-v1:${input.answerModelRunId}:${input.providerToolCallId}`,
    ].sort();
    return this.database.transaction(async (transaction) => {
      for (const lockKey of lockKeys) {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
        );
      }
      const [answerRun] = await transaction
        .select({
          run: modelRuns,
          studentId: lessonSessions.studentId,
        })
        .from(modelRuns)
        .innerJoin(lessonSessions, eq(lessonSessions.id, modelRuns.sessionId))
        .where(eq(modelRuns.id, input.answerModelRunId))
        .limit(1);
      if (!answerRun || answerRun.studentId !== input.trustedStudentId) {
        throw new LearningSessionOwnershipError();
      }
      if (
        answerRun.run.operationKind !== 'teaching_turn' ||
        answerRun.run.phase !== 'answer' ||
        !answerRun.run.sessionId ||
        !answerRun.run.turnId
      ) {
        throw new ToolCallLifecycleError(
          '工具调用必须关联 teaching_turn answer model run',
        );
      }
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
            row.executionId === input.executionId &&
            row.answerModelRunId === input.answerModelRunId &&
            row.providerToolCallId === input.providerToolCallId,
        );
        if (!matching || matching.requestHash !== immutableHash) {
          throw new ToolCallConflictError();
        }
        return { call: toSnapshot(matching), replayed: true };
      }
      const [created] = await transaction
        .insert(toolCalls)
        .values({
          sessionId: answerRun.run.sessionId,
          turnId: answerRun.run.turnId,
          answerModelRunId: answerRun.run.id,
          providerToolCallId: input.providerToolCallId,
          executionId: input.executionId,
          requestHash: immutableHash,
          traceId: answerRun.run.traceId,
          toolName: input.toolName,
          teachingState,
          exposure: input.exposure,
          effect: input.effect,
          argumentSummary,
          createdAt: input.now ?? new Date(),
        })
        .returning();
      if (!created) throw new Error('工具调用审计写入失败');
      return { call: toSnapshot(created), replayed: false };
    });
  }

  async markRunning(input: {
    trustedStudentId: string;
    toolCallId: string;
    now?: Date;
  }): Promise<{ call: ToolCallSnapshot; transitioned: boolean }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const call = await requireOwnedToolCall(transaction, input);
      const [updated] = await transaction
        .update(toolCalls)
        .set({ status: 'running', startedAt: now })
        .where(and(eq(toolCalls.id, call.id), eq(toolCalls.status, 'pending')))
        .returning();
      if (updated) return { call: toSnapshot(updated), transitioned: true };
      const current = await requireOwnedToolCall(transaction, input);
      return { call: toSnapshot(current), transitioned: false };
    });
  }

  async settle(input: {
    trustedStudentId: string;
    toolCallId: string;
    status: ToolCallTerminalStatus;
    code?: string | null;
    retryable?: boolean;
    durationMs: number;
    result?: unknown;
    now?: Date;
  }): Promise<{ call: ToolCallSnapshot; transitioned: boolean }> {
    if (
      !Number.isInteger(input.durationMs) ||
      input.durationMs < 0 ||
      input.durationMs > 24 * 60 * 60_000
    ) {
      throw new ToolCallLifecycleError('durationMs 无效');
    }
    if (input.status !== 'succeeded' && !isSafeId(input.code ?? '')) {
      throw new ToolCallLifecycleError('非成功工具终态必须包含稳定 code');
    }
    if (input.status === 'succeeded' && input.code) {
      throw new ToolCallLifecycleError('成功工具调用不能包含错误 code');
    }
    const resultSummary =
      input.status === 'succeeded'
        ? summarizeRedactedValue(input.result)
        : null;
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const call = await requireOwnedToolCall(transaction, input);
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
            eq(toolCalls.id, call.id),
            inArray(toolCalls.status, sourceStatuses),
          ),
        )
        .returning();
      if (updated) return { call: toSnapshot(updated), transitioned: true };
      const current = await requireOwnedToolCall(transaction, input);
      return { call: toSnapshot(current), transitioned: false };
    });
  }

  async listByTurn(input: {
    trustedStudentId: string;
    turnId: string;
  }): Promise<readonly ToolCallSnapshot[]> {
    const rows = await this.database
      .select({ call: toolCalls })
      .from(toolCalls)
      .innerJoin(lessonSessions, eq(lessonSessions.id, toolCalls.sessionId))
      .where(
        and(
          eq(toolCalls.turnId, input.turnId),
          eq(lessonSessions.studentId, input.trustedStudentId),
        ),
      )
      .orderBy(asc(toolCalls.createdAt), asc(toolCalls.id));
    return rows.map((row) => toSnapshot(row.call));
  }
}
