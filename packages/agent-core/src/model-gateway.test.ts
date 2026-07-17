import { describe, expect, it } from 'vitest';
import type { TurnModelGateway } from './model-gateway';
import type { TurnModelEvent } from './model-contracts';

describe('generic agent turn contract', () => {
  it('不加载课程、掌握度或教学状态也能成立', async () => {
    const gateway: TurnModelGateway = {
      async *streamTurnText(request): AsyncIterable<TurnModelEvent> {
        expect(request.taskAlias).toBe('agent.turn');
        yield {
          type: 'text_delta',
          phase: request.phase,
          delta: '已看到图片。',
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: {
            providerResponseId: 'response-generic-1',
            provider: 'fixture-provider',
            taskAlias: request.taskAlias,
            modelAlias: request.modelAlias,
            resolvedModelId: 'fixture/model-v1',
            modelRevision: null,
            systemFingerprint: null,
            finishReason: 'stop',
            usage: {
              inputTokens: 4,
              outputTokens: 5,
              cacheHitTokens: 0,
              reasoningTokens: 0,
            },
            latencyMs: 1,
            traceId: request.traceId,
          },
        };
      },
    };

    const events: TurnModelEvent[] = [];
    for await (const event of gateway.streamTurnText({
      taskAlias: 'agent.turn',
      modelAlias: 'primary',
      phase: 'answer',
      messages: [{ role: 'user', content: '描述这张图片' }],
      tools: [],
      toolResults: [],
      promptVersion: 'agent-turn-v1',
      traceId: 'trace-generic-1',
      turnId: 'turn-generic-1',
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'completed',
    ]);
  });
});
