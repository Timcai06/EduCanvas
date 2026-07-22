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

/** @internal 创建或复用Tool Call，并路由到审批准备或真实调用。 */
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
