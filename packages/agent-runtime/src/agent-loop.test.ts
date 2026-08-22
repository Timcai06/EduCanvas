import {
  ModelGatewayInvocationError,
  type TurnModelGateway,
} from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import {
  AgentLoopEngine,
  type AgentLoopCommand,
  type AgentLoopEvent,
} from './agent-loop';

function metadata(
  request: Parameters<TurnModelGateway['streamTurnText']>[0],
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

function command(
  overrides: Partial<AgentLoopCommand<never, never, { id: number }>> = {},
): AgentLoopCommand<never, never, { id: number }> {
  return {
    traceId: 'trace:retry',
    turnId: 'turn:retry',
    maxToolRounds: 1,
    answer: {
      taskAlias: 'agent.turn',
      modelAlias: 'primary',
      promptVersion: 'test-v1',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    },
    synthesis: {
      taskAlias: 'agent.turn',
      modelAlias: 'primary',
      promptVersion: 'test-v1',
      messages: [{ role: 'user', content: 'test' }],
    },
    async executeTools() {
      return { ok: true, results: [] };
    },
    ...overrides,
  };
}

async function collect(
  engine: AgentLoopEngine,
  input: AgentLoopCommand<never, never, { id: number }>,
): Promise<AgentLoopEvent<never, never>[]> {
  const events: AgentLoopEvent<never, never>[] = [];
  for await (const event of engine.stream(input)) events.push(event);
  return events;
}

describe('AgentLoopEngine', () => {
  it('owns multi-round tool execution, shared text budget and one terminal', async () => {
    let calls = 0;
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        calls += 1;
        if (request.toolResults.length === 0) {
          yield {
            type: 'tool_call',
            phase: request.phase,
            callId: 'call_1',
            tool: 'lookup',
            argumentsDelta: '{}',
            done: true,
          };
          yield {
            type: 'completed',
            phase: request.phase,
            metadata: metadata(request, 'tool_calls'),
          };
          return;
        }
        yield {
          type: 'text_delta',
          phase: request.phase,
          delta: '统一循环回答',
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'stop'),
        };
      },
    };
    const events = [];
    for await (const event of new AgentLoopEngine(gateway).stream({
      traceId: 'trace:1',
      turnId: 'turn:1',
      maxToolRounds: 2,
      answer: {
        taskAlias: 'agent.turn',
        modelAlias: 'primary',
        promptVersion: 'test-v1',
        messages: [{ role: 'user', content: 'test' }],
        tools: [
          {
            name: 'lookup',
            description: 'lookup',
            inputSchema: { type: 'object' },
          },
        ],
      },
      synthesis: {
        taskAlias: 'agent.turn',
        modelAlias: 'primary',
        promptVersion: 'test-v1',
        messages: [{ role: 'user', content: 'test' }],
      },
      async executeTools(toolCalls) {
        return {
          ok: true as const,
          results: toolCalls.map((call) => ({
            call,
            modelResult: {
              callId: call.callId,
              tool: call.tool,
              arguments: call.arguments,
              output: { ok: true },
            },
            detail: { audited: true },
          })),
        };
      },
    }))
      events.push(event);
    expect(calls).toBe(2);
    expect(events.map((event) => event.type)).toContain('tool.started');
    expect(events.filter((event) => event.type === 'completed')).toHaveLength(
      1,
    );
    expect(events.filter((event) => event.type === 'failed')).toHaveLength(0);
  });

  it('allows six bounded research tool rounds before tool-free synthesis', async () => {
    let calls = 0;
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        calls += 1;
        if (request.phase === 'synthesis') {
          yield {
            type: 'text_delta',
            phase: request.phase,
            delta: '研究综合',
          };
          yield {
            type: 'completed',
            phase: request.phase,
            metadata: metadata(request, 'stop'),
          };
          return;
        }
        const index = request.toolResults.length + 1;
        yield {
          type: 'tool_call',
          phase: request.phase,
          callId: `call_${index}`,
          tool: 'lookup',
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
    const events = await collect(
      new AgentLoopEngine(gateway),
      command({
        maxToolRounds: 6,
        answer: {
          ...command().answer,
          tools: [
            {
              name: 'lookup',
              description: 'lookup',
              inputSchema: { type: 'object' },
            },
          ],
        },
        async executeTools(toolCalls) {
          return {
            ok: true,
            results: toolCalls.map((call) => ({
              call,
              modelResult: {
                callId: call.callId,
                tool: call.tool,
                arguments: call.arguments,
                output: { ok: true },
              },
              detail: undefined as never,
            })),
          };
        },
      }),
    );

    expect(calls).toBe(7);
    expect(
      events.filter((event) => event.type === 'tool.started'),
    ).toHaveLength(6);
    expect(events.at(-1)).toMatchObject({ type: 'completed' });
  });

  it('retries a clean transient failure and audits every provider attempt', async () => {
    let calls = 0;
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        calls += 1;
        if (calls < 3) {
          throw new ModelGatewayInvocationError({
            code: 'rate_limit',
            retryable: true,
          });
        }
        yield {
          type: 'text_delta',
          phase: request.phase,
          delta: '重试成功',
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'stop'),
        };
      },
    };
    const waits: number[] = [];
    const starts: number[] = [];
    const settlements: boolean[] = [];
    const events = await collect(
      new AgentLoopEngine(gateway, {
        random: () => 0,
        async wait(ms) {
          waits.push(ms);
          return true;
        },
      }),
      command({
        modelRunLifecycle: {
          async start() {
            const context = { id: starts.length + 1 };
            starts.push(context.id);
            return context;
          },
          async settle({ outcome }) {
            settlements.push(outcome.ok);
          },
        },
      }),
    );

    expect(calls).toBe(3);
    expect(waits).toEqual([1_000, 2_000]);
    expect(starts).toEqual([1, 2, 3]);
    expect(settlements).toEqual([false, false, true]);
    expect(events.filter((event) => event.type === 'model.retry')).toHaveLength(
      2,
    );
    expect(events.at(-1)).toMatchObject({ type: 'completed' });
  });

  it('重试耗尽（4 次）后透传 rate_limit 失败，退避按指数推进且封顶', async () => {
    const gateway: TurnModelGateway = {
      async *streamTurnText() {
        throw new ModelGatewayInvocationError({
          code: 'rate_limit',
          retryable: true,
        });
      },
    };
    const waits: number[] = [];
    const events = await collect(
      new AgentLoopEngine(gateway, {
        random: () => 0,
        async wait(ms) {
          waits.push(ms);
          return true;
        },
      }),
      command({}),
    );

    /* 1 次初始 + 4 次重试，共 5 次尝试；退避 1s/2s/4s/8s 均低于 20s 封顶。 */
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(events.filter((event) => event.type === 'model.retry')).toHaveLength(
      4,
    );
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'rate_limit' },
    });
  });

  it('does not retry after any provider event has already been projected', async () => {
    let calls = 0;
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        calls += 1;
        yield {
          type: 'text_delta',
          phase: request.phase,
          delta: '不可重复的部分输出',
        };
        throw new ModelGatewayInvocationError({
          code: 'unavailable',
          retryable: true,
        });
      },
    };
    const events = await collect(
      new AgentLoopEngine(gateway, {
        random: () => 0,
        async wait() {
          throw new Error('wait must not be called');
        },
      }),
      command(),
    );

    expect(calls).toBe(1);
    expect(events.filter((event) => event.type === 'model.retry')).toHaveLength(
      0,
    );
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'MODEL_GATEWAY_FAILED',
    });
  });

  it('cancels during retry backoff without another provider call', async () => {
    let calls = 0;
    const gateway: TurnModelGateway = {
      async *streamTurnText() {
        calls += 1;
        throw new ModelGatewayInvocationError({
          code: 'timeout',
          retryable: true,
        });
      },
    };
    const events = await collect(
      new AgentLoopEngine(gateway, {
        random: () => 0,
        async wait() {
          return false;
        },
      }),
      command(),
    );

    expect(calls).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'MODEL_ABORTED',
      error: { code: 'aborted', retryable: false },
    });
  });
});
