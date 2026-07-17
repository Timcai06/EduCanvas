import { describe, expect, it, vi } from 'vitest';
import {
  recordTeachingMetric,
  teachingMetricNames,
  type TeachingMetricEvent,
  type TeachingObservabilityPort,
} from './observability';

describe('low-cardinality teaching observability', () => {
  it('固定关键指标名且事件只暴露alias/code/数值', () => {
    expect(teachingMetricNames).toEqual([
      'provider_calls_per_completed_turn',
      'completed_assistant_messages_without_model_run',
      'model_first_token_latency_ms',
      'model_call_latency_ms',
      'teaching_turn_latency_ms',
      'expired_streaming_turns',
      'policy_blocks',
      'provider_rate_limits',
      'tool_rejections',
      'citation_invalid',
      'anonymous_cleanup_failures',
    ]);
    expect(Object.isFrozen(teachingMetricNames)).toBe(true);

    const metric: TeachingMetricEvent = {
      name: 'policy_blocks',
      value: 1,
      phase: 'input',
      category: 'prompt_injection',
      action: 'block',
      policyCode: 'k12_prompt_injection_detected',
    };
    expect(metric).not.toHaveProperty('text');
    expect(metric).not.toHaveProperty('traceId');
  });

  it('冻结后旁路上报，非法数值或观测异常不影响教学路径', () => {
    const record = vi.fn();
    const port: TeachingObservabilityPort = { record };
    recordTeachingMetric(port, {
      name: 'provider_rate_limits',
      value: 1,
      providerAlias: 'deepseek',
      modelAlias: 'primary',
      code: 'rate_limit',
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'provider_rate_limits', value: 1 }),
    );
    expect(Object.isFrozen(record.mock.calls[0]?.[0])).toBe(true);

    recordTeachingMetric(port, {
      name: 'teaching_turn_latency_ms',
      value: Number.NaN,
      modelAlias: 'primary',
    });
    expect(record).toHaveBeenCalledTimes(1);

    expect(() =>
      recordTeachingMetric(
        {
          record: () =>
            void (() => {
              throw new Error('sink-secret');
            })(),
        },
        {
          name: 'completed_assistant_messages_without_model_run',
          value: 0,
        },
      ),
    ).not.toThrow();
  });
});
