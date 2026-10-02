import { describe, expect, it, vi } from 'vitest';
import { TurnApplicationService } from './turn-application';
import {
  collect,
  profile,
  MemoryLifecycle,
  MemoryContextLedger,
  MemoryModelRunLedger,
} from './turn-application.test-support';

describe('Turn Application Context budget', () => {
  it.each([
    ['required_budget', 'BUDGET_EXCEEDED', false],
    ['invalid_version', 'RUNTIME_FAILED', true],
  ] as const)(
    'Context %s 在调用模型前结算一个诚实终态',
    async (reason, code, retryable) => {
      const base = profile();
      const lifecycle = new MemoryLifecycle();
      const contexts = new MemoryContextLedger();
      const models = new MemoryModelRunLedger();
      let providerCalls = 0;
      const diagnostics = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      try {
        const events = await collect(
          new TurnApplicationService({
            lifecycle,
            contextLedger: contexts,
            modelRunLedger: models,
            profile: {
              ...base,
              async prepare(input) {
                const plan = await base.prepare(input);
                return {
                  ...plan,
                  context: {
                    ...plan.context,
                    ...(reason === 'invalid_version'
                      ? { profileVersion: 'INVALID' }
                      : {
                          maxCharacters: 128_000,
                          sourcesAndAssets: [0, 1].map((index) => ({
                            segment: {
                              id: `source:large-${index}`,
                              kind: 'source' as const,
                              assetVersionId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
                              content: 'a'.repeat(90_000),
                              priority: 95,
                              required: true,
                            },
                            message: {
                              role: 'user' as const,
                              content: 'a'.repeat(90_000),
                            },
                          })),
                        }),
                  },
                };
              },
            },
            modelGateway: {
              async *streamTurnText() {
                providerCalls += 1;
              },
            },
          }),
        );
        expect(events.filter((event) => event.type === 'turn.failed')).toEqual([
          expect.objectContaining({ code, retryable }),
        ]);
        expect(lifecycle.settlements).toEqual([
          expect.objectContaining({
            status: 'failed',
            failureCode: code,
            retryable,
          }),
        ]);
        expect(providerCalls).toBe(0);
        expect(contexts.writes).toHaveLength(0);
        expect(models.runs).toHaveLength(0);
      } finally {
        diagnostics.mockRestore();
      }
    },
  );
});
