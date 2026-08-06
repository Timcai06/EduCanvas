import { describe, expect, it } from 'vitest';
import type { ModelUsage, StreamTurnTextRequest } from '@educanvas/agent-core';
import { TurnUsageBudgetController } from './turn-usage-budget-controller';

const baseBudget = {
  maxInputTokens: 10_000,
  reservedOutputTokens: 1_000,
  maxModelCalls: 3,
  maxToolCalls: 3,
  maxToolResultTokens: 1_000,
  maxWallClockMs: 60_000,
  maxEstimatedCostCents: 100,
};

const request = (
  overrides: Partial<StreamTurnTextRequest> = {},
): StreamTurnTextRequest => ({
  taskAlias: 'teaching.turn',
  modelAlias: 'primary',
  promptVersion: '1.0.0',
  phase: 'answer',
  messages: [{ role: 'user', content: '你好' }],
  tools: [],
  toolResults: [],
  traceId: 'trace-1',
  turnId: 'turn-1',
  ...overrides,
});

const fakeClock = (start: number) => {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

describe('TurnUsageBudgetController（Q03）', () => {
  it('模型调用按 attempt 计数：超过 maxModelCalls 后预检拒绝', () => {
    const budget = { ...baseBudget, maxModelCalls: 2 };
    const controller = new TurnUsageBudgetController(budget);
    expect(
      controller.checkBeforeModelCall({
        run: 1,
        attempt: 0,
        request: request(),
      }),
    ).toBeNull();
    expect(
      controller.checkBeforeModelCall({
        run: 1,
        attempt: 1,
        request: request(),
      }),
    ).toBeNull();
    // 第三次调用尝试被拒绝：重试也计入调用预算。
    expect(
      controller.checkBeforeModelCall({
        run: 2,
        attempt: 0,
        request: request(),
      }),
    ).toBe('max_model_calls');
    expect(controller.snapshot().modelCalls).toBe(2);
  });

  it('wall-clock 超限后预检与收敛复查都会拒绝', () => {
    const clock = fakeClock(0);
    const budget = { ...baseBudget, maxWallClockMs: 1_000 };
    const controller = new TurnUsageBudgetController(budget, clock.now);
    expect(
      controller.checkBeforeModelCall({
        run: 1,
        attempt: 0,
        request: request(),
      }),
    ).toBeNull();
    clock.advance(1_001);
    expect(
      controller.checkBeforeModelCall({
        run: 2,
        attempt: 0,
        request: request(),
      }),
    ).toBe('max_wall_clock');
    // 即使 run 成功收敛，复查也会因为超时拒绝。
    expect(
      controller.checkAfterModelRun({ run: 2, ok: true, textCharacters: 100 }),
    ).toBe('max_wall_clock');
  });

  it('请求正文估算超输入预算时预检拒绝', () => {
    const budget = { ...baseBudget, maxInputTokens: 10 };
    const controller = new TurnUsageBudgetController(budget);
    const longText = 'x'.repeat(100); // 100 字符 → 25 token > 10
    expect(
      controller.checkBeforeModelCall({
        run: 1,
        attempt: 0,
        request: request({
          messages: [
            { role: 'user', content: longText },
            { role: 'assistant', content: '回答' },
          ],
        }),
      }),
    ).toBe('max_input_tokens');
  });

  it('Provider usage 缺失时用保守估算记账并标记 estimated', () => {
    const budget = { ...baseBudget, reservedOutputTokens: 10_000 };
    const controller = new TurnUsageBudgetController(budget);
    expect(
      controller.checkBeforeModelCall({
        run: 1,
        attempt: 0,
        request: request(),
      }),
    ).toBeNull();
    // 无 usage 事件：收敛后按请求正文估算输入、按文本增量估算输出。
    // 20_000 字符 → 5_000 token，估算成本 0.75 美分（取整后 > 0）。
    expect(
      controller.checkAfterModelRun({
        run: 1,
        ok: true,
        textCharacters: 20_000,
      }),
    ).toBeNull();
    const snapshot = controller.snapshot();
    expect(snapshot.estimated).toBe(true);
    // 输入：'你好'（2 字符）→ 1 token；输出：20_000 字符 → 5_000 token。
    expect(snapshot.inputTokens).toBe(1);
    expect(snapshot.outputTokens).toBe(5_000);
    expect(snapshot.estimatedCostCents).toBeGreaterThan(0);
  });

  it('Provider usage 正常时精确记账且不标记 estimated', () => {
    const controller = new TurnUsageBudgetController(baseBudget);
    expect(
      controller.checkBeforeModelCall({
        run: 1,
        attempt: 0,
        request: request(),
      }),
    ).toBeNull();
    const usage: ModelUsage = {
      inputTokens: 500,
      outputTokens: 100,
      cacheHitTokens: 0,
      reasoningTokens: 0,
    };
    controller.observeUsage(usage);
    expect(
      controller.checkAfterModelRun({ run: 1, ok: true, textCharacters: 120 }),
    ).toBeNull();
    const snapshot = controller.snapshot();
    expect(snapshot.estimated).toBe(false);
    expect(snapshot.inputTokens).toBe(500);
    expect(snapshot.outputTokens).toBe(100);
  });

  it('输出累计超过预留输出 token 时拒绝', () => {
    const budget = { ...baseBudget, reservedOutputTokens: 10 };
    const controller = new TurnUsageBudgetController(budget);
    expect(
      controller.checkBeforeModelCall({
        run: 1,
        attempt: 0,
        request: request(),
      }),
    ).toBeNull();
    expect(
      controller.checkAfterModelRun({ run: 1, ok: true, textCharacters: 100 }),
    ).toBe('max_output_tokens');
  });

  it('单次调用估算成本超预算在收敛复查时拒绝', () => {
    // 输入预算放宽到 300k token 只压成本：800_000 字符 → 200_000 token
    // → 200_000 × $0.5/M × 100 = 10 美分 > 1 美分预算。
    const budget = {
      ...baseBudget,
      maxInputTokens: 300_000,
      maxEstimatedCostCents: 1,
    };
    const controller = new TurnUsageBudgetController(budget);
    const expensiveRequest = request({
      messages: [{ role: 'user', content: 'x'.repeat(800_000) }],
    });
    // 预检时累计成本还是 0：放行，由收敛复查兜底。
    expect(
      controller.checkBeforeModelCall({
        run: 1,
        attempt: 0,
        request: expensiveRequest,
      }),
    ).toBeNull();
    expect(
      controller.checkAfterModelRun({ run: 1, ok: true, textCharacters: 0 }),
    ).toBe('max_estimated_cost');
  });

  it('累计成本恰好达到上限后，下一次预检即拒绝', () => {
    // 200_000 token 输入正好 10 美分（primary $0.5/M），等于预算上限。
    const budget = {
      ...baseBudget,
      maxInputTokens: 300_000,
      maxEstimatedCostCents: 10,
    };
    const controller = new TurnUsageBudgetController(budget);
    expect(
      controller.checkBeforeModelCall({
        run: 1,
        attempt: 0,
        request: request({
          messages: [{ role: 'user', content: 'x'.repeat(800_000) }],
        }),
      }),
    ).toBeNull();
    // 收敛复查：10 美分 == 上限（非超），放行。
    expect(
      controller.checkAfterModelRun({ run: 1, ok: true, textCharacters: 0 }),
    ).toBeNull();
    // 下一次调用：累计成本已 == 上限，预检拒绝。
    expect(
      controller.checkBeforeModelCall({
        run: 2,
        attempt: 0,
        request: request(),
      }),
    ).toBe('max_estimated_cost');
  });

  it('工具调用按批次投影检查：执行数 + 待执行数超限即拒绝', () => {
    const budget = { ...baseBudget, maxToolCalls: 2 };
    const controller = new TurnUsageBudgetController(budget);
    const result = {
      callId: 'c1',
      tool: 'search',
      arguments: {},
      output: 'ok',
    };
    controller.observeToolResult(result);
    controller.observeToolResult(result);
    // 已执行 2 个 + 本批 1 个 = 3 > 2。
    expect(
      controller.checkBeforeToolExecution({
        calls: [{ callId: 'c3', tool: 'search' }],
      }),
    ).toBe('max_tool_calls');
  });

  it('超限工具结果按截断协议替换，未超限原样返回', () => {
    const budget = { ...baseBudget, maxToolResultTokens: 2 }; // 2 token → 8 字符
    const controller = new TurnUsageBudgetController(budget);
    const underLimit = {
      callId: 'c1',
      tool: 'search',
      arguments: {},
      output: 'short',
    };
    expect(controller.observeToolResult(underLimit)).toBe(underLimit);

    const overLimit = {
      callId: 'c2',
      tool: 'search',
      arguments: {},
      output: 'x'.repeat(100),
    };
    const observed = controller.observeToolResult(overLimit);
    expect(typeof observed.output).toBe('string');
    const text = observed.output as string;
    expect(text.startsWith('x'.repeat(8))).toBe(true);
    expect(text).toContain('[工具结果过长已截断');
    expect(text).not.toContain('x'.repeat(20)); // 正文尾部不再喂给模型
    const snapshot = controller.snapshot();
    expect(snapshot.toolCalls).toBe(2);
    expect(snapshot.toolResultsTruncated).toBe(1);
  });

  it('失败 run 不记账，也不影响后续成功 run 的收敛复查', () => {
    const controller = new TurnUsageBudgetController(baseBudget);
    expect(
      controller.checkAfterModelRun({ run: 1, ok: false, textCharacters: 50 }),
    ).toBeNull();
    expect(
      controller.checkBeforeModelCall({
        run: 2,
        attempt: 0,
        request: request(),
      }),
    ).toBeNull();
    expect(
      controller.checkAfterModelRun({ run: 2, ok: true, textCharacters: 50 }),
    ).toBeNull();
    const snapshot = controller.snapshot();
    // 失败 run 没有记入调用数；文本增量只计成功 run 的部分。
    expect(snapshot.modelCalls).toBe(1);
    expect(snapshot.outputTokens).toBe(Math.ceil(50 / 4));
  });
});
