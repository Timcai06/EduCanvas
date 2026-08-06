import { describe, expect, it } from 'vitest';
import type { TurnModelGateway } from '@educanvas/agent-core';
import { createTurnApplication } from './turn-application';
import {
  ASSISTANT_MESSAGE_ID,
  MemoryContextLedger,
  MemoryLifecycle,
  MemoryModelRunLedger,
  OPERATION_ID,
  collect,
  metadata,
  profile,
} from './turn-application.test-support';

/**
 * 跨入口一致性测试（R06）：Web General / Web Teaching / Gateway 三条生产路径统一经
 * `createTurnApplication` 组装，本套场景固定"同一输入 → 同一终态、错误码、取消与账本切片"
 * 语义，防止入口各自分化。
 */
describe('跨入口 Turn Application 一致性（统一工厂）', () => {
  it('成功：同一输入收敛为 completed 且账本切片一致', async () => {
    const lifecycle = new MemoryLifecycle();
    const models = new MemoryModelRunLedger();
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        yield { type: 'text_delta', phase: request.phase, delta: '回答。' };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'stop'),
        };
      },
    };
    const events = await collect(
      createTurnApplication({
        lifecycle,
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: gateway,
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'turn.completed',
    ]);
    expect(models.runs[0]).toMatchObject({
      status: 'succeeded',
      provider: 'fixture',
    });
    expect(lifecycle.settlements[0]?.status).toBe('completed');
  });

  it('失败：Provider 非法流结算为 MODEL_FAILED，不得误记成功', async () => {
    const models = new MemoryModelRunLedger();
    const events = await collect(
      createTurnApplication({
        lifecycle: new MemoryLifecycle(),
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: {
          async *streamTurnText(request) {
            yield {
              type: 'completed',
              phase: request.phase,
              metadata: metadata(request, 'stop'),
            };
          },
        },
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'MODEL_FAILED',
    });
    expect(models.runs[0]).toMatchObject({
      status: 'failed',
      errorCode: 'model_invalid_response',
    });
  });

  it('取消：服务端确认取消才收敛为 cancelled，账本同态', async () => {
    const lifecycle = new MemoryLifecycle();
    const models = new MemoryModelRunLedger();
    const events = await collect(
      createTurnApplication({
        lifecycle,
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: {
          async *streamTurnText(request) {
            yield {
              type: 'failed',
              phase: request.phase,
              error: { code: 'aborted', retryable: false },
            };
          },
        },
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
    expect(lifecycle.settlements[0]?.status).toBe('cancelled');
  });

  // 与 general-turn.ts:35-43 unavailableModelGateway 相同形状：retryable 会触发
  // Agent Loop 指数退避重试（1s/2s/4s 上限 8s），耗尽 3 次后仍诚实失败，故放宽超时。
  it('缺 capability：模型能力不可用时诚实失败，不伪造空能力成功', async () => {
    const models = new MemoryModelRunLedger();
    const events = await collect(
      createTurnApplication({
        lifecycle: new MemoryLifecycle(),
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: {
          async *streamTurnText(request) {
            yield {
              type: 'failed',
              phase: request.phase,
              error: { code: 'unavailable', retryable: true },
            };
          },
        },
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'MODEL_FAILED',
      retryable: true,
    });
    expect(models.runs[0]?.status).toBe('failed');
  }, 20_000);

  it('replay：只投影既有终态，不再次读取 Context 或调用 Provider', async () => {
    const lifecycle = new MemoryLifecycle(true, [
      {
        protocol: 'educanvas.turn.v2',
        operationId: OPERATION_ID,
        type: 'message.delta',
        messageId: ASSISTANT_MESSAGE_ID,
        delta: '既有回答',
      },
      {
        protocol: 'educanvas.turn.v2',
        operationId: OPERATION_ID,
        type: 'turn.completed',
        messageId: ASSISTANT_MESSAGE_ID,
      },
    ]);
    let providerCalls = 0;
    const contexts = new MemoryContextLedger();
    const events = await collect(
      createTurnApplication({
        lifecycle,
        profile: profile(),
        contextLedger: contexts,
        modelRunLedger: new MemoryModelRunLedger(),
        modelGateway: {
          async *streamTurnText() {
            providerCalls += 1;
          },
        },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'turn.completed',
    ]);
    expect(contexts.writes).toHaveLength(0);
    expect(providerCalls).toBe(0);
  });
});
