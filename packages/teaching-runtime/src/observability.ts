/**
 * 教学可观测性 — best-effort 旁路指标。
 *
 * ## 设计原则
 *
 * - 指标是旁路：观测后端故障不能改变教学结果
 * - 零正文：联合中没有 labels/message/text/trace 字段，避免高基数与正文外泄
 * - recordTeachingMetric 静默丢弃失败 — 不抛异常，不记录异常正文日志
 *
 * ## 指标列表
 *
 * | 指标 | 含义 |
 * |------|------|
 * | provider_calls_per_completed_turn | 每个完成 turn 的 Provider 调用次数 |
 * | model_first_token_latency_ms | 首 token 延迟 |
 * | model_call_latency_ms | 模型调用总延迟 |
 * | teaching_turn_latency_ms | 教学 turn 总延迟 |
 * | policy_blocks | 安全策略拦截次数 |
 * | provider_rate_limits | Provider 限流次数 |
 * | tool_rejections | 工具执行拒绝次数 |
 * | citation_invalid | 引用标注无效次数 |
 */

import type { ModelAlias, TaskAlias } from '@educanvas/agent-core';
import type {
  TeachingSafetyAction,
  TeachingSafetyCategory,
  TeachingSafetyPhase,
  TeachingSafetyPolicyCode,
  TeachingTool,
} from '@educanvas/teaching-core';
import type { ToolKernelFailureCode } from '@educanvas/agent-runtime';

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
      code: ToolKernelFailureCode;
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
