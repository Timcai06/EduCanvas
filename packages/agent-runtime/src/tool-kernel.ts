import { createHash } from 'node:crypto';
import type {
  AgentToolCallLedgerPort,
  AgentToolEffect,
  AgentToolExposure,
  ModelAbortSignal,
  ModelToolDefinition,
  ToolEffectLedgerPort,
} from '@educanvas/agent-core';
import { z } from 'zod';

export const toolSources = ['local', 'teaching', 'mcp', 'node'] as const;
export type ToolSource = (typeof toolSources)[number];
export const toolRiskLevels = ['l0', 'l1', 'l2', 'l3'] as const;
export type ToolRiskLevel = (typeof toolRiskLevels)[number];
export const toolPolicyDimensions = [
  'actor',
  'notebook',
  'profile',
  'channel',
  'environment',
] as const;
export type ToolPolicyDimension = (typeof toolPolicyDimensions)[number];

export interface ToolKernelTrustedContext {
  operationId: string;
  conversationId: string;
  traceId: string;
  actorId: string;
  agentId: string;
  notebookId: string;
  profileId: string;
  channel: string;
  environment: string;
  answerModelRunId: string;
  providerToolCallId: string;
  executionId: string;
  capabilities: Readonly<Record<ToolPolicyDimension, readonly string[]>>;
  approvedCapabilities: readonly string[];
  /** 由具体Profile Adapter验证的可信纵向上下文；Kernel不解释其字段。 */
  profileContext?: Readonly<Record<string, unknown>>;
  /** Credential Broker返回的不透明句柄；Adapter不能把它写入输出或错误。 */
  credentialHandle?: string | null;
}

export interface ToolAdapterInvocationContext {
  operationId: string;
  executionId: string;
  conversationId: string;
  traceId: string;
  actorId: string;
  agentId: string;
  notebookId: string;
  profileId: string;
  channel: string;
  environment: string;
  credentialHandle: string | null;
  profileContext: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
}

/** Adapter只声明能力和执行，不拥有身份、授权、审批、幂等或终态判定权。 */
export interface ToolKernelAdapter<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  source: ToolSource;
  capability: string;
  risk: ToolRiskLevel;
  exposure: AgentToolExposure;
  effect: AgentToolEffect;
  timeoutMs: number;
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  /**
   * reject表示Adapter能证明副作用未提交；若write结果无法确认，必须抛ToolOutcomeUnknownError。
   */
  invoke(
    input: Input,
    context: ToolAdapterInvocationContext,
  ): Promise<Output> | Output;
}

interface AnyToolKernelAdapter {
  name: string;
  description: string;
  source: ToolSource;
  capability: string;
  risk: ToolRiskLevel;
  exposure: AgentToolExposure;
  effect: AgentToolEffect;
  timeoutMs: number;
  inputSchema: z.ZodType<unknown>;
  outputSchema: z.ZodType<unknown>;
  invoke(
    input: never,
    context: ToolAdapterInvocationContext,
  ): Promise<unknown> | unknown;
}

export type ToolKernelFailureCode =
  | 'tool_not_available'
  | `capability_denied:${ToolPolicyDimension}`
  | 'approval_required'
  | 'invalid_arguments'
  | 'idempotency_conflict'
  | 'execution_cache_capacity'
  | 'execution_in_progress'
  | 'result_replay_required'
  | 'tool_timeout'
  | 'tool_cancelled'
  | 'write_outcome_unknown'
  | 'tool_failed'
  | 'invalid_output'
  | 'ledger_unavailable';

export type ToolKernelResult =
  | {
      ok: true;
      status: 'succeeded';
      tool: string;
      output: unknown;
      replayed: boolean;
    }
  | {
      ok: false;
      status:
        | 'denied'
        | 'approval_required'
        | 'timed_out'
        | 'cancelled'
        | 'failed'
        | 'outcome_unknown';
      tool: string;
      code: ToolKernelFailureCode;
      retryable: boolean;
      replayed: boolean;
    };

interface CachedExecution {
  signature: string;
  result: Promise<ToolKernelResult>;
  settled: boolean;
}

class ToolTimeoutError extends Error {}
class ToolCancelledError extends Error {}
/** write Adapter无法确认外部副作用结果时使用；message不会进入事件、账本或模型。 */
export class ToolOutcomeUnknownError extends Error {
  override readonly name = 'ToolOutcomeUnknownError';
}

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
  if (seen.has(value)) throw new Error('circular_tool_value');
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

function failure(
  tool: string,
  status: Exclude<ToolKernelResult['status'], 'succeeded'>,
  code: ToolKernelFailureCode,
  retryable: boolean,
): ToolKernelResult {
  return { ok: false, status, tool, code, retryable, replayed: false };
}

function policyDenial(
  adapter: AnyToolKernelAdapter,
  context: ToolKernelTrustedContext,
): ToolKernelResult | null {
  const denied = toolPolicyDimensions.find(
    (dimension) =>
      !context.capabilities[dimension].includes(adapter.capability),
  );
  if (denied) {
    return failure(
      adapter.name,
      'denied',
      `capability_denied:${denied}`,
      false,
    );
  }
  if (
    ['l2', 'l3'].includes(adapter.risk) &&
    !context.approvedCapabilities.includes(adapter.capability)
  ) {
    return failure(
      adapter.name,
      'approval_required',
      'approval_required',
      false,
    );
  }
  return null;
}

/**
 * 四类Tool Adapter的唯一执行内核。原始值只在内存中流经Schema与Adapter；
 * 持久端口只接收Tool Call摘要和write effect的key/hash。
 */
export class ToolKernel {
  private readonly adapters = new Map<string, AnyToolKernelAdapter>();
  private readonly executions = new Map<string, CachedExecution>();

  constructor(
    adapters: readonly AnyToolKernelAdapter[],
    private readonly callLedger: AgentToolCallLedgerPort,
    private readonly effectLedger: ToolEffectLedgerPort,
    private readonly maxCachedExecutions = 1_024,
  ) {
    if (
      !Number.isSafeInteger(maxCachedExecutions) ||
      maxCachedExecutions < 1 ||
      maxCachedExecutions > 100_000
    ) {
      throw new Error('maxCachedExecutions必须是1到100000之间的整数');
    }
    for (const adapter of adapters) {
      if (
        !/^[a-z][A-Za-z0-9_.-]{0,63}$/.test(adapter.name) ||
        !/^[a-z][a-z0-9_.-]{0,63}$/.test(adapter.capability) ||
        !toolSources.includes(adapter.source) ||
        !toolRiskLevels.includes(adapter.risk) ||
        !['model', 'runtime'].includes(adapter.exposure) ||
        !['read', 'write'].includes(adapter.effect) ||
        !Number.isSafeInteger(adapter.timeoutMs) ||
        adapter.timeoutMs < 1 ||
        adapter.timeoutMs > 10 * 60_000 ||
        this.adapters.has(adapter.name)
      ) {
        throw new Error(`非法或重复Tool Adapter: ${adapter.name}`);
      }
      this.adapters.set(adapter.name, adapter);
    }
  }

  /** 只投影五维权限交集内、允许模型调用的工具；L2/L3仍在执行前要求可信审批。 */
  listDefinitions(
    context: ToolKernelTrustedContext,
  ): readonly ModelToolDefinition[] {
    return [...this.adapters.values()]
      .filter(
        (adapter) =>
          adapter.exposure === 'model' &&
          !toolPolicyDimensions.some(
            (dimension) =>
              !context.capabilities[dimension].includes(adapter.capability),
          ),
      )
      .sort((left, right) => (left.name < right.name ? -1 : 1))
      .map((adapter) => ({
        name: adapter.name,
        description: adapter.description,
        inputSchema: z.toJSONSchema(adapter.inputSchema) as Record<
          string,
          unknown
        >,
      }));
  }

  async execute(input: {
    tool: string;
    arguments: unknown;
    context: ToolKernelTrustedContext;
    signal?: ModelAbortSignal;
  }): Promise<ToolKernelResult> {
    const adapter = this.adapters.get(input.tool);
    if (!adapter) {
      return failure(input.tool, 'denied', 'tool_not_available', false);
    }
    const denied = policyDenial(adapter, input.context);
    if (denied) return denied;
    const parsedInput = adapter.inputSchema.safeParse(input.arguments);
    if (!parsedInput.success) {
      return failure(adapter.name, 'denied', 'invalid_arguments', false);
    }
    let signature: string;
    try {
      signature = createHash('sha256')
        .update(
          canonicalize([
            adapter.name,
            input.arguments,
            input.context.operationId,
            input.context.conversationId,
            input.context.traceId,
            input.context.actorId,
            input.context.agentId,
            input.context.notebookId,
            input.context.answerModelRunId,
            input.context.providerToolCallId,
          ]),
        )
        .digest('hex');
    } catch {
      return failure(adapter.name, 'denied', 'invalid_arguments', false);
    }
    const cached = this.executions.get(input.context.executionId);
    if (cached) {
      if (cached.signature !== signature) {
        return failure(adapter.name, 'denied', 'idempotency_conflict', false);
      }
      return { ...(await cached.result), replayed: true };
    }
    if (this.executions.size >= this.maxCachedExecutions) {
      const settled = [...this.executions].find(([, value]) => value.settled);
      if (!settled) {
        return failure(
          adapter.name,
          'failed',
          'execution_cache_capacity',
          true,
        );
      }
      this.executions.delete(settled[0]);
    }
    const entry: CachedExecution = {
      signature,
      result: Promise.resolve(
        failure(adapter.name, 'failed', 'ledger_unavailable', true),
      ),
      settled: false,
    };
    entry.result = this.invoke(
      adapter,
      parsedInput.data as never,
      input,
      signature,
    )
      .catch((error: unknown) => {
        const conflict =
          (error as { code?: unknown }).code === 'agent_tool_call_conflict';
        return failure(
          adapter.name,
          conflict ? 'denied' : 'failed',
          conflict ? 'idempotency_conflict' : 'ledger_unavailable',
          !conflict,
        );
      })
      .finally(() => {
        entry.settled = true;
      });
    this.executions.set(input.context.executionId, entry);
    return entry.result;
  }

  private async invoke(
    adapter: AnyToolKernelAdapter,
    parsedInput: never,
    request: {
      arguments: unknown;
      context: ToolKernelTrustedContext;
      signal?: ModelAbortSignal;
    },
    semanticsHash: string,
  ): Promise<ToolKernelResult> {
    const common = {
      operationId: request.context.operationId,
      actorId: request.context.actorId,
    };
    const created = await this.callLedger.createOrGet({
      ...common,
      answerModelRunId: request.context.answerModelRunId,
      providerToolCallId: request.context.providerToolCallId,
      executionId: request.context.executionId,
      toolName: adapter.name,
      exposure: adapter.exposure,
      effect: adapter.effect,
      arguments: request.arguments,
    });
    if (created.replayed) {
      return failure(
        adapter.name,
        'failed',
        created.call.status === 'pending' || created.call.status === 'running'
          ? 'execution_in_progress'
          : 'result_replay_required',
        false,
      );
    }
    await this.callLedger.markRunning({
      ...common,
      toolCallId: created.call.id,
    });
    const effect =
      adapter.effect === 'write'
        ? await this.effectLedger.intend({
            ...common,
            toolCallId: created.call.id,
            effectKey: request.context.executionId,
            semanticsHash,
          })
        : null;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: () => void = () => undefined;
    let rejectCancellation: (error: Error) => void = () => undefined;
    const cancellation = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const cancel = () => {
      controller.abort('cancelled');
      rejectCancellation(new ToolCancelledError());
    };
    if (request.signal?.aborted) cancel();
    else if (request.signal) {
      request.signal.addEventListener('abort', cancel, { once: true });
      removeAbort = () => request.signal?.removeEventListener('abort', cancel);
    }
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort('timeout');
        reject(new ToolTimeoutError());
      }, adapter.timeoutMs);
    });
    const startedAt = Date.now();
    try {
      const output = await Promise.race([
        adapter.invoke(parsedInput, {
          operationId: request.context.operationId,
          executionId: request.context.executionId,
          conversationId: request.context.conversationId,
          traceId: request.context.traceId,
          actorId: request.context.actorId,
          agentId: request.context.agentId,
          notebookId: request.context.notebookId,
          profileId: request.context.profileId,
          channel: request.context.channel,
          environment: request.context.environment,
          credentialHandle: request.context.credentialHandle ?? null,
          profileContext: request.context.profileContext ?? {},
          signal: controller.signal,
        }),
        timeout,
        cancellation,
      ]);
      const parsedOutput = adapter.outputSchema.safeParse(output);
      if (effect) {
        await this.effectLedger.settle({
          ...common,
          effectId: effect.effect.id,
          status: 'committed',
        });
      }
      if (!parsedOutput.success) {
        await this.callLedger.settle({
          ...common,
          toolCallId: created.call.id,
          status: 'failed',
          code: 'invalid_output',
          durationMs: Date.now() - startedAt,
        });
        return failure(adapter.name, 'failed', 'invalid_output', false);
      }
      await this.callLedger.settle({
        ...common,
        toolCallId: created.call.id,
        status: 'succeeded',
        durationMs: Date.now() - startedAt,
        result: parsedOutput.data,
      });
      return {
        ok: true,
        status: 'succeeded',
        tool: adapter.name,
        output: parsedOutput.data,
        replayed: false,
      };
    } catch (error) {
      const uncertainWrite =
        adapter.effect === 'write' &&
        (error instanceof ToolTimeoutError ||
          error instanceof ToolCancelledError ||
          error instanceof ToolOutcomeUnknownError);
      if (effect) {
        await this.effectLedger.settle({
          ...common,
          effectId: effect.effect.id,
          status: uncertainWrite ? 'outcome_unknown' : 'failed',
          code: uncertainWrite ? 'write_outcome_unknown' : 'tool_failed',
        });
      }
      await this.callLedger.settle({
        ...common,
        toolCallId: created.call.id,
        status: uncertainWrite ? 'outcome_unknown' : 'failed',
        code: uncertainWrite
          ? 'write_outcome_unknown'
          : error instanceof ToolTimeoutError
            ? 'tool_timeout'
            : error instanceof ToolCancelledError
              ? 'tool_cancelled'
              : 'tool_failed',
        retryable: !uncertainWrite,
        durationMs: Date.now() - startedAt,
      });
      if (uncertainWrite) {
        return failure(
          adapter.name,
          'outcome_unknown',
          'write_outcome_unknown',
          false,
        );
      }
      if (error instanceof ToolTimeoutError) {
        return failure(adapter.name, 'timed_out', 'tool_timeout', true);
      }
      if (error instanceof ToolCancelledError) {
        return failure(adapter.name, 'cancelled', 'tool_cancelled', true);
      }
      return failure(adapter.name, 'failed', 'tool_failed', false);
    } finally {
      clearTimeout(timer);
      removeAbort();
    }
  }
}
