import type {
  ModelAlias,
  TaskAlias,
  TeachingSafetyAction,
  TeachingSafetyCategory,
  TeachingSafetyPhase,
  TeachingSafetyPolicyCode,
  TeachingTool,
} from '@educanvas/teaching-core';
import type { ToolExecutionRejectionCode } from './tool-executor';

export const teachingMetricNames = Object.freeze([
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
] as const);

export const observableProviderAliases = Object.freeze([
  'deepseek',
  'openai-compatible',
  'scripted',
  'unknown',
] as const);

export type ObservableProviderAlias =
  (typeof observableProviderAliases)[number];
export type TeachingMetricName = (typeof teachingMetricNames)[number];

interface NumericMetric<Name extends TeachingMetricName> {
  name: Name;
  /** Counter、gauge或毫秒值；禁止用字符串承载正文。 */
  value: number;
}

/** 封闭联合中没有任意 labels/message/text/trace 字段，避免高基数与正文外泄。 */
export type TeachingMetricEvent =
  | (NumericMetric<'provider_calls_per_completed_turn'> & {
      taskAlias: TaskAlias;
      modelAlias: ModelAlias;
    })
  | NumericMetric<'completed_assistant_messages_without_model_run'>
  | (NumericMetric<'model_first_token_latency_ms' | 'model_call_latency_ms'> & {
      providerAlias: ObservableProviderAlias;
      modelAlias: ModelAlias;
    })
  | (NumericMetric<'teaching_turn_latency_ms'> & {
      modelAlias: ModelAlias;
    })
  | (NumericMetric<'expired_streaming_turns'> & {
      code: 'lease_expired' | 'interrupted';
    })
  | (NumericMetric<'policy_blocks'> & {
      phase: TeachingSafetyPhase;
      category: TeachingSafetyCategory;
      action: Extract<TeachingSafetyAction, 'block' | 'escalate'>;
      policyCode: Exclude<TeachingSafetyPolicyCode, 'k12_allowed'>;
    })
  | (NumericMetric<'provider_rate_limits'> & {
      providerAlias: ObservableProviderAlias;
      modelAlias: ModelAlias;
      code: 'rate_limit';
    })
  | (NumericMetric<'tool_rejections'> & {
      toolAlias: TeachingTool | 'unknown';
      code: ToolExecutionRejectionCode;
    })
  | (NumericMetric<'citation_invalid'> & {
      code:
        | 'not_in_candidate_set'
        | 'ownership_mismatch'
        | 'version_mismatch'
        | 'unknown';
    })
  | (NumericMetric<'anonymous_cleanup_failures'> & {
      code: 'transaction_failed' | 'residual_rows' | 'unknown';
    });

export interface TeachingObservabilityPort {
  record(metric: Readonly<TeachingMetricEvent>): void;
}

/** 指标是best-effort旁路，不能因观测后端故障改变教学结果。 */
export function recordTeachingMetric(
  port: TeachingObservabilityPort | undefined,
  metric: TeachingMetricEvent,
): void {
  if (
    port === undefined ||
    !Number.isFinite(metric.value) ||
    metric.value < 0
  ) {
    return;
  }
  try {
    port.record(Object.freeze({ ...metric }));
  } catch {
    // 观测失败不得进入学生路径，也不能回退为包含异常正文的日志。
  }
}
