/**
 * Q04 Turn 事件流指标包装器 — 在组合根包装 `service.run` 的输出流。
 *
 * 只读取公开事件（turn-application-contracts），不触碰 agent-runtime 内部；
 * 记录的都是聚合计数/直方图，不记录正文、用户 ID 或任何敏感字段。
 * 时间源可注入（测试用），默认 performance.now()。
 */

import type { TurnApplicationEvent } from '@educanvas/agent-core';
import { recordMetricSafely, type MetricsPort } from './metrics';

export type TurnMetricsOptions = {
  /** 时间源（毫秒）；测试注入可控时钟。 */
  now?: () => number;
};

const defaultNow = (): number => performance.now();

export async function* wrapTurnApplicationStream(
  events: AsyncIterable<TurnApplicationEvent>,
  metrics: MetricsPort,
  options: TurnMetricsOptions = {},
): AsyncIterable<TurnApplicationEvent> {
  const now = options.now ?? defaultNow;
  let startedAt: number | null = null;
  let firstDeltaAt: number | null = null;
  const toolStartedAt = new Map<string, number>();

  for await (const event of events) {
    if (event.type === 'turn.started') {
      startedAt = now();
      firstDeltaAt = null;
      toolStartedAt.clear();
    } else if (startedAt !== null) {
      switch (event.type) {
        case 'message.delta': {
          if (firstDeltaAt === null) {
            firstDeltaAt = now();
            const elapsedMs = firstDeltaAt - startedAt;
            recordMetricSafely(() => metrics.record('turn_ttft_ms', elapsedMs));
          }
          break;
        }
        case 'tool.started': {
          toolStartedAt.set(event.toolCallId, now());
          break;
        }
        case 'tool.completed':
        case 'tool.failed': {
          const toolStarted = toolStartedAt.get(event.toolCallId);
          if (toolStarted !== undefined) {
            recordMetricSafely(() =>
              metrics.record('turn_tool_latency_ms', now() - toolStarted),
            );
            toolStartedAt.delete(event.toolCallId);
          }
          if (event.type === 'tool.failed') {
            recordMetricSafely(() =>
              metrics.increment('turn_tool_failure_total', {
                code: event.code,
              }),
            );
          }
          break;
        }
        case 'artifact.failed': {
          recordMetricSafely(() =>
            metrics.increment('artifact_generation_failed_total'),
          );
          break;
        }
        case 'turn.completed':
        case 'turn.failed':
        case 'turn.cancelled': {
          recordMetricSafely(() =>
            metrics.increment('turn_completed_total', {
              outcome:
                event.type === 'turn.completed'
                  ? 'completed'
                  : event.type === 'turn.failed'
                    ? 'failed'
                    : 'cancelled',
            }),
          );
          const elapsedMs = now() - startedAt;
          recordMetricSafely(() => metrics.record('turn_total_ms', elapsedMs));
          if (event.type === 'turn.failed' && event.code === 'MODEL_FAILED') {
            recordMetricSafely(() =>
              metrics.increment('turn_model_failed_total'),
            );
          }
          startedAt = null;
          break;
        }
        default:
          break;
      }
    }
    yield event;
  }
  // 事件流自然结束（终态事件或异常截断）时仍未结算的工具调用 = outcome_unknown：
  // 与 DB 账本（AgentToolCallStatus）同语义的投影，不读取任何工具正文。
  if (toolStartedAt.size > 0) {
    recordMetricSafely(() =>
      metrics.increment('turn_tool_outcome_unknown_total'),
    );
  }
}
