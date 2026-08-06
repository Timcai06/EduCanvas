/**
 * Q04 模型网关指标包装器 — 在组合根包装 TurnModelGateway 的每次调用。
 *
 * 逐调用记录：首 token 延迟、调用总延迟、规范化错误码计数、限流计数。
 * 错误码只取 normalizedModelErrorCodes 闭集，不记录供应商消息或请求体。
 */

import type { TurnModelGateway, TurnModelEvent } from '@educanvas/agent-core';
import type { MetricsPort } from './metrics';

export type ModelMetricsOptions = {
  /** 时间源（毫秒）；测试注入可控时钟。 */
  now?: () => number;
};

const defaultNow = (): number => performance.now();

/** 包装一个网关：每次 streamTurnText 调用都被计时并记录结果。 */
export function wrapTurnModelGatewayForMetrics(
  gateway: TurnModelGateway,
  metrics: MetricsPort,
  options: ModelMetricsOptions = {},
): TurnModelGateway {
  const now = options.now ?? defaultNow;
  return {
    async *streamTurnText(request) {
      const startedAt = now();
      let firstDeltaAt: number | null = null;
      for await (const event of gateway.streamTurnText(request)) {
        if (event.type === 'text_delta' && firstDeltaAt === null) {
          firstDeltaAt = now();
          metrics.record(
            'model_first_token_latency_ms',
            firstDeltaAt - startedAt,
          );
        }
        if (event.type === 'failed') {
          metrics.record('model_call_latency_ms', now() - startedAt);
          metrics.increment('model_error_total', { code: event.error.code });
          if (event.error.code === 'rate_limit') {
            metrics.increment('provider_rate_limits_total');
          }
          yield event;
          return;
        }
        yield event;
      }
      metrics.record('model_call_latency_ms', now() - startedAt);
    },
  };
}
