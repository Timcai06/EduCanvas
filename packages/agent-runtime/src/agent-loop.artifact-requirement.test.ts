import {
  ModelGatewayInvocationError,
  type TurnModelGateway,
  type ModelToolResult,
} from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentLoopEngine,
  type AgentLoopCommand,
  type AgentLoopEvent,
} from './agent-loop';
import { metadata } from './turn-application.test-support';
import { TurnUsageBudgetController } from './turn-usage-budget-controller';

const created: ModelToolResult = {
  callId: 'create-1',
  tool: 'createCanvasArtifact',
  arguments: {},
  output: { artifactId: 'real' },
};
function command(
  overrides: Partial<AgentLoopCommand<null, string>> = {},
): AgentLoopCommand<null, string> {
  const prompt = {
    taskAlias: 'agent.turn' as const,
    modelAlias: 'primary' as const,
    promptVersion: 'test-v1',
    messages: [{ role: 'user' as const, content: 'create document' }],
  };
  return {
    traceId: 'trace:artifact',
    turnId: 'turn:artifact',
    maxToolRounds: 1,
    answer: {
      ...prompt,
      tools: [
        {
          name: 'createCanvasArtifact',
          description: 'fixture',
          inputSchema: {},
        },
      ],
    },
    synthesis: prompt,
    completionRequirement: {
      tool: 'createCanvasArtifact',
      remediationPrompt: 'Use the actual artifact tool.',
      isSatisfied: (results) =>
        results.some((result) => result.output === created.output),
    },
    executeTools: async (calls) => ({
      ok: true,
      results: calls.map((call) => ({
        call,
        modelResult: { ...created, callId: call.callId, tool: call.tool },
        detail: null,
      })),
    }),
    ...overrides,
  };
}
async function collect(gateway: TurnModelGateway, input = command()) {
  const events: AgentLoopEvent<null, string>[] = [];
  for await (const event of new AgentLoopEngine(gateway).stream(input))
    events.push(event);
  return events;
}

describe('one bounded artifact remediation', () => {
  it('checks the original wall-clock after the tool without billing model usage twice', async () => {
    let now = 0;
    const budget = new TurnUsageBudgetController(
      {
        maxInputTokens: 1000,
        reservedOutputTokens: 1000,
        maxModelCalls: 2,
        maxToolCalls: 2,
        maxToolResultTokens: 1000,
        maxWallClockMs: 1000,
        maxEstimatedCostCents: 100,
      },
      () => now,
    );
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        yield {
          type: 'tool_call',
          phase: request.phase,
          callId: 'create-1',
          tool: 'createCanvasArtifact',
          argumentsDelta: '{}',
          done: true,
        };
        yield {
          type: 'usage',
          phase: request.phase,
          usage: metadata(request, 'tool_calls').usage,
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'tool_calls'),
        };
      },
    };
    const events = await collect(
      gateway,
      command({
        usageBudget: budget,
        executeTools: async (...args) => {
          now = 2000;
          return command().executeTools(...args);
        },
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'BUDGET_EXCEEDED',
      budgetReason: 'max_wall_clock',
    });
    expect(events.some((event) => event.type === 'completed')).toBe(false);
    expect(budget.snapshot()).toMatchObject({
      modelCalls: 1,
      toolCalls: 1,
      inputTokens: 2,
      outputTokens: 3,
      wallClockMs: 2000,
    });
    const before = budget.snapshot();
    expect(budget.checkBeforeCompletion()).toBe('max_wall_clock');
    expect(budget.snapshot()).toEqual(before);
  });

  it('retains the created tool fact but honours cancellation before the new completion path', async () => {
    const controller = new AbortController();
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        yield {
          type: 'tool_call',
          phase: request.phase,
          callId: 'create-1',
          tool: 'createCanvasArtifact',
          argumentsDelta: '{}',
          done: true,
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'tool_calls'),
        };
      },
    };
    const events: AgentLoopEvent<null, string>[] = [];
    for await (const event of new AgentLoopEngine(gateway).stream(
      command({ signal: controller.signal }),
    )) {
      events.push(event);
      if (event.type === 'tool.result') controller.abort();
    }
    expect(events.filter((event) => event.type === 'tool.result')).toHaveLength(
      1,
    );
    expect(events.some((event) => event.type === 'completed')).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'MODEL_ABORTED',
      error: { code: 'aborted', retryable: false },
    });
  });

  it('allows exactly one extra call, validates and executes its tool, then uses no synthesis call', async () => {
    const requests: Parameters<TurnModelGateway['streamTurnText']>[0][] = [];
    const executeTools = vi.fn(command().executeTools);
    const events = await collect(
      {
        async *streamTurnText(request) {
          requests.push(request);
          if (requests.length === 1) {
            yield {
              type: 'text_delta',
              phase: request.phase,
              delta: 'I already submitted it.',
            };
          } else {
            yield {
              type: 'tool_call',
              phase: request.phase,
              callId: 'create-1',
              tool: 'createCanvasArtifact',
              argumentsDelta: '{}',
              done: true,
            };
          }
          yield {
            type: 'completed',
            phase: request.phase,
            metadata: metadata(
              request,
              requests.length === 1 ? 'stop' : 'tool_calls',
            ),
          };
        },
      },
      command({ executeTools }),
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: 'system',
      content: 'Use the actual artifact tool.',
    });
    expect(requests.every((request) => request.phase === 'answer')).toBe(true);
    expect(executeTools).toHaveBeenCalledTimes(1);
    expect(executeTools.mock.calls[0]?.[1].round).toBe(2);
    expect(events.filter((event) => event.type === 'tool.result')).toHaveLength(
      1,
    );
    expect(events.filter((event) => event.type === 'completed')).toEqual([
      { type: 'completed', modelRunCount: 2 },
    ]);
  });

  it('does not repeat a second empty answer or retry the remediation Provider failure', async () => {
    for (const fails of [false, true]) {
      let calls = 0;
      const events = await collect({
        async *streamTurnText(request) {
          calls += 1;
          if (calls === 2 && fails)
            throw new ModelGatewayInvocationError({
              code: 'unavailable',
              retryable: true,
            });
          yield {
            type: 'text_delta',
            phase: request.phase,
            delta: 'claimed submission',
          };
          yield {
            type: 'completed',
            phase: request.phase,
            metadata: metadata(request, 'stop'),
          };
        },
      });
      expect(calls).toBe(2);
      expect(
        events.filter((event) => event.type === 'model.retry'),
      ).toHaveLength(0);
      expect(events.at(-1)?.type).toBe(fails ? 'failed' : 'completed');
      expect(command().completionRequirement?.isSatisfied([])).toBe(false);
    }
  });

  it('does not spend another call when the required tool is absent', async () => {
    let calls = 0;
    const base = command();
    await collect(
      {
        async *streamTurnText(request) {
          calls += 1;
          yield {
            type: 'text_delta',
            phase: request.phase,
            delta: 'plain answer',
          };
          yield {
            type: 'completed',
            phase: request.phase,
            metadata: metadata(request, 'stop'),
          };
        },
      },
      command({ answer: { ...base.answer, tools: [] } }),
    );
    expect(calls).toBe(1);
  });

  it('counts the extra call against the original usage budget', async () => {
    let calls = 0;
    const checks = vi.fn(({ run }: { run: number }) =>
      run > 1 ? ('max_model_calls' as const) : null,
    );
    const events = await collect(
      {
        async *streamTurnText(request) {
          calls += 1;
          yield {
            type: 'text_delta',
            phase: request.phase,
            delta: 'plain answer',
          };
          yield {
            type: 'completed',
            phase: request.phase,
            metadata: metadata(request, 'stop'),
          };
        },
      },
      command({
        usageBudget: {
          checkBeforeModelCall: checks,
          observeUsage() {},
          checkAfterModelRun: () => null,
          checkBeforeToolExecution: () => null,
          observeToolResult: (result) => result,
        },
      }),
    );
    expect(calls).toBe(1);
    expect(checks).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'BUDGET_EXCEEDED',
      budgetReason: 'max_model_calls',
    });
  });

  it('does not create an artifact after cancellation', async () => {
    const controller = new AbortController();
    let calls = 0;
    const executeTools = vi.fn(command().executeTools);
    const events = await collect(
      {
        async *streamTurnText(request) {
          calls += 1;
          yield {
            type: 'text_delta',
            phase: request.phase,
            delta: 'plain answer',
          };
          controller.abort();
          yield {
            type: 'completed',
            phase: request.phase,
            metadata: metadata(request, 'stop'),
          };
        },
      },
      command({ signal: controller.signal, executeTools }),
    );
    expect(calls).toBe(1);
    expect(executeTools).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'aborted', retryable: false },
    });
  });
});
