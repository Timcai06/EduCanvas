import { describe, expect, it } from 'vitest';
import type { TurnModelGateway } from '@educanvas/agent-core';
import { TurnApplicationService } from './turn-application';
import {
  MemoryContextLedger,
  MemoryLifecycle,
  MemoryModelRunLedger,
  collect,
  profile,
} from './turn-application.test-support';

describe('TurnApplicationService (server-confirmed cancellation)', () => {
  it('只在服务端取消已落账时收敛为cancelled', async () => {
    const lifecycle = new MemoryLifecycle();
    const models = new MemoryModelRunLedger();
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        yield {
          type: 'failed',
          phase: request.phase,
          error: { code: 'aborted', retryable: false },
        };
      },
    };
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: gateway,
        cancellation: {
          async open() {
            return {
              signal: {
                aborted: true,
                addEventListener() {},
                removeEventListener() {},
              },
              async isCancellationRequested() {
                return true;
              },
              close() {},
            };
          },
        },
      }),
    );

    expect(events.at(-1)?.type).toBe('turn.cancelled');
    expect(models.runs[0]).toMatchObject({
      status: 'cancelled',
      errorCode: 'model_aborted',
    });
    expect(lifecycle.settlements[0]).toMatchObject({
      status: 'cancelled',
      retryable: false,
    });
  });

  it('取消监听建立失败时冻结为可重试的Runtime终态', async () => {
    const lifecycle = new MemoryLifecycle();
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: new MemoryModelRunLedger(),
        modelGateway: {
          async *streamTurnText() {
            throw new Error('provider_must_not_run');
          },
        },
        cancellation: {
          async open() {
            throw new Error('watcher_unavailable');
          },
        },
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'RUNTIME_FAILED',
      retryable: true,
    });
    expect(lifecycle.settlements[0]).toMatchObject({
      status: 'failed',
      failureCode: 'RUNTIME_FAILED',
      retryable: true,
    });
  });
});
