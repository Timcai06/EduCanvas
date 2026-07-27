import type {
  AgentToolCallLedgerPort,
  ToolEffectLedgerPort,
} from '@educanvas/agent-core';
import { invokeToolAdapter } from './adapter-invocation';
import { prepareToolApproval } from './approval';
import type {
  AnyToolKernelAdapter,
  ToolKernelExecuteRequest,
  ToolKernelResult,
} from './contracts';
import { toolFailure } from './result';

/**
 * @internal 工具调用生命周期编排。
 *
 * ## 路由逻辑
 *
 * ```
 * createOrGet Tool Call →
 *   ├─ 已重放 + 非 pending → 拒绝（result_replay_required / execution_in_progress）
 *   ├─ 已取消 → 记录 tool_cancelled 并返回
 *   ├─ L2/L3 + 未审批 → prepareApproval（挂起等用户确认）
 *   └─ 其他 → invoke（实际执行）
 * ```
 *
 * createOrGet 在 Tool Call Ledger 中原子创建或查找已有的 tool call 记录。
 * 同一 executionId 的重复请求不会创建第二条记录。
 */
export async function executeToolLifecycle(input: {
  adapter: AnyToolKernelAdapter;
  parsedInput: never;
  request: ToolKernelExecuteRequest;
  semanticsHash: string;
  callLedger: AgentToolCallLedgerPort;
  effectLedger: ToolEffectLedgerPort;
  now: () => Date;
}): Promise<ToolKernelResult> {
  const common = {
    operationId: input.request.context.operationId,
    actorId: input.request.context.actorId,
  };
  const created = await input.callLedger.createOrGet({
    ...common,
    answerModelRunId: input.request.context.answerModelRunId,
    providerToolCallId: input.request.context.providerToolCallId,
    executionId: input.request.context.executionId,
    toolName: input.adapter.name,
    exposure: input.adapter.exposure,
    effect: input.adapter.effect,
    arguments: input.request.arguments,
  });
  const approvalRisk =
    input.adapter.risk === 'l2' || input.adapter.risk === 'l3'
      ? input.adapter.risk
      : null;
  const requiresApproval =
    approvalRisk !== null &&
    !input.request.context.approvedCapabilities.includes(
      input.adapter.capability,
    );
  if (
    created.replayed &&
    (!requiresApproval || created.call.status !== 'pending')
  ) {
    return toolFailure(
      input.adapter.name,
      'failed',
      created.call.status === 'pending' || created.call.status === 'running'
        ? 'execution_in_progress'
        : 'result_replay_required',
      false,
    );
  }
  if (input.request.signal?.aborted) {
    await input.callLedger.settle({
      ...common,
      toolCallId: created.call.id,
      status: 'failed',
      code: 'tool_cancelled',
      retryable: false,
      durationMs: 0,
    });
    return toolFailure(
      input.adapter.name,
      'cancelled',
      'tool_cancelled',
      false,
    );
  }
  if (requiresApproval && approvalRisk) {
    return prepareToolApproval({
      adapter: input.adapter,
      parsedInput: input.parsedInput,
      request: input.request,
      call: created.call,
      replayed: created.replayed,
      risk: approvalRisk,
      callLedger: input.callLedger,
      now: input.now,
    });
  }
  return invokeToolAdapter({
    adapter: input.adapter,
    parsedInput: input.parsedInput,
    request: input.request,
    call: created.call,
    semanticsHash: input.semanticsHash,
    callLedger: input.callLedger,
    effectLedger: input.effectLedger,
  });
}
