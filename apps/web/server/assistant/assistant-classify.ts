import 'server-only';

import { randomUUID } from 'node:crypto';
import type {
  BudgetBreachReason,
  TurnModelGateway,
  TurnUsageBudgetLedgerPort,
} from '@educanvas/agent-core';
import { TURN_USAGE_BUDGET_TEMPLATES } from '@educanvas/agent-core';
import { TurnUsageBudgetController } from '@educanvas/agent-runtime';
import { DrizzleTurnUsageBudgetLedger } from '@educanvas/db';
import { resolveTurnModelRuntime } from '@/server/model/model-runtime';
import {
  buildClassifyRequest,
  collectModelText,
  parseIntent,
  type AssistantIntent,
} from './classify-intent';

/** 桌宠分类的稳定错误码：预算超限与模型不可用分开，供路由映射状态码。 */
export class AssistantClassifyError extends Error {
  constructor(
    readonly code: 'model_unavailable' | 'model_failed' | 'budget_exceeded',
  ) {
    super(code);
  }
}

/** runClassifiedTurn 的依赖形状；测试注入 fake，路由经组合点获取真实实现。 */
export interface AssistantClassifyDependencies {
  /** 未配置模型路由时为 null（路由转 503，诚实失败）。 */
  gateway: TurnModelGateway | null;
  /** Q03 预算账本：每次桌宠请求一行（turn_usage_budget_outcomes）。 */
  usageBudgetLedger: TurnUsageBudgetLedgerPort;
  /** 时间源注入点（测试固定 wall-clock）。 */
  now?: () => number;
}

/**
 * Web 组合点：路由的唯一依赖来源。
 *
 * 桌宠的分类是一次无状态模型调用，不走完整 Turn 管线；但预算语义必须与
 * 主对话一致：同一份 agent.turn 模板 + 同一套检查点 + 同一张预算账本。
 * 模型 run 级账本（agent-model-runs）强绑定 Turn 管线的 operation/消息
 * 生命周期，桌宠不产生对话消息，故不接入（见 #292 审视记录）。
 */
export function createAssistantClassifyDependencies(): AssistantClassifyDependencies {
  return {
    gateway: resolveTurnModelRuntime()?.gateway ?? null,
    usageBudgetLedger: new DrizzleTurnUsageBudgetLedger(),
  };
}

export interface ClassifyTurnInput {
  text: string;
  notebooks: { id: string; title: string }[];
}

/**
 * 受预算控制的桌宠意图分类调用。
 *
 * - 预算：`TurnUsageBudgetController`（agent.turn 模板），调用前检查
 *   （调用数/wall-clock/输入 token/累计成本）、收敛后复查（输出 token/
 *   成本），超限抛 `budget_exceeded`（稳定终态，不伪装为成功）；
 * - 账本：每次请求一行 `turn_usage_budget_outcomes`，只含维度数值与
 *   低基数 breachReason，正文/Prompt/供应商响应永不落库；记录失败是
 *   尽力而为的观测动作，不改变结果；
 * - 失败尝试同样记账（token/成本必须进账本，终态由模型错误决定）；
 * - 用量口径：分类输出极短，统一走控制器估算（estimated=true，比主对话
 *   的 provider 优先口径更保守），不解析流式 metadata。
 */
export async function runClassifiedTurn(
  input: ClassifyTurnInput,
  deps: AssistantClassifyDependencies,
): Promise<AssistantIntent> {
  const gateway = deps.gateway;
  if (!gateway) throw new AssistantClassifyError('model_unavailable');

  const controller = new TurnUsageBudgetController(
    TURN_USAGE_BUDGET_TEMPLATES['agent.turn'],
    deps.now,
  );
  const operationId = randomUUID();
  const request = buildClassifyRequest(input.text, input.notebooks);

  const recordOutcome = (breachReason: BudgetBreachReason | null): void => {
    void deps.usageBudgetLedger
      .record({
        operationId,
        profileId: 'assistant.classify',
        breachReason,
        ...controller.snapshot(),
      })
      .catch(() => {});
  };

  let breach = controller.checkBeforeModelCall({
    run: 1,
    attempt: 1,
    request,
  });
  if (breach !== null) {
    recordOutcome(breach);
    throw new AssistantClassifyError('budget_exceeded');
  }

  let raw: string;
  try {
    raw = await collectModelText(request, gateway);
  } catch {
    controller.checkAfterModelRun({ run: 1, ok: false, textCharacters: 0 });
    recordOutcome(null);
    throw new AssistantClassifyError('model_failed');
  }

  breach = controller.checkAfterModelRun({
    run: 1,
    ok: true,
    textCharacters: raw.length,
  });
  recordOutcome(breach);
  if (breach !== null) throw new AssistantClassifyError('budget_exceeded');
  return parseIntent(raw);
}
