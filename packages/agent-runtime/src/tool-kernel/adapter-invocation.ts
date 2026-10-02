import type {
  AgentToolCallLedgerPort,
  AgentToolCallSnapshot,
  ToolEffectLedgerPort,
} from '@educanvas/agent-core';
import type {
  AnyToolKernelAdapter,
  ToolKernelExecuteRequest,
  ToolKernelResult,
} from './contracts';
import {
  createExecutionControl,
  ToolCancelledError,
  ToolTimeoutError,
} from './execution-control';
import { buildInvocationContext } from './invocation-context';
import { toolFailure } from './result';

/** @internal 执行已授权Adapter并原子收敛调用账本与副作用账本。 */
export async function invokeToolAdapter(input: {
  adapter: AnyToolKernelAdapter;
  parsedInput: never;
  request: ToolKernelExecuteRequest;
  call: AgentToolCallSnapshot;
  semanticsHash: string;
  callLedger: AgentToolCallLedgerPort;
  effectLedger: ToolEffectLedgerPort;
}): Promise<ToolKernelResult> {
  const common = {
    operationId: input.request.context.operationId,
    actorId: input.request.context.actorId,
  };
  let effect: Awaited<ReturnType<ToolEffectLedgerPort['intend']>> | null = null;
  let invocationStarted = false;
  const control = createExecutionControl(
    input.adapter.timeoutMs,
    input.request.signal,
  );
  const startedAt = Date.now();
  try {
    await input.callLedger.markRunning({
      ...common,
      toolCallId: input.call.id,
    });
    effect =
      input.adapter.effect === 'write'
        ? await input.effectLedger.intend({
            ...common,
            toolCallId: input.call.id,
            effectKey: input.request.context.executionId,
            semanticsHash: input.semanticsHash,
            reconciliationVerifierId:
              input.adapter.reconciliationVerifierId ?? null,
          })
        : null;
    invocationStarted = true;
    const output = await Promise.race([
      input.adapter.invoke(
        input.parsedInput,
        buildInvocationContext(input.request, control.signal),
      ),
      control.timeout,
      control.cancellation,
    ]);
    const parsedOutput = input.adapter.outputSchema.safeParse(output);
    if (effect) {
      await input.effectLedger.settle({
        ...common,
        effectId: effect.effect.id,
        status: 'committed',
      });
    }
    if (!parsedOutput.success) {
      await input.callLedger.settle({
        ...common,
        toolCallId: input.call.id,
        status: 'failed',
        code: 'invalid_output',
        durationMs: Date.now() - startedAt,
      });
      return toolFailure(input.adapter.name, 'failed', 'invalid_output', false);
    }
    await input.callLedger.settle({
      ...common,
      toolCallId: input.call.id,
      status: 'succeeded',
      durationMs: Date.now() - startedAt,
      result: parsedOutput.data,
    });
    return {
      ok: true,
      status: 'succeeded',
      tool: input.adapter.name,
      output: parsedOutput.data,
      replayed: false,
    };
  } catch (error) {
    return settleInvocationFailure({
      ...input,
      common,
      effect,
      invocationStarted,
      error,
      startedAt,
    });
  } finally {
    control.dispose();
  }
}

async function settleInvocationFailure(input: {
  adapter: AnyToolKernelAdapter;
  call: AgentToolCallSnapshot;
  callLedger: AgentToolCallLedgerPort;
  effectLedger: ToolEffectLedgerPort;
  common: { operationId: string; actorId: string };
  effect: Awaited<ReturnType<ToolEffectLedgerPort['intend']>> | null;
  invocationStarted: boolean;
  error: unknown;
  startedAt: number;
}): Promise<ToolKernelResult> {
  // Once dispatch begins, an arbitrary adapter throw does not prove that a write
  // had no external effect. Only pre-dispatch ledger failures are safe to classify
  // as a known failure.
  const uncertainWrite =
    input.adapter.effect === 'write' && input.invocationStarted;
  if (input.effect) {
    await input.effectLedger.settle({
      ...input.common,
      effectId: input.effect.effect.id,
      status: uncertainWrite ? 'outcome_unknown' : 'failed',
      code: uncertainWrite ? 'write_outcome_unknown' : 'ledger_unavailable',
    });
  }
  await input.callLedger.settle({
    ...input.common,
    toolCallId: input.call.id,
    status: uncertainWrite ? 'outcome_unknown' : 'failed',
    code: uncertainWrite
      ? 'write_outcome_unknown'
      : !input.invocationStarted
        ? 'ledger_unavailable'
        : input.error instanceof ToolTimeoutError
          ? 'tool_timeout'
          : input.error instanceof ToolCancelledError
            ? 'tool_cancelled'
            : 'tool_failed',
    retryable:
      input.invocationStarted &&
      !uncertainWrite &&
      (input.error instanceof ToolTimeoutError ||
        input.error instanceof ToolCancelledError),
    durationMs: Date.now() - input.startedAt,
  });
  if (uncertainWrite) {
    return toolFailure(
      input.adapter.name,
      'outcome_unknown',
      'write_outcome_unknown',
      false,
    );
  }
  if (!input.invocationStarted) {
    return toolFailure(
      input.adapter.name,
      'failed',
      'ledger_unavailable',
      false,
    );
  }
  if (input.error instanceof ToolTimeoutError) {
    return toolFailure(input.adapter.name, 'timed_out', 'tool_timeout', true);
  }
  if (input.error instanceof ToolCancelledError) {
    return toolFailure(input.adapter.name, 'cancelled', 'tool_cancelled', true);
  }
  return toolFailure(input.adapter.name, 'failed', 'tool_failed', false);
}
