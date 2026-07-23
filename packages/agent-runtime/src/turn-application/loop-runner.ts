import type {
  NormalizedModelError,
  TurnApplicationCommand,
  TurnApplicationEvent,
  TurnApplicationFailureCode,
  W3cTraceCarrier,
} from '@educanvas/agent-core';
import { turnApplicationProtocolVersion } from '@educanvas/agent-core';
import { AgentLoopEngine } from '../agent-loop';
import type { TurnApplicationDependencies } from './dependencies';
import { validGuardDeltas, validPublicDelta } from './helpers';
import {
  AuditedModelRunLifecycle,
  type ModelRunContext,
} from './model-run-lifecycle';
import type {
  TurnApplicationCancellationHandle,
  TurnApplicationLifecycleSnapshot,
  TurnApplicationOutputGuardPort,
  TurnApplicationOutputGuardPushResult,
} from './ports';
import type { PreparedTurnApplication } from './preparation';
import {
  TurnToolExecutor,
  type TurnToolDetail,
  type TurnToolFailure,
} from './tool-executor';

/** @internal 模型/工具循环结束后的唯一决策材料，不含正文之外的敏感载荷。 */
export interface TurnLoopOutcome {
  answer: string;
  completed: boolean;
  modelFailure: NormalizedModelError | null;
  toolFailure: TurnToolFailure | null;
  outputBlocked: TurnApplicationFailureCode | null;
  outputGuardFailed: boolean;
}

/**
 * @internal 流式投影唯一 Agent Loop — 产出非终态公开事件并返回收敛材料。
 *
 * ## Output Guard 四态处理
 *
 * 每个 text_delta 在 yield 给客户端前经过 output guard 过滤：
 *
 * | Guard 返回 | 行为 |
 * |-----------|------|
 * | `hold` | 暂不发送，累积在 guard 内部缓冲区。不改变 answer |
 * | `emit{ safeDeltas }` | 验证后追加到 answer 并 yield。最常见路径 |
 * | `block{ publicContent, failureCode }` | 用预设安全文案替换被拦截内容，abort 模型运行 |
 * | 异常 | outputGuardFailed=true，abort 模型运行 |
 *
 * ## 终态收敛
 *
 * Agent Loop 的四种终态映射为 TurnLoopOutcome：
 *
 * | Loop 事件 | Outcome |
 * |-----------|---------|
 * | `completed` | completed=true |
 * | `failed` | modelFailure=error |
 * | `tool.failed` | toolFailure=failure（含审批） |
 * | `tool.result` | 正常 → 模型继续下一轮 |
 */
export async function* runTurnLoop(input: {
  dependencies: TurnApplicationDependencies;
  command: TurnApplicationCommand;
  turn: TurnApplicationLifecycleSnapshot;
  prepared: PreparedTurnApplication;
  cancellation: TurnApplicationCancellationHandle;
  controller: AbortController;
  traceCarrier: W3cTraceCarrier | null;
  outputGuard?: TurnApplicationOutputGuardPort;
}): AsyncGenerator<TurnApplicationEvent, TurnLoopOutcome> {
  const { dependencies, command, turn, prepared } = input;
  const modelLifecycle = new AuditedModelRunLifecycle(
    dependencies.modelRunLedger,
    { command, turn, cancellation: input.cancellation },
  );
  const tools = new TurnToolExecutor(
    command,
    prepared.toolPolicy,
    dependencies.toolKernel,
    input.controller.signal,
    input.traceCarrier,
  );
  let answer = '';
  let completed = false;
  let modelFailure: NormalizedModelError | null = null;
  let toolFailure: TurnToolFailure | null = null;
  let outputBlocked: TurnApplicationFailureCode | null = null;
  let outputGuardFailed = false;
  const loop = new AgentLoopEngine(dependencies.modelGateway);

  for await (const event of loop.stream<
    TurnToolDetail,
    TurnToolFailure,
    ModelRunContext
  >({
    traceId: command.traceId,
    turnId: command.operationId,
    answer: {
      taskAlias: prepared.model.taskAlias,
      modelAlias: prepared.model.modelAlias,
      promptVersion: prepared.model.promptVersion,
      messages: prepared.answerMessages,
      tools: prepared.toolDefinitions,
    },
    synthesis: {
      taskAlias: prepared.model.taskAlias,
      modelAlias: prepared.model.modelAlias,
      promptVersion:
        prepared.model.synthesisPromptVersion ?? prepared.model.promptVersion,
      messages: prepared.synthesisMessages,
    },
    maxToolRounds: prepared.model.maxToolRounds,
    signal: input.controller.signal,
    modelRunLifecycle: modelLifecycle,
    executeTools: (calls, context) => tools.execute(calls, context),
  })) {
    if (event.type === 'model' && event.event.type === 'text_delta') {
      if (outputBlocked || outputGuardFailed) continue; // 已拦截/异常 → 丢弃后续文本
      let guarded: TurnApplicationOutputGuardPushResult;
      try {
        guarded = input.outputGuard
          ? await input.outputGuard.push(event.event.delta)
          : { kind: 'emit', safeDeltas: [event.event.delta] };
      } catch {
        outputGuardFailed = true;
        input.controller.abort('profile_output_guard_failed');
        continue;
      }
      if (guarded.kind === 'hold') continue;
      if (guarded.kind === 'block') {
        if (!validPublicDelta(guarded.publicContent)) {
          outputGuardFailed = true;
          input.controller.abort('profile_output_guard_failed');
          continue;
        }
        const publicDelta = `${answer ? '\n\n' : ''}${guarded.publicContent}`;
        if (!validPublicDelta(publicDelta)) {
          outputGuardFailed = true;
          input.controller.abort('profile_output_guard_failed');
          continue;
        }
        answer += publicDelta;
        outputBlocked = guarded.failureCode;
        input.controller.abort('profile_output_blocked');
        yield {
          protocol: turnApplicationProtocolVersion,
          operationId: command.operationId,
          type: 'message.delta',
          messageId: turn.assistantMessageId,
          delta: publicDelta,
        };
        continue;
      }
      if (!validGuardDeltas(guarded.safeDeltas)) {
        outputGuardFailed = true;
        input.controller.abort('profile_output_guard_failed');
        continue;
      }
      for (const delta of guarded.safeDeltas) {
        answer += delta;
        yield {
          protocol: turnApplicationProtocolVersion,
          operationId: command.operationId,
          type: 'message.delta',
          messageId: turn.assistantMessageId,
          delta,
        };
      }
    } else if (event.type === 'tool.started') {
      if (outputBlocked || outputGuardFailed) continue;
      const id = tools.register(event.run, event.call);
      yield {
        protocol: turnApplicationProtocolVersion,
        operationId: command.operationId,
        type: 'tool.started',
        toolCallId: id,
        tool: tools.capabilityFor(event.call.tool),
      };
    } else if (event.type === 'tool.result') {
      if (outputBlocked || outputGuardFailed) continue;
      yield {
        protocol: turnApplicationProtocolVersion,
        operationId: command.operationId,
        type: 'tool.completed',
        toolCallId: event.result.detail.executionId,
      };
    } else if (event.type === 'tool.failed') {
      if (outputBlocked || outputGuardFailed) continue;
      toolFailure = event.failure;
      if (event.failure.approval) continue;
      yield {
        protocol: turnApplicationProtocolVersion,
        operationId: command.operationId,
        type: 'tool.failed',
        toolCallId: event.failure.executionId,
        code: event.failure.code,
        retryable: event.failure.retryable,
      };
    } else if (event.type === 'failed') {
      modelFailure = event.error;
    } else if (event.type === 'completed') {
      completed = true;
    }
  }

  return {
    answer,
    completed,
    modelFailure,
    toolFailure,
    outputBlocked,
    outputGuardFailed,
  };
}
