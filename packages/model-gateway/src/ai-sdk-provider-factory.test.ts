import type { TurnModelEvent } from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import { createAiSdkTurnModelGateway } from './ai-sdk-provider-factory';
import type { EnabledModelGatewayConfiguration } from './config';
import { answerRequest } from './openai-compatible-turn-model-gateway.test-support';
import {
  createFixtureResponse,
  textStreamChunks,
} from './testing/openai-compatible-fixtures';

const configuration: EnabledModelGatewayConfiguration = {
  enabled: true,
  environment: 'local',
  provider: 'deepseek',
  runtime: 'ai-sdk',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'fixture-key-never-real',
  modelIds: {
    primary: 'primary-explicit',
    fast: 'fast-explicit',
  },
  timeoutMs: 1_000,
  maxOutputTokens: 1_234,
  speechVoice: 'alloy',
  speechTimeoutMs: 60_000,
  speechMaxInputChars: 3_500,
};

describe('createAiSdkTurnModelGateway', () => {
  it('按alias选择模型、限制输出并为DeepSeek显式关闭thinking', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const gateway = createAiSdkTurnModelGateway(configuration, {
      fetchImpl: (async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return createFixtureResponse(textStreamChunks, { splitEvery: 7 });
      }) as typeof fetch,
      now: () => 100,
    });
    const events: TurnModelEvent[] = [];

    for await (const event of gateway.streamTurnText({
      ...answerRequest,
      modelAlias: 'fast',
      tools: [],
    })) {
      events.push(event);
    }

    expect(capturedBody).toMatchObject({
      model: 'fast-explicit',
      stream: true,
      max_tokens: 1_234,
      thinking: { type: 'disabled' },
    });
    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'text_delta',
      'usage',
      'completed',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      metadata: {
        provider: 'deepseek',
        modelAlias: 'fast',
        resolvedModelId: 'fast-explicit',
      },
    });
    expect(JSON.stringify(events)).not.toContain(
      'fixture-private-reasoning-never-forward',
    );
  });
});
