import { describe, expect, it } from 'vitest';
import { TurnApplicationService } from './turn-application';
import {
  MemoryContextLedger,
  MemoryLifecycle,
  MemoryModelRunLedger,
  collect,
  profile,
} from './turn-application.test-support';

describe('TurnApplicationService runtime failures', () => {
  it('Model Run 账本启动失败归类为运行时失败，不伪装成模型失败', async () => {
    const models = new MemoryModelRunLedger();
    models.createOrGet = async () => {
      throw new Error('private ledger backend detail');
    };
    let providerCalls = 0;
    const lifecycle = new MemoryLifecycle();
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: {
          async *streamTurnText() {
            providerCalls += 1;
          },
        },
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'RUNTIME_FAILED',
      retryable: true,
    });
    expect(providerCalls).toBe(0);
    expect(lifecycle.settlements.at(-1)).toMatchObject({
      status: 'failed',
      failureCode: 'RUNTIME_FAILED',
      retryable: true,
    });
    expect(JSON.stringify(events)).not.toContain(
      'private ledger backend detail',
    );
  });
});
