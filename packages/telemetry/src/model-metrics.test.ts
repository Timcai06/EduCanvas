import type { TurnModelEvent, TurnModelGateway } from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics';
import { wrapTurnModelGatewayForMetrics } from './model-metrics';

const event = (
  type: TurnModelEvent['type'],
  overrides: Record<string, unknown> = {},
): TurnModelEvent =>
  ({ phase: 'answer', ...overrides, type }) as TurnModelEvent;

function gatewayWith(events: TurnModelEvent[]): TurnModelGateway {
  return {
    async *streamTurnText() {
      yield* events;
    },
  };
}

async function drain(gateway: TurnModelGateway): Promise<void> {
  for await (const _ of gateway.streamTurnText({} as never)) void _;
}

describe('wrapTurnModelGatewayForMetrics（Q04）', () => {
  it('指标实现抛错时仍原样透传模型事件', async () => {
    const seen: TurnModelEvent['type'][] = [];
    const wrapped = wrapTurnModelGatewayForMetrics(
      gatewayWith([
        event('text_delta', { delta: 'a' }),
        event('completed', { metadata: {} }),
      ]),
      {
        increment() {
          throw new Error('metrics unavailable');
        },
        record() {
          throw new Error('metrics unavailable');
        },
        set() {
          throw new Error('metrics unavailable');
        },
        snapshot: () => ({ counters: {}, histograms: {}, gauges: {} }),
      },
    );
    for await (const yielded of wrapped.streamTurnText({} as never)) {
      seen.push(yielded.type);
    }
    expect(seen).toEqual(['text_delta', 'completed']);
  });

  it('首 token 延迟与调用总延迟按脚本时钟记录', async () => {
    const registry = new MetricsRegistry();
    const times = [0, 300, 800];
    let index = 0;
    const now = () => times[Math.min(index++, times.length - 1)]!;
    const wrapped = wrapTurnModelGatewayForMetrics(
      gatewayWith([
        event('text_delta', { delta: 'a' }),
        event('text_delta', { delta: 'b' }),
        event('completed', { metadata: {} }),
      ]),
      registry,
      { now },
    );
    await drain(wrapped);
    const histograms = registry.snapshot().histograms;
    expect(histograms['model_first_token_latency_ms']!.sum).toBe(300);
    expect(histograms['model_call_latency_ms']!.sum).toBe(800);
  });

  it('failed 事件记录错误码与限流计数，且只结算一次延迟', async () => {
    const registry = new MetricsRegistry();
    const times = [0, 400];
    let index = 0;
    const now = () => times[Math.min(index++, times.length - 1)]!;
    const wrapped = wrapTurnModelGatewayForMetrics(
      gatewayWith([
        event('failed', { error: { code: 'rate_limit', retryable: true } }),
      ]),
      registry,
      { now },
    );
    await drain(wrapped);
    const snapshot = registry.snapshot();
    expect(snapshot.counters['model_error_total{code=rate_limit}']).toBe(1);
    expect(snapshot.counters['provider_rate_limits_total']).toBe(1);
    expect(snapshot.histograms['model_call_latency_ms']!.count).toBe(1);
  });

  it('正常完成不产生错误计数；事件原样透传', async () => {
    const registry = new MetricsRegistry();
    const seen: TurnModelEvent['type'][] = [];
    const wrapped = wrapTurnModelGatewayForMetrics(
      gatewayWith([
        event('text_delta', { delta: 'a' }),
        event('completed', { metadata: {} }),
      ]),
      registry,
    );
    for await (const yielded of wrapped.streamTurnText({} as never)) {
      seen.push(yielded.type);
    }
    expect(seen).toEqual(['text_delta', 'completed']);
    expect(registry.snapshot().counters['model_error_total']).toBeUndefined();
  });

  it('错误码只接受规范化闭集（不记录供应商原始错误）', async () => {
    const registry = new MetricsRegistry();
    const wrapped = wrapTurnModelGatewayForMetrics(
      gatewayWith([
        event('failed', {
          error: { code: 'timeout', retryable: true },
        }),
      ]),
      registry,
    );
    await drain(wrapped);
    expect(
      registry.snapshot().counters['model_error_total{code=timeout}'],
    ).toBe(1);
    expect(JSON.stringify(registry.snapshot())).not.toContain('secret');
  });
});
