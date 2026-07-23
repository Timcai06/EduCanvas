import type { StreamAgentTextRequest } from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import { OpenAICompatibleTurnModelGateway } from './openai-compatible-turn-model-gateway';
import {
  answerRequest,
  collect,
  config,
  oneResponseFetch,
} from './openai-compatible-turn-model-gateway.test-support';
import {
  createFixtureResponse,
  textStreamChunks,
  toolStreamChunks,
} from './testing/openai-compatible-fixtures';

describe('OpenAI-compatible工具流', () => {
  it('按索引累积工具参数并在finish_reason后显式关闭调用', async () => {
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(() =>
        createFixtureResponse(toolStreamChunks, { splitEvery: 11 }),
      ),
    });
    const events = await collect(gateway);
    expect(events).toEqual([
      {
        type: 'tool_call',
        phase: 'answer',
        callId: 'call_state_1',
        tool: 'getStudentState',
        argumentsDelta: '{',
        done: false,
      },
      {
        type: 'tool_call',
        phase: 'answer',
        callId: 'call_state_1',
        tool: 'getStudentState',
        argumentsDelta: '}',
        done: false,
      },
      {
        type: 'tool_call',
        phase: 'answer',
        callId: 'call_state_1',
        tool: 'getStudentState',
        argumentsDelta: '',
        done: true,
      },
      {
        type: 'usage',
        phase: 'answer',
        usage: {
          inputTokens: 18,
          outputTokens: 6,
          cacheHitTokens: 0,
          reasoningTokens: 0,
        },
      },
      expect.objectContaining({
        type: 'completed',
        metadata: expect.objectContaining({ finishReason: 'tool_calls' }),
      }),
    ]);
  });

  it('synthesis请求由自包含toolResults重建assistant.tool_calls和tool消息', async () => {
    let capturedBody: unknown;
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(
        () => createFixtureResponse(textStreamChunks),
        (_input, init) => {
          capturedBody = JSON.parse(String(init?.body));
        },
      ),
    });
    const request: StreamAgentTextRequest = {
      ...answerRequest,
      phase: 'synthesis',
      tools: [],
      toolResults: [
        {
          callId: 'call_state_1',
          tool: 'getStudentState',
          arguments: {},
          output: { state: 'EXPLAIN' },
        },
      ],
    };
    const events = await collect(gateway, request);
    expect(events.at(-1)?.type).toBe('completed');
    expect(capturedBody).toMatchObject({
      tool_choice: 'none',
      messages: [
        { role: 'system', content: '你是AI老师。' },
        { role: 'user', content: '猫和狗有什么不同？' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_state_1',
              type: 'function',
              function: { name: 'getStudentState', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_state_1',
          content: '{"state":"EXPLAIN"}',
        },
      ],
    });
    expect(capturedBody).not.toHaveProperty('tools');
  });
});
