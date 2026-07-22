import type {
  AgentToolCallLedgerPort,
  AgentToolCallSnapshot,
} from '@educanvas/agent-core';
import { z } from 'zod';
import type {
  AnyToolKernelAdapter,
  ToolKernelExecuteRequest,
  ToolKernelResult,
} from './contracts';
import {
  createExecutionControl,
  ToolCancelledError,
} from './execution-control';
import { buildInvocationContext } from './invocation-context';
import { toolFailure } from './result';

const preparationSchema = z
  .object({
    approvalId: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    summary: z.string().trim().min(1).max(500),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

/** @internal 为L2/L3调用准备耐久意图；此阶段绝不执行真实副作用。 */
export async function prepareToolApproval(input: {
  adapter: AnyToolKernelAdapter;
  parsedInput: never;
  request: ToolKernelExecuteRequest;
  call: AgentToolCallSnapshot;
  replayed: boolean;
  risk: 'l2' | 'l3';
  callLedger: AgentToolCallLedgerPort;
  now: () => Date;
}): Promise<ToolKernelResult> {
  const common = {
    operationId: input.request.context.operationId,
    actorId: input.request.context.actorId,
  };
  if (!input.adapter.prepareApproval) {
    await input.callLedger.settle({
      ...common,
      toolCallId: input.call.id,
      status: 'failed',
      code: 'approval_preparation_failed',
      durationMs: 0,
    });
    return toolFailure(
      input.adapter.name,
      'failed',
      'approval_preparation_failed',
      false,
    );
  }
  const control = createExecutionControl(
    Math.min(input.adapter.timeoutMs, 30_000),
    input.request.signal,
  );
  try {
    const prepared = preparationSchema.parse(
      await Promise.race([
        input.adapter.prepareApproval(input.parsedInput, {
          ...buildInvocationContext(input.request, control.signal),
          toolCallId: input.call.id,
          traceCarrier: input.request.traceCarrier ?? null,
        }),
        control.timeout,
        control.cancellation,
      ]),
    );
    const expiresAt = new Date(prepared.expiresAt).getTime();
    const currentTime = input.now().getTime();
    if (
      expiresAt <= currentTime ||
      expiresAt > currentTime + 24 * 60 * 60_000
    ) {
      throw new Error('approval_expiry_out_of_range');
    }
    return {
      ok: false,
      status: 'approval_required',
      tool: input.adapter.name,
      code: 'approval_required',
      retryable: false,
      replayed: input.replayed,
      approval: {
        approvalId: prepared.approvalId,
        toolCallId: input.call.id,
        capability: input.adapter.capability,
        risk: input.risk,
        adapterSource: input.adapter.source,
        summary: prepared.summary,
        expiresAt: prepared.expiresAt,
      },
    };
  } catch (error) {
    const cancelled = error instanceof ToolCancelledError;
    await input.callLedger.settle({
      ...common,
      toolCallId: input.call.id,
      status: 'failed',
      code: cancelled ? 'tool_cancelled' : 'approval_preparation_failed',
      retryable: !cancelled,
      durationMs: 0,
    });
    return toolFailure(
      input.adapter.name,
      cancelled ? 'cancelled' : 'failed',
      cancelled ? 'tool_cancelled' : 'approval_preparation_failed',
      !cancelled,
    );
  } finally {
    control.dispose();
  }
}
