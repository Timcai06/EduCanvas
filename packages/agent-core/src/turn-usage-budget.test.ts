import { describe, expect, it } from 'vitest';
import {
  TURN_USAGE_BUDGET_TEMPLATES,
  budgetBreachReasons,
  estimateTokensFromText,
  estimateUsageCostUsdCents,
  turnPricingPerMillionTokens,
  turnUsageBudgetSchema,
  usageMissing,
  type BudgetBreachReason,
} from './turn-usage-budget';

describe('Turn usage budget 契约（Q03）', () => {
  it('超预算原因恰好是 7 个冻结维度，不随实现漂移', () => {
    expect(budgetBreachReasons).toEqual([
      'max_input_tokens',
      'max_output_tokens',
      'max_model_calls',
      'max_tool_calls',
      'max_tool_result_tokens',
      'max_wall_clock',
      'max_estimated_cost',
    ]);
    // 编译期穷举守卫：全部 reason 可映射为稳定标签。
    const labelOf = (reason: BudgetBreachReason): string => {
      switch (reason) {
        case 'max_input_tokens':
          return 'input';
        case 'max_output_tokens':
          return 'output';
        case 'max_model_calls':
          return 'calls';
        case 'max_tool_calls':
          return 'tools';
        case 'max_tool_result_tokens':
          return 'tool result';
        case 'max_wall_clock':
          return 'time';
        case 'max_estimated_cost':
          return 'cost';
      }
    };
    for (const reason of budgetBreachReasons) {
      expect(labelOf(reason).length).toBeGreaterThan(0);
    }
  });

  it('模板覆盖 teaching 与 agent 两个 Turn 任务类型且数值冻结', () => {
    const teaching = TURN_USAGE_BUDGET_TEMPLATES['teaching.turn'];
    const agent = TURN_USAGE_BUDGET_TEMPLATES['agent.turn'];
    for (const template of [teaching, agent]) {
      expect(turnUsageBudgetSchema.parse(template)).toEqual(template);
    }
    // 教学 Turn 更紧、通用 Turn 更松：预算模板确实按任务类型区分。
    expect(teaching.maxModelCalls).toBeLessThan(agent.maxModelCalls);
    expect(teaching.maxInputTokens).toBeLessThan(agent.maxInputTokens);
    expect(teaching.maxWallClockMs).toBeLessThan(agent.maxWallClockMs);
    expect(teaching.maxEstimatedCostCents).toBeLessThan(
      agent.maxEstimatedCostCents,
    );
  });

  it('未知模型档位按最高价保守估算，成本换算可复算', () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheHitTokens: 0,
      reasoningTokens: 0,
    };
    // primary 输入 $0.5/M → 50 美分
    expect(estimateUsageCostUsdCents(usage, 'primary')).toBe(50);
    // unknown 输入 $2/M → 200 美分（保守上限）
    expect(estimateUsageCostUsdCents(usage, 'unknown')).toBe(200);
    // fast 输入 $0.15/M → 15 美分
    expect(estimateUsageCostUsdCents(usage, 'fast')).toBe(15);
    expect(turnPricingPerMillionTokens.unknown.inputUsd).toBeGreaterThan(
      turnPricingPerMillionTokens.primary.inputUsd,
    );
  });

  it('usage 全零视为缺失，估算 token 为字符数/4 上取整', () => {
    expect(
      usageMissing({
        inputTokens: 0,
        outputTokens: 0,
        cacheHitTokens: 0,
        reasoningTokens: 0,
      }),
    ).toBe(true);
    expect(
      usageMissing({
        inputTokens: 1,
        outputTokens: 0,
        cacheHitTokens: 0,
        reasoningTokens: 0,
      }),
    ).toBe(false);
    expect(estimateTokensFromText('abcd')).toBe(1);
    expect(estimateTokensFromText('abcde')).toBe(2);
    expect(estimateTokensFromText('')).toBe(0);
  });
});
