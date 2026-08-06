import { z } from 'zod';
import type { ModelUsage } from './model-contracts';

/**
 * Agent Turn 使用预算契约（Q03）。
 *
 * 预算由服务端决定：Profile 在 prepare 时把模板冻结进 `TurnApplicationProfilePlan`，
 * Turn Application 在 LOOP 阶段由 `TurnUsageBudgetController` 执行。
 * 维度对齐 Q03 计划：输入 token、预留输出 token、模型调用数、工具调用数、
 * 工具结果 token、wall-clock、估算货币成本。
 *
 * 边界纪律：
 * - 只携带维度数值，绝不携带 query/正文/供应商响应；
 * - 字符上限（MAX_RESPONSE_CHARACTERS 等）仍是兜底，但不再是主要成本语义；
 * - Provider usage 缺失时用 `estimateTokensFromText` 保守估算，并显式标记
 *   `estimated`；
 * - 超预算 → 稳定的 `BUDGET_EXCEEDED` 终态（不可伪装为成功）。
 */

/** 超预算原因的封闭低基数联合，可作 Trace/metric/账本标签。 */
export const budgetBreachReasons = [
  'max_input_tokens',
  'max_output_tokens',
  'max_model_calls',
  'max_tool_calls',
  'max_tool_result_tokens',
  'max_wall_clock',
  'max_estimated_cost',
] as const;

export type BudgetBreachReason = (typeof budgetBreachReasons)[number];

/** 工具结果截断协议的字符/估计 token 换算：1 token ≈ 4 字符（保守）。 */
export const CHARS_PER_TOKEN = 4;

/** 估算 token 数：字符数 / 4 向上取整，作为缺省 usage 的保守代理。 */
export function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export const turnUsageBudgetSchema = z
  .object({
    /** 本 Turn 累计输入 token 上限（Provider 报告；缺失时用估算并标记 estimated）。 */
    maxInputTokens: z.number().int().positive(),
    /** 本 Turn 累计输出 token 上限（预留输出）。 */
    reservedOutputTokens: z.number().int().positive(),
    /** 本 Turn 模型调用次数上限（含重试，每次 attempt 计一次）。 */
    maxModelCalls: z.number().int().positive(),
    /** 本 Turn 工具调用执行次数上限。 */
    maxToolCalls: z.number().int().positive(),
    /** 单次工具结果喂回模型的估算 token 上限；超出按截断协议处理。 */
    maxToolResultTokens: z.number().int().positive(),
    /** 本 Turn wall-clock 上限（自 LOOP 开始计时，毫秒）。 */
    maxWallClockMs: z.number().int().positive(),
    /** 本 Turn 估算货币成本上限（美分；估算表为服务端冻结 fixture，不暴露价格密钥）。 */
    maxEstimatedCostCents: z.number().int().positive(),
  })
  .strict();

export type TurnUsageBudget = z.infer<typeof turnUsageBudgetSchema>;

/**
 * 按任务类型冻结的预算模板（Q03 完成标准：General/Teaching 不同模板）。
 *
 * 数值是服务端决策的起步基线，随真实基线数据（Q07）再校准；变更必须同步
 * 修订记录，不能静默放松。
 */
export const TURN_USAGE_BUDGET_TEMPLATES = Object.freeze({
  'teaching.turn': Object.freeze({
    maxInputTokens: 40_000,
    reservedOutputTokens: 4_000,
    maxModelCalls: 8,
    maxToolCalls: 8,
    maxToolResultTokens: 4_000,
    maxWallClockMs: 60_000,
    maxEstimatedCostCents: 2,
  } satisfies TurnUsageBudget),
  'agent.turn': Object.freeze({
    maxInputTokens: 150_000,
    reservedOutputTokens: 12_000,
    maxModelCalls: 20,
    maxToolCalls: 16,
    maxToolResultTokens: 8_000,
    maxWallClockMs: 180_000,
    maxEstimatedCostCents: 10,
  } satisfies TurnUsageBudget),
} as const);

export type TurnUsageBudgetTemplateKey =
  keyof typeof TURN_USAGE_BUDGET_TEMPLATES;

/**
 * 每百万 token 的服务端定价 fixture（估算货币成本用）。
 *
 * 这不是价格密钥：是冻结在代码里的保守估算常量，只用于把 token 用量换算成
 * 预算内的美元美分数值；成本数值可进账本/Trace，定价表本身不外传。
 * `unknown` 取最高价，保证缺失定价信息时估算偏向保守（宁多算不少算）。
 */
export const turnPricingPerMillionTokens = Object.freeze({
  primary: Object.freeze({ inputUsd: 0.5, outputUsd: 1.5, cacheHitUsd: 0.05 }),
  fast: Object.freeze({ inputUsd: 0.15, outputUsd: 0.6, cacheHitUsd: 0.015 }),
  unknown: Object.freeze({ inputUsd: 2, outputUsd: 8, cacheHitUsd: 0.2 }),
} as const);

/** 把用量按模型档位换算为估算美分。 */
export function estimateUsageCostUsdCents(
  usage: ModelUsage,
  modelKey: keyof typeof turnPricingPerMillionTokens,
): number {
  const rate =
    turnPricingPerMillionTokens[modelKey] ??
    turnPricingPerMillionTokens.unknown;
  const usd =
    (usage.inputTokens * rate.inputUsd +
      usage.outputTokens * rate.outputUsd +
      usage.cacheHitTokens * rate.cacheHitUsd) /
    1_000_000;
  return Math.round(usd * 100);
}

/** 用量是否被视为「缺失」：Provider 全零时按缺失处理，改用保守估算。 */
export function usageMissing(usage: ModelUsage): boolean {
  return (
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.cacheHitTokens === 0 &&
    usage.reasoningTokens === 0
  );
}

/** 每次 Turn 结束写入预算账本的一行（Q03：预算事件进入账本）。 */
export interface TurnUsageBudgetLedgerEntry {
  operationId: string;
  profileId: string;
  /** null 表示预算内正常完成。 */
  breachReason: BudgetBreachReason | null;
  /** 本次 Turn 是否使用了估算（Provider usage 缺失时 true）。 */
  estimated: boolean;
  estimatedCostCents: number;
  modelCalls: number;
  toolCalls: number;
  toolResultsTruncated: number;
  inputTokens: number;
  outputTokens: number;
  wallClockMs: number;
}

/** 预算账本端口；实现由 db 层提供（turn_usage_budget_outcomes 表）。 */
export interface TurnUsageBudgetLedgerPort {
  record(entry: TurnUsageBudgetLedgerEntry): Promise<void>;
}
