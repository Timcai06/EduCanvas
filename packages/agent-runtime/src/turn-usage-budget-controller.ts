import {
  CHARS_PER_TOKEN,
  estimateTokensFromText,
  estimateUsageCostUsdCents,
  turnPricingPerMillionTokens,
  usageMissing,
  type BudgetBreachReason,
  type ModelUsage,
  type TurnUsageBudget,
  type TurnUsageBudgetLedgerEntry,
} from '@educanvas/agent-core';
import {
  modelMessageText,
  type ModelToolResult,
  type StreamAgentTextRequest,
} from '@educanvas/agent-core';

/** 工具输出 → 估算 token 的稳定序列化：字符串原样，其余 JSON 紧凑化。 */
function serializeToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined || output === null) return '';
  try {
    return JSON.stringify(output);
  } catch {
    return '';
  }
}

/** 请求正文的估算输入 token：messages + 工具结果正文，与 Provider 无关。 */
function estimateRequestInputTokens(request: StreamAgentTextRequest): number {
  const messagesText = request.messages
    .map((message) => modelMessageText(message))
    .join('\n');
  const toolResultsText = request.toolResults
    .map((result) => serializeToolOutput(result.output))
    .join('\n');
  return (
    estimateTokensFromText(messagesText) +
    estimateTokensFromText(toolResultsText)
  );
}

/**
 * Turn 使用预算执行器（Q03）— 服务端强制执行，不信任 Provider 或客户端自报。
 *
 * ## 记账口径
 *
 * - usage 事件按「最后一次到达」记账（与 turn-engine 的终态一致性校验一致）；
 * - Provider usage 全零视为缺失：输入用请求正文估算、输出用本轮实际文本字符
 *   估算，并标记 `estimated=true`（保守估算，宁多算不少算）；
 * - 模型调用数按 attempt 计数：重试计入调用与时间预算（Q03 要求）；
 * - wall-clock 自控制器创建（LOOP 开始）起算；
 * - 货币成本用服务端冻结定价表换算为美分，不暴露价格密钥。
 *
 * ## 检查点
 *
 * | 时机 | 检查 |
 * |------|------|
 * | 每次模型调用尝试前 | 调用数、wall-clock、输入 token（含本轮估算）、累计成本 |
 * | 每次 run 收敛后 | 输入/输出 token、累计成本、wall-clock 复查 |
 * | 每批工具执行前 | 工具调用数（投影） |
 * | 每个工具结果落地时 | 单结果估算 token 上限，超出按截断协议处理 |
 *
 * 截断协议：保留前 `maxToolResultTokens × CHARS_PER_TOKEN` 字符，追加稳定
 * 标记（只含保留字符数，不含正文），被截断的正文不再喂给模型。
 */
export class TurnUsageBudgetController {
  private modelCalls = 0;
  private toolCalls = 0;
  private toolResultsTruncated = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private estimatedCostCents = 0;
  private estimated = false;
  /** 上一次 run 收敛时的累计文本字符数，用于估算本轮输出。 */
  private lastCumulativeTextCharacters = 0;
  private pendingEstInputTokens = 0;
  private pendingModelKey: keyof typeof turnPricingPerMillionTokens = 'fast';
  private pendingUsage: ModelUsage | null = null;
  private readonly startedAtMs: number;

  constructor(
    private readonly budget: TurnUsageBudget,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.startedAtMs = now();
  }

  private wallClockMs(): number {
    return this.now() - this.startedAtMs;
  }

  /** 每次模型调用尝试前（含重试）。返回 reason 表示超预算，调用方必须以 BUDGET_EXCEEDED 终止。 */
  checkBeforeModelCall(input: {
    run: number;
    attempt: number;
    request: StreamAgentTextRequest;
  }): BudgetBreachReason | null {
    if (this.modelCalls + 1 > this.budget.maxModelCalls) {
      return 'max_model_calls';
    }
    if (this.wallClockMs() > this.budget.maxWallClockMs) {
      return 'max_wall_clock';
    }
    this.pendingEstInputTokens = estimateRequestInputTokens(input.request);
    // Turn 循环只用 primary/fast 档位；其余档位按 unknown 最高价保守估算。
    this.pendingModelKey =
      input.request.modelAlias === 'primary' ||
      input.request.modelAlias === 'fast'
        ? input.request.modelAlias
        : 'unknown';
    if (
      this.inputTokens + this.pendingEstInputTokens >
      this.budget.maxInputTokens
    ) {
      return 'max_input_tokens';
    }
    if (this.estimatedCostCents >= this.budget.maxEstimatedCostCents) {
      return 'max_estimated_cost';
    }
    // 预检通过即计一次调用：attempt 口径，重试也占用预算。
    this.modelCalls += 1;
    return null;
  }

  /** usage 事件到达时记账：最后一次到达为准（与终态 metadata 一致性校验一致）。 */
  observeUsage(usage: ModelUsage): void {
    this.pendingUsage = usage;
  }

  /**
   * 每次 run 收敛后（成功）复查累计量。失败 run 交给其自身失败码，
   * 预算复查由下一次调用尝试的预检承担。
   */
  checkAfterModelRun(input: {
    run: number;
    ok: boolean;
    textCharacters: number;
  }): BudgetBreachReason | null {
    if (!input.ok) return null;
    const usage = this.pendingUsage;
    const outputDelta = Math.max(
      0,
      input.textCharacters - this.lastCumulativeTextCharacters,
    );
    this.lastCumulativeTextCharacters = input.textCharacters;
    this.pendingUsage = null;

    if (usage === null || usageMissing(usage)) {
      /* Provider usage 缺失：输入用请求正文估算（预检时已缓存），
         输出用本轮实际文本字符估算；标记 estimated。 */
      this.estimated = true;
      this.inputTokens += this.pendingEstInputTokens;
      const estimatedOutput = estimateTokensFromText('x'.repeat(outputDelta));
      this.outputTokens += estimatedOutput;
      this.estimatedCostCents += estimateUsageCostUsdCents(
        {
          inputTokens: this.pendingEstInputTokens,
          outputTokens: estimatedOutput,
          cacheHitTokens: 0,
          reasoningTokens: 0,
        },
        this.pendingModelKey,
      );
    } else {
      this.inputTokens += usage.inputTokens;
      this.outputTokens += usage.outputTokens;
      this.estimatedCostCents += estimateUsageCostUsdCents(
        usage,
        this.pendingModelKey,
      );
    }
    this.pendingEstInputTokens = 0;

    if (this.inputTokens > this.budget.maxInputTokens) {
      return 'max_input_tokens';
    }
    if (this.outputTokens > this.budget.reservedOutputTokens) {
      return 'max_output_tokens';
    }
    if (this.estimatedCostCents > this.budget.maxEstimatedCostCents) {
      return 'max_estimated_cost';
    }
    if (this.wallClockMs() > this.budget.maxWallClockMs) {
      return 'max_wall_clock';
    }
    return null;
  }

  /** 每批工具执行前：投影检查（已执行 + 本批待执行）。 */
  checkBeforeToolExecution(input: {
    calls: readonly { callId: string; tool: string }[];
  }): BudgetBreachReason | null {
    if (this.toolCalls + input.calls.length > this.budget.maxToolCalls) {
      return 'max_tool_calls';
    }
    return null;
  }

  /**
   * 工具结果落地（喂回模型前）：逐条计数并按协议截断超限结果。
   * 返回可安全喂给模型的副本；未超限时原样返回。
   */
  observeToolResult(result: ModelToolResult): ModelToolResult {
    this.toolCalls += 1;
    const text = serializeToolOutput(result.output);
    if (estimateTokensFromText(text) <= this.budget.maxToolResultTokens) {
      return result;
    }
    this.toolResultsTruncated += 1;
    const keptChars = this.budget.maxToolResultTokens * CHARS_PER_TOKEN;
    const kept = text.slice(0, keptChars);
    return {
      ...result,
      output: `${kept}\n\n[工具结果过长已截断：保留 ${kept.length} 字符]`,
    };
  }

  /** 每次 Turn 结束时的账本快照（无 operationId/profileId/breachReason，由调用方补齐）。 */
  snapshot(): Omit<
    TurnUsageBudgetLedgerEntry,
    'operationId' | 'profileId' | 'breachReason'
  > {
    return {
      estimated: this.estimated,
      estimatedCostCents: this.estimatedCostCents,
      modelCalls: this.modelCalls,
      toolCalls: this.toolCalls,
      toolResultsTruncated: this.toolResultsTruncated,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      wallClockMs: this.wallClockMs(),
    };
  }
}
