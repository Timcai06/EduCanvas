import type { TurnModelEvent } from '@educanvas/agent-core';
import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { AiSdkTurnModelGateway } from './ai-sdk-turn-model-gateway';
import { normalizeAiSdkError } from './ai-sdk-protocol';
import { answerRequest } from './openai-compatible-turn-model-gateway.test-support';

type MockStreamResult = Awaited<ReturnType<MockLanguageModelV3['doStream']>>;
type MockStreamPart =
  MockStreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;

const collect = async (
  gateway: AiSdkTurnModelGateway,
): Promise<TurnModelEvent[]> => {
  const events: TurnModelEvent[] = [];
  for await (const event of gateway.streamTurnText(answerRequest)) {
    events.push(event);
  }
  return events;
};

const gatewayFor = (model: MockLanguageModelV3) =>
  new AiSdkTurnModelGateway({
    provider: 'fixture-provider',
    modelIds: { primary: 'primary-explicit' },
    timeoutMs: 1_000,
    maxOutputTokens: 2_048,
    modelFactory: () => model,
  });

describe('AiSdkTurnModelGateway protocol boundary', () => {
  it('只按安全状态与响应头映射SDK限流错误', () => {
    const secret = 'fixture-provider-secret-never-forward';
    const mapped = normalizeAiSdkError(
      new APICallError({
        message: secret,
        url: `https://provider.invalid/${secret}`,
        requestBodyValues: { secret },
        statusCode: 429,
        responseHeaders: { 'Retry-After': '2' },
        responseBody: secret,
        isRetryable: true,
      }),
      undefined,
      false,
      100,
    );

    expect(mapped).toEqual({
      code: 'rate_limit',
      retryable: true,
      retryAfterMs: 2_000,
    });
    expect(JSON.stringify(mapped)).not.toContain(secret);
  });

  it('未知alias在构造SDK模型前fail closed', async () => {
    const modelFactory = vi.fn();
    const gateway = new AiSdkTurnModelGateway({
      provider: 'fixture-provider',
      modelIds: { primary: 'primary-explicit' },
      timeoutMs: 1_000,
      maxOutputTokens: 2_048,
      modelFactory,
    });
    const events: TurnModelEvent[] = [];

    for await (const event of gateway.streamTurnText({
      ...answerRequest,
      modelAlias: 'fast',
    })) {
      events.push(event);
    }

    expect(modelFactory).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: 'failed',
        phase: 'answer',
        error: { code: 'unavailable', retryable: false },
      },
    ]);
  });

  it('SDK元数据违反稳定协议时映射invalid_response且不泄漏原值', async () => {
    const secret = `fixture-secret-${'x'.repeat(600)}`;
    const stream: MockStreamResult = {
      stream: simulateReadableStream<MockStreamPart>({
        chunks: [
          { type: 'stream-start', warnings: [] },
          {
            type: 'response-metadata',
            id: secret,
            modelId: 'configured-provider-model',
          },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
      }),
    };
    const events = await collect(
      gatewayFor(new MockLanguageModelV3({ doStream: stream })),
    );

    expect(events.at(-1)).toEqual({
      type: 'failed',
      phase: 'answer',
      error: { code: 'invalid_response', retryable: false },
    });
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(
      events.filter(
        (event) => event.type === 'completed' || event.type === 'failed',
      ),
    ).toHaveLength(1);
  });

  it('没有工具调用却声明tool-calls终止时fail closed', async () => {
    const stream: MockStreamResult = {
      stream: simulateReadableStream<MockStreamPart>({
        chunks: [
          { type: 'stream-start', warnings: [] },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
      }),
    };

    expect(
      (
        await collect(gatewayFor(new MockLanguageModelV3({ doStream: stream })))
      ).at(-1),
    ).toEqual({
      type: 'failed',
      phase: 'answer',
      error: { code: 'invalid_response', retryable: false },
    });
  });
});
