import { describe, expect, it } from 'vitest';
import { TurnApplicationService } from './turn-application';
import {
  collect,
  profile,
  MemoryLifecycle,
  MemoryContextLedger,
  MemoryModelRunLedger,
} from './turn-application.test-support';

describe('Turn output limit', () => {
  it('retains the partial answer and settles once without another model call', async () => {
    const lifecycle = new MemoryLifecycle();
    const models = new MemoryModelRunLedger();
    let calls = 0;
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        profile: profile(),
        modelGateway: {
          async *streamTurnText(request) {
            calls += 1;
            yield {
              type: 'text_delta',
              phase: request.phase,
              delta: '已生成的部分正文',
            };
            yield {
              type: 'completed',
              phase: request.phase,
              metadata: {
                providerResponseId: null,
                provider: 'fixture',
                taskAlias: request.taskAlias,
                modelAlias: request.modelAlias,
                resolvedModelId: 'fixture',
                modelRevision: null,
                systemFingerprint: null,
                finishReason: 'length',
                usage: {
                  inputTokens: 10,
                  outputTokens: 2048,
                  cacheHitTokens: 0,
                  reasoningTokens: 0,
                },
                latencyMs: 1,
                traceId: request.traceId,
              },
            };
          },
        },
      }),
    );
    expect(calls).toBe(1);
    expect(models.runs).toHaveLength(1);
    expect(events.filter((event) => event.type === 'message.delta')).toEqual([
      expect.objectContaining({ delta: '已生成的部分正文' }),
    ]);
    expect(events.filter((event) => event.type === 'turn.failed')).toEqual([
      expect.objectContaining({ code: 'BUDGET_EXCEEDED', retryable: false }),
    ]);
    expect(events.some((event) => event.type === 'turn.completed')).toBe(false);
    expect(lifecycle.settlements).toEqual([
      expect.objectContaining({
        status: 'failed',
        content: '已生成的部分正文',
        failureCode: 'BUDGET_EXCEEDED',
        retryable: false,
      }),
    ]);
  });
});
