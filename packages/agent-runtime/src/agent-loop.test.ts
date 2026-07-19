import type { TurnModelGateway } from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import { AgentLoopEngine } from './agent-loop';

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
});
