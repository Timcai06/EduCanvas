import type {
  BudgetBreachReason,
  ModelAbortSignal,
  ModelMessage,
  ModelToolDefinition,
  ModelToolResult,
  ModelUsage,
  NormalizedModelError,
  StreamTurnTextRequest,
  TurnModelEvent,
  TurnModelGateway,
} from '@educanvas/agent-core';
import {
  isAborted,
  validateModelRun,
  type ModelRunResult,
  type ParsedToolCall,
} from './turn-engine';

export interface AgentLoopPrompt {
  taskAlias: StreamTurnTextRequest['taskAlias'];
  modelAlias: StreamTurnTextRequest['modelAlias'];
  promptVersion: string;
  messages: readonly ModelMessage[];
  tools: readonly ModelToolDefinition[];
}

export interface AgentLoopToolSuccess<TDetail> {
  call: ParsedToolCall;
  modelResult: ModelToolResult;
  detail: TDetail;
}

export type AgentLoopToolBatch<TDetail, TFailure> =
  | { ok: true; results: readonly AgentLoopToolSuccess<TDetail>[] }
  | { ok: false; failure: TFailure };

export interface AgentLoopModelRunLifecycle<TContext> {
  /** 在供应商调用前建立脱敏 Model Run；正文只能用于本进程哈希，不能越过实现边界。 */
  start(input: {
    run: number;
    request: StreamTurnTextRequest;
  }): Promise<TContext>;
  /** 只在 Runtime 完成协议校验后结算，避免把非法供应商流记成成功。 */
  settle(input: {
    run: number;
    request: StreamTurnTextRequest;
    context: TContext;
    outcome: ModelRunResult;
  }): Promise<void>;
}

/**
 * Turn 使用预算执行器端口（Q03）— 服务端在 LOOP 阶段强制执行预算。
 * Agent Loop 不关心预算如何记账，只管在固定检查点调用；超预算时
 * 必须以 BUDGET_EXCEEDED 终态终止，不得伪装为成功。
 */
export interface AgentLoopUsageBudgetPort {
  /** 每次模型调用尝试前（含重试）。返回 reason 表示超预算。 */
  checkBeforeModelCall(input: {
    run: number;
    attempt: number;
    request: StreamTurnTextRequest;
  }): BudgetBreachReason | null;
  /** usage 事件到达时记账（最后一次到达为准）。 */
  observeUsage(usage: ModelUsage): void;
  /** 每次 run 收敛后（成功）复查累计量。 */
  checkAfterModelRun(input: {
    run: number;
    ok: boolean;
    textCharacters: number;
  }): BudgetBreachReason | null;
  /** 每批工具执行前投影检查。 */
  checkBeforeToolExecution(input: {
    calls: readonly { callId: string; tool: string }[];
  }): BudgetBreachReason | null;
  /** 工具结果落地（喂回模型前）：计数并按截断协议处理超限结果。 */
  observeToolResult(result: ModelToolResult): ModelToolResult;
}

export interface AgentLoopCommand<TDetail, TFailure, TModelRunContext = never> {
  traceId: string;
  turnId: string;
  answer: AgentLoopPrompt;
  synthesis: Omit<AgentLoopPrompt, 'tools'>;
  maxToolRounds: number;
  signal?: ModelAbortSignal;
  modelRunLifecycle?: AgentLoopModelRunLifecycle<TModelRunContext>;
  usageBudget?: AgentLoopUsageBudgetPort;
  executeTools(
    calls: readonly ParsedToolCall[],
    context: {
      round: number;
      traceId: string;
      turnId: string;
      modelRun: TModelRunContext | undefined;
    },
  ): Promise<AgentLoopToolBatch<TDetail, TFailure>>;
}

export type AgentLoopEvent<TDetail, TFailure> =
  | { type: 'model'; run: number; event: TurnModelEvent }
  | {
      type: 'model.retry';
      run: number;
      attempt: number;
      error: NormalizedModelError;
    }
  | { type: 'tool.started'; run: number; call: ParsedToolCall }
  | { type: 'tool.result'; run: number; result: AgentLoopToolSuccess<TDetail> }
  | { type: 'completed'; modelRunCount: number }
  | (
      | {
          type: 'failed';
          code:
            | 'MODEL_GATEWAY_FAILED'
            | 'MODEL_ABORTED'
            | 'INVALID_MODEL_STREAM'
            | 'DUPLICATE_TOOL_CALL_ID'
            | 'RUNTIME_FAILED';
          error: NormalizedModelError;
        }
      | {
          type: 'failed';
          code: 'BUDGET_EXCEEDED';
          /** 超预算的具体维度，供账本/Trace/指标使用。 */
          budgetReason: BudgetBreachReason;
          error: NormalizedModelError;
        }
    )
  | { type: 'tool.failed'; failure: TFailure };

/* 429 限流在部分供应商（视觉模型等）常见 10-30 秒窗口：4 次重试 + 20s 退避
   封顶约覆盖 15s（指数）到 80s（Retry-After 优先）的等待，且不会击穿
   agent.turn 的 180s 墙钟预算；teaching.turn 的 60s 墙钟下超时会由预算
   优雅截断，不会无限等待。 */
const MAX_MODEL_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 20_000;

const RETRYABLE_ERROR_CODES = new Set<NormalizedModelError['code']>([
  'rate_limit',
  'unavailable',
  'timeout',
]);

const retryableError = (error: NormalizedModelError): boolean =>
  error.retryable && RETRYABLE_ERROR_CODES.has(error.code);

const retryDelayMs = (
  retryIndex: number,
  error: NormalizedModelError,
  random: () => number,
): number => {
  const requested = error.retryAfterMs ?? RETRY_BASE_DELAY_MS * 2 ** retryIndex;
  const capped = Math.min(requested, RETRY_MAX_DELAY_MS);
  const jitter = random() * capped * 0.3;
  return Math.round(capped + jitter);
};

/** Q03：超预算的稳定终态事件（retryable=false，重试只会重复烧预算）。 */
const budgetExceededEvent = (
  budgetReason: BudgetBreachReason,
): {
  type: 'failed';
  code: 'BUDGET_EXCEEDED';
  budgetReason: BudgetBreachReason;
  error: NormalizedModelError;
} => ({
  type: 'failed',
  code: 'BUDGET_EXCEEDED',
  budgetReason,
  error: { code: 'unknown', retryable: false },
});

const waitForRetry = (
  ms: number,
  signal: ModelAbortSignal | undefined,
): Promise<boolean> =>
  new Promise((resolve) => {
    if (isAborted(signal)) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export interface AgentLoopRetryDependencies {
  random(): number;
  wait(ms: number, signal: ModelAbortSignal | undefined): Promise<boolean>;
}

const defaultRetryDependencies: AgentLoopRetryDependencies = {
  random: Math.random,
  wait: waitForRetry,
};

/**
 * 通用 Agent Loop 引擎 — 与领域无关的模型/工具循环。
 *
 * ## 三段式结构
 *
 * 每个 turn 分三段执行：
 *
 * ### 段 1：Answer 循环（最多 maxToolRounds 轮）
 * ```
 * 模型生成 → 解析工具调用 → 执行工具 → 结果反馈给下一轮模型
 * ```
 * 每轮可以产出文本（stream 给用户）和/或工具调用。
 * 跨轮共享 accumulatedResults，下一轮模型能看到之前所有的工具结果。
 *
 * ### 段 2：Synthesis 收尾
 * 所有工具轮次结束后，用 synthesis prompt（无 tools）让模型生成最终总结。
 * 这保证最后一句话一定是面向用户的自然语言，而不是工具调用。
 *
 * ### 段 3：终态纪律
 * synthesis 之后不允许再出工具调用 → INVALID_MODEL_STREAM。
 * 保证"模型不能无限循环调用工具"。
 *
 * ## 跨轮文本预算
 *
 * `textCharacters` 在 answer + synthesis 之间累积共享。
 * 超过 MAX_RESPONSE_CHARACTERS 时 `validateModelRun` 返回 INVALID_MODEL_STREAM。
 * 这是硬预算，防止单 turn 消耗过量 token。
 *
 * ## 模型调用重试
 *
 * 当模型返回 rate_limit / unavailable / timeout 且 retryable=true 时，
 * Agent Loop 自动指数退避重试，最多 MAX_MODEL_RETRIES 次。
 * 重试期间 yield model.retry 事件通知上层编排；公开 UI 是否展示由应用协议决定。
 *
 * ## 注入点
 *
 * - `executeTools`: 调用方实现工具执行。Agent Loop 不关心工具怎么执行、
 *   副作用怎么处理 — 它只负责"模型说调什么，就调什么，然后把结果传回去"。
 * - `modelRunLifecycle`: 每次模型运行的前后钩子（开始记账/结算）。
 *   Agent Loop 不关心账本存在哪里，只管按时调 start/settle。
 *
 * 本文件是系统唯一的 Agent Loop 实现入口；任何领域/工具层不得创建第二套
 * answer→tool→synthesis 的模型循环，避免重复 side effect 与无法解释的账本切片。
 */
export class AgentLoopEngine {
  constructor(
    private readonly modelGateway: TurnModelGateway,
    private readonly retryDependencies: AgentLoopRetryDependencies = defaultRetryDependencies,
  ) {}

  async *stream<TDetail, TFailure, TModelRunContext = never>(
    command: AgentLoopCommand<TDetail, TFailure, TModelRunContext>,
  ): AsyncGenerator<AgentLoopEvent<TDetail, TFailure>> {
    // 圈数钳位：最少 1 圈，最多 4 圈，截断异常值
    const maxToolRounds = Math.min(
      4,
      Math.max(1, Math.trunc(command.maxToolRounds)),
    );
    const accumulatedResults: ModelToolResult[] = [];
    let textCharacters = 0; // 跨轮累积文本字符数，answer + synthesis 共享预算
    let hadAnyText = false; // 之前是否产出过文本，决定 synthesis 前是否补空行
    let run = 0;

    // ═══ 段 1：Answer 循环 — 模型 ↔ 工具交互 ═══
    // 任何一次调用要么产出唯一终态(run结束/失败/取消)，要么抛到上游，
    // 不允许在内部吞掉失败后继续“假成功”推进。
    for (let round = 1; round <= maxToolRounds; round += 1) {
      run += 1;
      const request: StreamTurnTextRequest = {
        ...command.answer,
        phase: 'answer',
        toolResults: accumulatedResults,
        traceId: command.traceId,
        turnId: command.turnId,
        signal: command.signal,
      };
      let modelRun: TModelRunContext | undefined;
      let outcome!: ModelRunResult;
      // 重试循环只覆盖 validateModelRun 未通过后的临时失败；一旦命令已被取消或
      // 已收到终态，当前 run 即终止，不会再触发额外工具副作用。
      for (let attempt = 0; attempt <= MAX_MODEL_RETRIES; attempt += 1) {
        if (attempt > 0) {
          if (isAborted(command.signal)) {
            yield {
              type: 'failed',
              code: 'MODEL_ABORTED',
              error: { code: 'aborted', retryable: false },
            };
            return;
          }
          if (outcome.ok) break;
          const err = outcome.error;
          const delay = retryDelayMs(
            attempt - 1,
            err,
            this.retryDependencies.random,
          );
          yield {
            type: 'model.retry',
            run,
            attempt,
            error: err,
          };
          if (!(await this.retryDependencies.wait(delay, command.signal))) {
            yield {
              type: 'failed',
              code: 'MODEL_ABORTED',
              error: { code: 'aborted', retryable: false },
            };
            return;
          }
        }
        try {
          // 每次尝试都计入模型调用与时间预算：重试不能绕过预算。
          const budgetReason = command.usageBudget?.checkBeforeModelCall({
            run,
            attempt,
            request,
          });
          if (budgetReason) {
            yield budgetExceededEvent(budgetReason);
            return;
          }
          modelRun = await command.modelRunLifecycle?.start({ run, request });
        } catch {
          yield {
            type: 'failed',
            code: 'RUNTIME_FAILED',
            error: { code: 'unknown', retryable: true },
          };
          return;
        }
        const iterator = validateModelRun(
          this.modelGateway,
          request,
          textCharacters,
        )[Symbol.asyncIterator]();
        let separatorPending = hadAnyText;
        let emittedEvent = false;
        while (true) {
          const step = await iterator.next();
          if (step.done) {
            outcome = step.value;
            break;
          }
          emittedEvent = true;
          if (step.value.type === 'usage') {
            command.usageBudget?.observeUsage(step.value.usage);
          }
          if (separatorPending && step.value.type === 'text_delta') {
            separatorPending = false;
            yield {
              type: 'model',
              run,
              event: { type: 'text_delta', phase: 'answer', delta: '\n\n' },
            };
          }
          yield { type: 'model', run, event: step.value };
        }
        try {
          if (modelRun !== undefined) {
            await command.modelRunLifecycle?.settle({
              run,
              request,
              context: modelRun,
              outcome,
            });
          }
        } catch {
          yield {
            type: 'failed',
            code: 'RUNTIME_FAILED',
            error: { code: 'unknown', retryable: true },
          };
          return;
        }
        if (!outcome.ok) {
          command.usageBudget?.checkAfterModelRun({
            run,
            ok: false,
            textCharacters,
          });
        }
        if (
          outcome.ok ||
          emittedEvent ||
          !retryableError(outcome.error) ||
          attempt === MAX_MODEL_RETRIES
        )
          break;
      }
      if (!outcome.ok) {
        yield { type: 'failed', code: outcome.code, error: outcome.error };
        return;
      }
      hadAnyText = hadAnyText || outcome.hadText;
      textCharacters = outcome.textCharacters;
      // 成功收敛后复查累计量：输入/输出 token、成本与时间。
      const afterRunReason = command.usageBudget?.checkAfterModelRun({
        run,
        ok: true,
        textCharacters,
      });
      if (afterRunReason) {
        yield budgetExceededEvent(afterRunReason);
        return;
      }
      if (outcome.toolCalls.length === 0) {
        yield { type: 'completed', modelRunCount: run };
        return;
      }
      if (isAborted(command.signal)) {
        yield {
          type: 'failed',
          code: 'MODEL_ABORTED',
          error: { code: 'aborted', retryable: false },
        };
        return;
      }
      // 工具执行前投影检查：已执行 + 本批待执行。
      const beforeToolsReason = command.usageBudget?.checkBeforeToolExecution({
        calls: outcome.toolCalls,
      });
      if (beforeToolsReason) {
        yield budgetExceededEvent(beforeToolsReason);
        return;
      }
      for (const call of outcome.toolCalls) {
        yield { type: 'tool.started', run, call };
      }
      const executed = await command.executeTools(outcome.toolCalls, {
        round,
        traceId: command.traceId,
        turnId: command.turnId,
        modelRun,
      });
      if (!executed.ok) {
        yield { type: 'tool.failed', failure: executed.failure };
        return;
      }
      if (executed.results.length !== outcome.toolCalls.length) {
        yield {
          type: 'failed',
          code: 'INVALID_MODEL_STREAM',
          error: { code: 'invalid_response', retryable: false },
        };
        return;
      }
      for (const [index, result] of executed.results.entries()) {
        const expected = outcome.toolCalls[index];
        if (
          expected === undefined ||
          result.call.callId !== expected.callId ||
          result.call.tool !== expected.tool
        ) {
          yield {
            type: 'failed',
            code: 'INVALID_MODEL_STREAM',
            error: { code: 'invalid_response', retryable: false },
          };
          return;
        }
        // 截断协议：超限的工具结果在喂回模型前被替换为稳定截断副本。
        accumulatedResults.push(
          command.usageBudget?.observeToolResult(result.modelResult) ??
            result.modelResult,
        );
        yield { type: 'tool.result', run, result };
      }
    }

    // ═══ 段 2：Synthesis 收尾 — 无 tools 的最终总结 ═══
    run += 1;
    const synthesisRequest: StreamTurnTextRequest = {
      ...command.synthesis,
      phase: 'synthesis',
      tools: [],
      toolResults: accumulatedResults,
      traceId: command.traceId,
      turnId: command.turnId,
      signal: command.signal,
    };
    let synthesisModelRun: TModelRunContext | undefined;
    let synthesisOutcome!: ModelRunResult;
    for (let attempt = 0; attempt <= MAX_MODEL_RETRIES; attempt += 1) {
      if (attempt > 0) {
        if (isAborted(command.signal)) {
          yield {
            type: 'failed',
            code: 'MODEL_ABORTED',
            error: { code: 'aborted', retryable: false },
          };
          return;
        }
        if (synthesisOutcome.ok) break;
        const err = synthesisOutcome.error;
        const delay = retryDelayMs(
          attempt - 1,
          err,
          this.retryDependencies.random,
        );
        yield {
          type: 'model.retry',
          run,
          attempt,
          error: err,
        };
        if (!(await this.retryDependencies.wait(delay, command.signal))) {
          yield {
            type: 'failed',
            code: 'MODEL_ABORTED',
            error: { code: 'aborted', retryable: false },
          };
          return;
        }
      }
      try {
        // 与 answer 段一致：每次尝试都计入预算，重试不能绕过。
        const budgetReason = command.usageBudget?.checkBeforeModelCall({
          run,
          attempt,
          request: synthesisRequest,
        });
        if (budgetReason) {
          yield budgetExceededEvent(budgetReason);
          return;
        }
        synthesisModelRun = await command.modelRunLifecycle?.start({
          run,
          request: synthesisRequest,
        });
      } catch {
        yield {
          type: 'failed',
          code: 'RUNTIME_FAILED',
          error: { code: 'unknown', retryable: true },
        };
        return;
      }
      const iterator = validateModelRun(
        this.modelGateway,
        synthesisRequest,
        textCharacters,
      )[Symbol.asyncIterator]();
      let separatorPending = hadAnyText;
      let emittedEvent = false;
      while (true) {
        const step = await iterator.next();
        if (step.done) {
          synthesisOutcome = step.value;
          break;
        }
        emittedEvent = true;
        if (step.value.type === 'usage') {
          command.usageBudget?.observeUsage(step.value.usage);
        }
        if (separatorPending && step.value.type === 'text_delta') {
          separatorPending = false;
          yield {
            type: 'model',
            run,
            event: { type: 'text_delta', phase: 'synthesis', delta: '\n\n' },
          };
        }
        yield { type: 'model', run, event: step.value };
      }
      try {
        if (synthesisModelRun !== undefined) {
          await command.modelRunLifecycle?.settle({
            run,
            request: synthesisRequest,
            context: synthesisModelRun,
            outcome: synthesisOutcome,
          });
        }
      } catch {
        yield {
          type: 'failed',
          code: 'RUNTIME_FAILED',
          error: { code: 'unknown', retryable: true },
        };
        return;
      }
      if (!synthesisOutcome.ok) {
        command.usageBudget?.checkAfterModelRun({
          run,
          ok: false,
          textCharacters,
        });
      }
      if (
        synthesisOutcome.ok ||
        emittedEvent ||
        !retryableError(synthesisOutcome.error) ||
        attempt === MAX_MODEL_RETRIES
      )
        break;
    }
    if (!synthesisOutcome.ok) {
      yield {
        type: 'failed',
        code: synthesisOutcome.code,
        error: synthesisOutcome.error,
      };
      return;
    }
    const afterSynthesisReason = command.usageBudget?.checkAfterModelRun({
      run,
      ok: true,
      textCharacters: synthesisOutcome.textCharacters,
    });
    if (afterSynthesisReason) {
      yield budgetExceededEvent(afterSynthesisReason);
      return;
    }
    if (synthesisOutcome.toolCalls.length > 0) {
      yield {
        type: 'failed',
        code: 'INVALID_MODEL_STREAM',
        error: { code: 'invalid_response', retryable: false },
      };
      return;
    }
    yield { type: 'completed', modelRunCount: run };
    return;
  }
}
