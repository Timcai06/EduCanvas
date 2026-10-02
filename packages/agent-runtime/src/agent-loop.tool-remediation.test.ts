import {
  type ModelToolResult,
  type StreamTurnTextRequest,
  type TurnModelGateway,
} from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import {
  AgentLoopEngine,
  type AgentLoopCommand,
  type AgentLoopEvent,
} from './agent-loop';
import { TurnUsageBudgetController } from './turn-usage-budget-controller';

function metadata(
  request: StreamTurnTextRequest,
  finishReason: 'stop' | 'tool_calls',
) {
  return {
    providerResponseId: `response:${request.phase}`,
    provider: 'fixture',
    taskAlias: request.taskAlias,
    modelAlias: request.modelAlias,
    resolvedModelId: 'fixture/model',
    modelRevision: null,
    systemFingerprint: null,
    finishReason,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheHitTokens: 0,
      reasoningTokens: 0,
    },
    latencyMs: 1,
    traceId: request.traceId,
  } as const;
}

const researchTools = [
  { name: 'webSearch', description: 'Search', inputSchema: {} },
  { name: 'fetchWebPage', description: 'Read', inputSchema: {} },
];
type ToolFailure = { code: string; retryable: boolean };

function command(
  overrides: Partial<AgentLoopCommand<null, ToolFailure>> = {},
): AgentLoopCommand<null, ToolFailure> {
  const prompt = {
    taskAlias: 'agent.turn' as const,
    modelAlias: 'primary' as const,
    promptVersion: 'research-test-v1',
    messages: [{ role: 'user' as const, content: 'research topic' }],
  };
  return {
    traceId: 'trace:research',
    turnId: 'turn:research',
    maxToolRounds: 3,
    answer: { ...prompt, tools: researchTools },
    synthesis: prompt,
    toolRemediation: {
      tool: 'webSearch',
      prompt: 'Use webSearch to start research.',
    },
    executeTools: async (calls) => ({
      ok: true,
      results: calls.map((call) => ({
        call,
        detail: null,
        modelResult: {
          callId: call.callId,
          tool: call.tool,
          arguments: call.arguments,
          output: { accepted: true, tool: call.tool },
        },
      })),
    }),
    ...overrides,
  };
}

function textResponse(request: StreamTurnTextRequest, text: string) {
  return [
    {
      type: 'text_delta' as const,
      phase: request.phase,
      delta: text,
    },
    {
      type: 'completed' as const,
      phase: request.phase,
      metadata: metadata(request, 'stop'),
    },
  ];
}

function toolResponse(request: StreamTurnTextRequest, tool: string) {
  return [
    {
      type: 'tool_call' as const,
      phase: request.phase,
      callId: `call_${tool}`,
      tool,
      argumentsDelta: '{}',
      done: true as const,
    },
    {
      type: 'completed' as const,
      phase: request.phase,
      metadata: metadata(request, 'tool_calls'),
    },
  ];
}

async function run(
  gateway: TurnModelGateway,
  input: AgentLoopCommand<null, ToolFailure>,
) {
  const events: AgentLoopEvent<null, ToolFailure>[] = [];
  for await (const event of new AgentLoopEngine(gateway).stream(input))
    events.push(event);
  return events;
}

describe('one bounded tool remediation', () => {
  it('runs one web search after a tool-free draft, then continues with real tool results', async () => {
    const requests: StreamTurnTextRequest[] = [];
    const progress = { successfulSearchCount: 0, sourceCount: 0 };
    const toolResults: ModelToolResult[] = [];
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        requests.push(request);
        const index = requests.length;
        const events =
          index === 1
            ? textResponse(request, '工具调用前的无证据草稿。')
            : index === 2
              ? toolResponse(request, 'webSearch')
              : index === 3
                ? toolResponse(request, 'fetchWebPage')
                : textResponse(
                    request,
                    '# 摘要\n结论一[1]，结论二[2]，结论三[3]，结论四[4]，结论五[5]。',
                  );
        for (const event of events) yield event;
      },
    };
    const events: AgentLoopEvent<null, ToolFailure>[] = [];
    const input = command({
      maxToolRounds: 3,
      executeTools: async (calls) => {
        const results = calls.map((call) => {
          if (call.tool === 'webSearch') progress.successfulSearchCount = 3;
          if (call.tool === 'fetchWebPage') progress.sourceCount = 5;
          const modelResult: ModelToolResult = {
            callId: call.callId,
            tool: call.tool,
            arguments: call.arguments,
            output: { accepted: true, tool: call.tool },
          };
          toolResults.push(modelResult);
          return { call, modelResult, detail: null };
        });
        return { ok: true as const, results };
      },
    });
    for await (const event of new AgentLoopEngine(gateway).stream(input)) {
      events.push(event);
    }

    expect(requests).toHaveLength(4);
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: 'system',
      content: 'Use webSearch to start research.',
    });
    expect(requests[2]?.messages.at(-1)?.content).not.toBe(
      'Use webSearch to start research.',
    );
    expect(requests[3]?.toolResults).toEqual(toolResults);
    expect(progress).toEqual({ successfulSearchCount: 3, sourceCount: 5 });
    expect(events.at(-1)).toMatchObject({ type: 'completed' });
  });

  it('attempts remediation only once when the second answer still has no tools', async () => {
    let calls = 0;
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        calls += 1;
        for (const event of textResponse(request, '仍无证据的作文。'))
          yield event;
      },
    };

    const events = await run(gateway, command());

    expect(calls).toBe(2);
    expect(events.at(-1)).toMatchObject({ type: 'completed' });
  });

  it('does not run remediation after cancellation', async () => {
    const controller = new AbortController();
    let calls = 0;
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        calls += 1;
        for (const event of textResponse(request, 'Draft.')) yield event;
        controller.abort();
      },
    };

    const events = await run(gateway, command({ signal: controller.signal }));

    expect(calls).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'MODEL_ABORTED',
    });
  });

  it('rejects remediation before the provider call when the total call budget is exhausted', async () => {
    let calls = 0;
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        calls += 1;
        for (const event of textResponse(request, 'Draft.')) yield event;
      },
    };
    const budget = new TurnUsageBudgetController({
      maxInputTokens: 1000,
      reservedOutputTokens: 1000,
      maxModelCalls: 1,
      maxToolCalls: 2,
      maxToolResultTokens: 1000,
      maxWallClockMs: 1000,
      maxEstimatedCostCents: 100,
    });

    const events = await run(gateway, command({ usageBudget: budget }));

    expect(calls).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'BUDGET_EXCEEDED',
      budgetReason: 'max_model_calls',
    });
  });

  it.each([
    { code: 'policy_denied', tool: 'webSearch' },
    { code: 'outcome_unknown', tool: 'createCanvasArtifact' },
  ])(
    'retains a non-retryable tool failure ($code) without redispatch',
    async ({ code, tool }) => {
      let modelCalls = 0;
      let toolCalls = 0;
      const gateway: TurnModelGateway = {
        async *streamTurnText(request) {
          modelCalls += 1;
          const events =
            modelCalls === 1
              ? textResponse(request, 'Draft.')
              : toolResponse(request, tool);
          for (const event of events) yield event;
        },
      };
      const events = await run(
        gateway,
        command({
          answer: {
            ...command().answer,
            tools: [
              ...researchTools,
              ...(tool === 'createCanvasArtifact'
                ? [
                    {
                      name: 'createCanvasArtifact',
                      description: 'Create an artifact',
                      inputSchema: {},
                    },
                  ]
                : []),
            ],
          },
          toolRemediation: { tool, prompt: 'Call the requested tool.' },
          executeTools: async () => {
            toolCalls += 1;
            return {
              ok: false as const,
              failure: { code, retryable: false },
            };
          },
        }),
      );

      expect(modelCalls).toBe(2);
      expect(toolCalls).toBe(1);
      expect(events.at(-1)).toMatchObject({
        type: 'tool.failed',
        failure: { code, retryable: false },
      });
    },
  );
});
