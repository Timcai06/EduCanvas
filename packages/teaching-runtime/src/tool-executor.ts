import {
  isToolAllowed,
  teachingTools,
  type TeachingState,
  type TeachingTool,
} from '@educanvas/teaching-core';
import { z } from 'zod';

/** 模型工具调用只允许携带工具名和JSON参数；身份、状态与追踪字段由runtime注入。 */
export const rawTeachingToolCallSchema = z
  .object({
    tool: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][A-Za-z0-9]*$/),
    arguments: z.json(),
  })
  .strict();

/** 尚未提升信任级别的模型工具调用。 */
export type RawTeachingToolCall = z.infer<typeof rawTeachingToolCallSchema>;

/** 工具是否可以暴露给模型，或只能由可信runtime直接调用。 */
export type ToolExposure = 'model' | 'runtime';

/** 工具的副作用等级决定超时后的重试与幂等责任。 */
export type ToolEffect = 'read' | 'write';

/** runtime从可信会话与请求边界注入的执行上下文。 */
export interface TrustedToolExecutionContext {
  traceId: string;
  turnId: string;
  executionId: string;
  studentId: string;
  sessionId: string;
  knowledgeNodeId: string | null;
  state: TeachingState;
  invoker: ToolExposure;
}

/** handler只能通过该上下文读取可信身份；signal用于向下游传播超时取消。 */
export interface TeachingToolHandlerContext extends TrustedToolExecutionContext {
  signal: AbortSignal;
}

/** executor对不可信输入和执行故障返回的稳定原因码。 */
export const toolExecutionRejectionCodes = [
  'INVALID_CALL',
  'UNKNOWN_TOOL',
  'TOOL_NOT_ALLOWED',
  'TOOL_NOT_AVAILABLE',
  'INVALID_ARGUMENTS',
  'IDEMPOTENCY_CONFLICT',
  'EXECUTION_CACHE_CAPACITY',
  'WRITE_BATCH_NOT_SUPPORTED',
  'TIMEOUT',
  'WRITE_TIMEOUT_OUTCOME_UNKNOWN',
  'HANDLER_ERROR',
  'INVALID_OUTPUT',
] as const;

export type ToolExecutionRejectionCode =
  (typeof toolExecutionRejectionCodes)[number];

/** 不含原始参数、输出、异常消息或堆栈的工具审计记录。 */
export interface ToolExecutionAuditRecord {
  traceId: string;
  turnId: string;
  executionId: string;
  tool: TeachingTool | null;
  state: TeachingState;
  exposure: ToolExposure | null;
  effect: ToolEffect | null;
  status: 'succeeded' | 'rejected' | 'failed' | 'outcome_unknown' | 'replayed';
  code: ToolExecutionRejectionCode | null;
  durationMs: number;
  retryable: boolean;
}

interface ToolExecutionResultBase {
  executionId: string;
  replayed: boolean;
  audit: ToolExecutionAuditRecord;
}

/** 已通过工具输出Schema验证的执行结果。 */
export interface ToolExecutionSuccess extends ToolExecutionResultBase {
  ok: true;
  tool: TeachingTool;
  output: unknown;
}

/** 预期拒绝与执行故障都转成稳定结果，不把内部异常暴露给模型。 */
export interface ToolExecutionFailure extends ToolExecutionResultBase {
  ok: false;
  tool: TeachingTool | null;
  code: ToolExecutionRejectionCode;
  retryable: boolean;
}

export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;

/** 一次待执行调用；executionId必须由orchestrator生成而不是采信模型字段。 */
export interface ToolExecutionRequest {
  rawCall: unknown;
  context: TrustedToolExecutionContext;
}

/** 批次只有在所有调用均通过预检后才会开始顺序执行。 */
export type ToolBatchExecutionResult =
  | {
      accepted: false;
      rejections: readonly ToolExecutionFailure[];
    }
  | {
      accepted: true;
      results: readonly ToolExecutionResult[];
    };

/** 提供给模型网关的安全工具描述，不包含handler与输出Schema。 */
export interface ModelTeachingToolDescriptor {
  name: TeachingTool;
  description: string;
  inputSchema: z.ZodType<unknown>;
}

/** 类型擦除后的注册项；必须通过defineTeachingTool创建。 */
export interface RegisteredTeachingTool {
  name: TeachingTool;
  description: string;
  exposure: ToolExposure;
  effect: ToolEffect;
  timeoutMs: number;
  inputSchema: z.ZodType<unknown>;
  outputSchema: z.ZodType<unknown>;
  execute(
    input: unknown,
    context: TeachingToolHandlerContext,
  ): Promise<unknown>;
}

/** 保留单个handler输入输出类型，同时向异构registry提供统一执行接口。 */
export function defineTeachingTool<Input, Output>(definition: {
  name: TeachingTool;
  description: string;
  exposure: ToolExposure;
  effect: ToolEffect;
  timeoutMs: number;
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  handler(
    input: Input,
    context: TeachingToolHandlerContext,
  ): Promise<Output> | Output;
}): RegisteredTeachingTool {
  if (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0) {
    throw new Error('工具timeoutMs必须是正数');
  }

  return {
    name: definition.name,
    description: definition.description,
    exposure: definition.exposure,
    effect: definition.effect,
    timeoutMs: definition.timeoutMs,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    async execute(input, context) {
      // 输入已经在executor全批预检阶段解析；这里不能重复执行可能带transform的Schema。
      return definition.handler(input as Input, context);
    },
  };
}

export interface TeachingToolExecutorOptions {
  now?: () => number;
  maxCachedExecutions?: number;
  onAudit?: (record: ToolExecutionAuditRecord) => Promise<void> | void;
}

interface PreparedExecution {
  request: ToolExecutionRequest;
  tool: TeachingTool;
  input: unknown;
  signature: string;
  registration: RegisteredTeachingTool;
}

interface CachedExecution {
  signature: string;
  result: Promise<ToolExecutionResult>;
  settled: boolean;
}

class ToolTimeoutError extends Error {}

const isTeachingTool = (value: string): value is TeachingTool =>
  (teachingTools as readonly string[]).includes(value);

const canonicalizeJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
    .join(',')}}`;
};

const createExecutionSignature = (
  call: RawTeachingToolCall & { tool: TeachingTool },
  context: TrustedToolExecutionContext,
): string =>
  JSON.stringify([
    call.tool,
    canonicalizeJson(call.arguments),
    context.turnId,
    context.studentId,
    context.sessionId,
    context.knowledgeNodeId,
    context.state,
    context.invoker,
  ]);

/**
 * 状态感知工具执行器。它只负责输入信任提升、授权、隔离与进程内去重；
 * write handler仍必须用持久幂等键、事务和可信领域事件保证业务exactly-once。
 */
export class TeachingToolExecutor {
  private readonly registrations = new Map<
    TeachingTool,
    RegisteredTeachingTool
  >();
  private readonly executions = new Map<string, CachedExecution>();
  private readonly now: () => number;
  private readonly maxCachedExecutions: number;
  private readonly onAudit:
    ((record: ToolExecutionAuditRecord) => Promise<void> | void) | undefined;

  constructor(
    registrations: readonly RegisteredTeachingTool[],
    options: TeachingToolExecutorOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.maxCachedExecutions = options.maxCachedExecutions ?? 1_024;
    this.onAudit = options.onAudit;
    if (
      !Number.isSafeInteger(this.maxCachedExecutions) ||
      this.maxCachedExecutions <= 0
    ) {
      throw new Error('maxCachedExecutions必须是正整数');
    }

    for (const registration of registrations) {
      if (this.registrations.has(registration.name)) {
        throw new Error(`工具${registration.name}重复注册`);
      }
      this.registrations.set(registration.name, registration);
    }
  }

  /** 模型只能看到当前状态允许、已注册且明确标记为model的工具。 */
  listModelTools(state: TeachingState): readonly ModelTeachingToolDescriptor[] {
    return [...this.registrations.values()]
      .filter(
        (registration) =>
          registration.exposure === 'model' &&
          isToolAllowed(state, registration.name),
      )
      .map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }));
  }

  /** 执行单个调用；同一executor中的executionId会复用首次结果和进行中的Promise。 */
  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const prepared = await this.preflight(request);
    if (!prepared.ok) return prepared.failure;
    return this.executePrepared(prepared.value);
  }

  /** 全批次先预检；任一调用不合法时，整个批次都不会触发handler。 */
  async executeBatch(
    requests: readonly ToolExecutionRequest[],
  ): Promise<ToolBatchExecutionResult> {
    const prepared = await Promise.all(
      requests.map((request) => this.preflight(request)),
    );
    const rejections = prepared
      .filter(
        (item): item is { ok: false; failure: ToolExecutionFailure } =>
          !item.ok,
      )
      .map((item) => item.failure);

    if (rejections.length > 0) return { accepted: false, rejections };

    const signatures = new Map<string, string>();
    const conflictingExecutionIds = new Set<string>();
    for (const item of prepared) {
      if (!item.ok) continue;
      const executionId = item.value.request.context.executionId;
      const existingSignature =
        signatures.get(executionId) ??
        this.executions.get(executionId)?.signature;
      if (
        existingSignature !== undefined &&
        existingSignature !== item.value.signature
      ) {
        conflictingExecutionIds.add(executionId);
      } else {
        signatures.set(executionId, item.value.signature);
      }
    }

    if (conflictingExecutionIds.size > 0) {
      const conflicts = await Promise.all(
        prepared
          .filter(
            (item): item is { ok: true; value: PreparedExecution } =>
              item.ok &&
              conflictingExecutionIds.has(
                item.value.request.context.executionId,
              ),
          )
          .map((item) =>
            this.reject(
              item.value.request.context,
              item.value.tool,
              item.value.registration,
              'IDEMPOTENCY_CONFLICT',
            ),
          ),
      );
      return { accepted: false, rejections: conflicts };
    }

    const writeCalls = prepared.filter(
      (item): item is { ok: true; value: PreparedExecution } =>
        item.ok && item.value.registration.effect === 'write',
    );
    if (prepared.length > 1 && writeCalls.length > 0) {
      return {
        accepted: false,
        rejections: await Promise.all(
          writeCalls.map((item) =>
            this.reject(
              item.value.request.context,
              item.value.tool,
              item.value.registration,
              'WRITE_BATCH_NOT_SUPPORTED',
            ),
          ),
        ),
      };
    }

    const results: ToolExecutionResult[] = [];
    for (const item of prepared) {
      if (!item.ok) continue;
      const result = await this.executePrepared(item.value);
      results.push(result);
      if (!result.ok) break;
    }
    return { accepted: true, results };
  }

  private async preflight(
    request: ToolExecutionRequest,
  ): Promise<
    | { ok: true; value: PreparedExecution }
    | { ok: false; failure: ToolExecutionFailure }
  > {
    const envelope = rawTeachingToolCallSchema.safeParse(request.rawCall);
    if (!envelope.success) {
      return {
        ok: false,
        failure: await this.reject(request.context, null, null, 'INVALID_CALL'),
      };
    }

    if (!isTeachingTool(envelope.data.tool)) {
      return {
        ok: false,
        failure: await this.reject(request.context, null, null, 'UNKNOWN_TOOL'),
      };
    }

    const tool = envelope.data.tool;
    if (!isToolAllowed(request.context.state, tool)) {
      return {
        ok: false,
        failure: await this.reject(
          request.context,
          tool,
          this.registrations.get(tool) ?? null,
          'TOOL_NOT_ALLOWED',
        ),
      };
    }

    const registration = this.registrations.get(tool);
    if (
      !registration ||
      (request.context.invoker === 'model' && registration.exposure !== 'model')
    ) {
      return {
        ok: false,
        failure: await this.reject(
          request.context,
          tool,
          registration ?? null,
          'TOOL_NOT_AVAILABLE',
        ),
      };
    }

    const input = registration.inputSchema.safeParse(envelope.data.arguments);
    if (!input.success) {
      return {
        ok: false,
        failure: await this.reject(
          request.context,
          tool,
          registration,
          'INVALID_ARGUMENTS',
        ),
      };
    }

    return {
      ok: true,
      value: {
        request,
        tool,
        input: input.data,
        signature: createExecutionSignature(
          { ...envelope.data, tool },
          request.context,
        ),
        registration,
      },
    };
  }

  private async executePrepared(
    prepared: PreparedExecution,
  ): Promise<ToolExecutionResult> {
    const { executionId } = prepared.request.context;
    const cached = this.executions.get(executionId);
    if (cached) {
      if (cached.signature !== prepared.signature) {
        return this.reject(
          prepared.request.context,
          prepared.tool,
          prepared.registration,
          'IDEMPOTENCY_CONFLICT',
        );
      }
      return this.replay(await cached.result);
    }

    if (!this.ensureExecutionCapacity()) {
      return this.reject(
        prepared.request.context,
        prepared.tool,
        prepared.registration,
        'EXECUTION_CACHE_CAPACITY',
        true,
      );
    }

    const execution = this.invoke(prepared);
    const entry: CachedExecution = {
      signature: prepared.signature,
      result: execution,
      settled: false,
    };
    this.executions.set(executionId, entry);
    void execution.then(
      () => {
        entry.settled = true;
      },
      () => {
        entry.settled = true;
      },
    );
    return execution;
  }

  private ensureExecutionCapacity(): boolean {
    if (this.executions.size < this.maxCachedExecutions) return true;
    for (const [executionId, cached] of this.executions) {
      if (cached.settled) this.executions.delete(executionId);
      if (this.executions.size < this.maxCachedExecutions) return true;
    }
    return false;
  }

  private async invoke(
    prepared: PreparedExecution,
  ): Promise<ToolExecutionResult> {
    const { context } = prepared.request;
    const { registration, tool } = prepared;
    const startedAt = this.now();
    const abortController = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          abortController.abort();
          reject(new ToolTimeoutError());
        }, registration.timeoutMs);
      });
      const rawOutput = await Promise.race([
        registration.execute(prepared.input, {
          ...context,
          signal: abortController.signal,
        }),
        timeout,
      ]);
      const output = registration.outputSchema.safeParse(rawOutput);
      if (!output.success) {
        return this.fail(
          context,
          tool,
          registration,
          'INVALID_OUTPUT',
          startedAt,
          false,
        );
      }

      const audit = this.createAudit(
        context,
        tool,
        registration,
        'succeeded',
        null,
        startedAt,
        false,
      );
      await this.emitAudit(audit);
      return {
        ok: true,
        executionId: context.executionId,
        tool,
        output: output.data,
        replayed: false,
        audit,
      };
    } catch (error) {
      const timedOut = error instanceof ToolTimeoutError;
      if (timedOut && registration.effect === 'write') {
        return this.fail(
          context,
          tool,
          registration,
          'WRITE_TIMEOUT_OUTCOME_UNKNOWN',
          startedAt,
          false,
          'outcome_unknown',
        );
      }
      return this.fail(
        context,
        tool,
        registration,
        timedOut ? 'TIMEOUT' : 'HANDLER_ERROR',
        startedAt,
        timedOut && registration.effect === 'read',
      );
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  private async reject(
    context: TrustedToolExecutionContext,
    tool: TeachingTool | null,
    registration: RegisteredTeachingTool | null,
    code: ToolExecutionRejectionCode,
    retryable = false,
  ): Promise<ToolExecutionFailure> {
    const audit = this.createAudit(
      context,
      tool,
      registration,
      'rejected',
      code,
      this.now(),
      retryable,
    );
    await this.emitAudit(audit);
    return {
      ok: false,
      executionId: context.executionId,
      tool,
      code,
      retryable,
      replayed: false,
      audit,
    };
  }

  private async fail(
    context: TrustedToolExecutionContext,
    tool: TeachingTool,
    registration: RegisteredTeachingTool,
    code: ToolExecutionRejectionCode,
    startedAt: number,
    retryable: boolean,
    status: ToolExecutionAuditRecord['status'] = 'failed',
  ): Promise<ToolExecutionFailure> {
    const audit = this.createAudit(
      context,
      tool,
      registration,
      status,
      code,
      startedAt,
      retryable,
    );
    await this.emitAudit(audit);
    return {
      ok: false,
      executionId: context.executionId,
      tool,
      code,
      retryable,
      replayed: false,
      audit,
    };
  }

  private async replay(
    result: ToolExecutionResult,
  ): Promise<ToolExecutionResult> {
    const audit: ToolExecutionAuditRecord = {
      ...result.audit,
      status: 'replayed',
      durationMs: 0,
    };
    await this.emitAudit(audit);
    return { ...result, replayed: true, audit };
  }

  private createAudit(
    context: TrustedToolExecutionContext,
    tool: TeachingTool | null,
    registration: RegisteredTeachingTool | null,
    status: ToolExecutionAuditRecord['status'],
    code: ToolExecutionRejectionCode | null,
    startedAt: number,
    retryable: boolean,
  ): ToolExecutionAuditRecord {
    return {
      traceId: context.traceId,
      turnId: context.turnId,
      executionId: context.executionId,
      tool,
      state: context.state,
      exposure: registration?.exposure ?? null,
      effect: registration?.effect ?? null,
      status,
      code,
      durationMs: Math.max(0, this.now() - startedAt),
      retryable,
    };
  }

  private emitAudit(record: ToolExecutionAuditRecord): void {
    try {
      void Promise.resolve(this.onAudit?.(record)).catch(() => undefined);
    } catch {
      // 审计sink是观测适配器；不得改变已确定的工具执行语义。
    }
  }
}
