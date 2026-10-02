import type {
  ModelToolResult,
  TurnApplicationEvent,
  TurnModelGateway,
} from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ToolKernel,
  ToolOutcomeUnknownError,
  type ToolKernelAdapter,
} from './tool-kernel';
import {
  MemoryCallLedger,
  MemoryEffectLedger,
} from './tool-kernel/test-support';
import {
  TurnApplicationService,
  type TurnApplicationProfilePort,
} from './turn-application';
import {
  command,
  collect,
  metadata,
  MemoryContextLedger,
  MemoryLifecycle,
  MemoryModelRunLedger,
  profile,
} from './turn-application.test-support';

type Behavior = 'success' | 'throw' | 'approval' | 'outcome_unknown';
function fixture(
  behaviors: Behavior[],
  observe?: (results: readonly ModelToolResult[]) => void,
) {
  const calls = new MemoryCallLedger();
  const effects = new MemoryEffectLedger();
  const lifecycle = new MemoryLifecycle();
  const controller = new AbortController();
  const invocations: string[] = [];
  const received: Array<readonly ModelToolResult[]> = [];
  const adapters = behaviors.map(
    (
      behavior,
      index,
    ): ToolKernelAdapter<{ value: string }, { value: string }> => ({
      name: `run${index}`,
      description: 'trusted fixture',
      source: 'local',
      capability: 'tool.execute',
      risk:
        behavior === 'approval'
          ? 'l2'
          : behavior === 'outcome_unknown'
            ? 'l1'
            : 'l0',
      exposure: 'model',
      effect:
        behavior === 'outcome_unknown' || behavior === 'approval'
          ? 'write'
          : 'read',
      timeoutMs: 100,
      inputSchema: z.object({ value: z.string() }).strict(),
      outputSchema: z.object({ value: z.string() }).strict(),
      prepareApproval: () => ({
        approvalId: 'approval:batch',
        summary: 'Approval required',
        expiresAt: '2026-10-02T13:00:00Z',
      }),
      invoke() {
        invocations.push(`run${index}`);
        if (behavior === 'throw') throw new Error('private_scope_mismatch');
        if (behavior === 'outcome_unknown')
          throw new ToolOutcomeUnknownError('private_write_receipt');
        return { value: `trusted-${index}` };
      },
    }),
  );
  const kernel = new ToolKernel(
    adapters,
    calls,
    effects,
    1_024,
    () => new Date('2026-10-02T12:00:00Z'),
  );
  const preparedProfile: TurnApplicationProfilePort = {
    ...profile(),
    ...(observe
      ? {
          createOutputGuard: () => ({
            push: async () => ({ kind: 'hold' as const }),
            finish: async () => ({
              kind: 'emit' as const,
              safeDeltas: ['Only verified facts.'],
            }),
            completionRequirement: {
              tool: 'run0',
              remediationPrompt: 'Use a real tool.',
              isSatisfied(results: readonly ModelToolResult[]) {
                observe(results);
                return results.length > 0;
              },
            },
          }),
        }
      : {}),
    async prepare(input) {
      return {
        ...(await profile().prepare(input)),
        toolPolicy: {
          channel: 'web',
          environment: 'test',
          capabilities: {
            actor: ['tool.execute'],
            notebook: ['tool.execute'],
            profile: ['tool.execute'],
            channel: ['tool.execute'],
            environment: ['tool.execute'],
          },
          approvedCapabilities: [],
        },
      };
    },
  };
  const gateway: TurnModelGateway = {
    async *streamTurnText(request) {
      received.push(request.toolResults);
      if (received.length === 1) {
        for (const [index, adapter] of adapters.entries())
          yield {
            type: 'tool_call',
            phase: request.phase,
            callId: `call-${index}`,
            tool: adapter.name,
            argumentsDelta: '{"value":"fixture"}',
            done: true,
          };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'tool_calls'),
        };
      } else {
        yield {
          type: 'text_delta',
          phase: request.phase,
          delta: 'Verified results.',
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'stop'),
        };
      }
    },
  };
  const service = new TurnApplicationService({
    lifecycle,
    profile: preparedProfile,
    contextLedger: new MemoryContextLedger(),
    modelRunLedger: new MemoryModelRunLedger(),
    modelGateway: gateway,
    toolKernel: kernel,
    cancellation: {
      async open() {
        return {
          signal: controller.signal,
          isCancellationRequested: async () => controller.signal.aborted,
          close() {},
        };
      },
    },
  });
  return {
    calls,
    effects,
    lifecycle,
    controller,
    invocations,
    received,
    service,
  };
}

const toolEvents = (events: TurnApplicationEvent[]) =>
  events.filter(
    (event) =>
      event.type === 'tool.started' ||
      event.type === 'tool.completed' ||
      event.type === 'tool.failed',
  );

describe('actual ToolKernel + AgentLoop batch facts', () => {
  it('publishes each actual start and completion in order and feeds all trusted results to the next model', async () => {
    const input = fixture(['success', 'success', 'success']);
    const events = await collect(input.service);
    expect(toolEvents(events).map((event) => event.type)).toEqual([
      'tool.started',
      'tool.completed',
      'tool.started',
      'tool.completed',
      'tool.started',
      'tool.completed',
    ]);
    expect(input.invocations).toEqual(['run0', 'run1', 'run2']);
    expect([...input.calls.calls.values()].map((call) => call.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(input.received).toHaveLength(2);
    expect(
      input.received[1]?.map((result) => ({
        callId: result.callId,
        output: result.output,
      })),
    ).toEqual(
      [0, 1, 2].map((index) => ({
        callId: `call-${index}`,
        output: { value: `trusted-${index}` },
      })),
    );
    expect(events.at(-1)?.type).toBe('turn.completed');
  });

  it('retains the first completed call and trusted result when the second fails, without starting the tail', async () => {
    const observed = vi.fn();
    const input = fixture(['success', 'throw', 'success'], observed);
    const events = await collect(input.service);
    const rows = [...input.calls.calls.values()];
    expect(toolEvents(events).map((event) => event.type)).toEqual([
      'tool.started',
      'tool.completed',
      'tool.started',
      'tool.failed',
    ]);
    expect(toolEvents(events).map((event) => event.toolCallId)).toEqual([
      rows[0]!.executionId,
      rows[0]!.executionId,
      rows[1]!.executionId,
      rows[1]!.executionId,
    ]);
    expect(
      rows.map((call) => ({
        tool: call.toolName,
        status: call.status,
        code: call.code,
      })),
    ).toEqual([
      { tool: 'run0', status: 'succeeded', code: null },
      { tool: 'run1', status: 'failed', code: 'tool_failed' },
    ]);
    expect(input.invocations).toEqual(['run0', 'run1']);
    expect(observed).toHaveBeenCalledWith([
      expect.objectContaining({
        callId: 'call-0',
        output: { value: 'trusted-0' },
      }),
    ]);
    expect(input.received).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'TOOL_FAILED',
      retryable: false,
    });
    expect(JSON.stringify(events)).not.toContain('private_scope_mismatch');
  });

  it('first-call immediate failure has one failed ledger row and emits no starts or completions for the untouched tail', async () => {
    const input = fixture(['throw', 'success', 'success']);
    const events = await collect(input.service);
    expect(toolEvents(events).map((event) => event.type)).toEqual([
      'tool.started',
      'tool.failed',
    ]);
    expect(input.invocations).toEqual(['run0']);
    expect([...input.calls.calls.values()]).toMatchObject([
      { toolName: 'run0', status: 'failed', code: 'tool_failed' },
    ]);
    expect(input.calls.calls.size).toBe(1);
    expect(input.received).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('turn.failed');
  });

  it('server cancellation after a completed call never starts the next call', async () => {
    const input = fixture(['success', 'success']);
    const events: TurnApplicationEvent[] = [];
    for await (const event of input.service.run(command)) {
      events.push(event);
      if (event.type === 'tool.completed')
        input.controller.abort('user_cancelled');
    }
    expect(toolEvents(events).map((event) => event.type)).toEqual([
      'tool.started',
      'tool.completed',
    ]);
    expect(input.invocations).toEqual(['run0']);
    expect(input.calls.calls.size).toBe(1);
    expect(events.at(-1)?.type).toBe('turn.cancelled');
    expect(input.received).toHaveLength(1);
  });

  it('approval suspension keeps the completed prefix and never invokes or starts the tail', async () => {
    const input = fixture(['success', 'approval', 'success']);
    const events = await collect(input.service);
    expect(toolEvents(events).map((event) => event.type)).toEqual([
      'tool.started',
      'tool.completed',
      'tool.started',
    ]);
    expect(input.invocations).toEqual(['run0']);
    expect([...input.calls.calls.values()].map((call) => call.status)).toEqual([
      'succeeded',
      'pending',
    ]);
    expect(input.effects.effects.size).toBe(0);
    expect(events.at(-1)?.type).toBe('approval.required');
    expect(events.filter((event) => event.type === 'turn.failed')).toHaveLength(
      0,
    );
    expect(input.received).toHaveLength(1);
  });

  it('unknown write outcome stops the batch without claiming success or running the tail', async () => {
    const input = fixture(['success', 'outcome_unknown', 'success']);
    const events = await collect(input.service);
    expect(toolEvents(events).map((event) => event.type)).toEqual([
      'tool.started',
      'tool.completed',
      'tool.started',
      'tool.failed',
    ]);
    expect(input.invocations).toEqual(['run0', 'run1']);
    expect([...input.calls.calls.values()].map((call) => call.status)).toEqual([
      'succeeded',
      'outcome_unknown',
    ]);
    expect([...input.effects.effects.values()]).toMatchObject([
      { status: 'outcome_unknown', code: 'write_outcome_unknown' },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'turn.failed',
      retryable: false,
    });
    expect(input.received).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('private_write_receipt');
  });
});
