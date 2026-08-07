/** Q04 低基数指标的唯一声明表；注册表实现只负责校验和聚合。 */
export type MetricKind = 'counter' | 'histogram' | 'gauge';

export interface MetricDefinition {
  readonly name: string;
  readonly kind: MetricKind;
  /** 允许的标签键；未声明的键会被拒绝。 */
  readonly labelKeys: readonly string[];
  /** 协议型标签的允许值；未列出的 task 等标签由调用方编译期注册表约束。 */
  readonly labelValues?: Readonly<Record<string, readonly string[]>>;
}

export const TURN_METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    name: 'turn_completed_total',
    kind: 'counter',
    labelKeys: ['outcome'],
    labelValues: { outcome: ['completed', 'failed', 'cancelled'] },
  },
  { name: 'turn_ttft_ms', kind: 'histogram', labelKeys: [] },
  { name: 'turn_total_ms', kind: 'histogram', labelKeys: [] },
  {
    name: 'model_error_total',
    kind: 'counter',
    labelKeys: ['code'],
    labelValues: {
      code: [
        'timeout',
        'rate_limit',
        'output_limit',
        'content_filtered',
        'invalid_response',
        'aborted',
        'unavailable',
        'unknown',
      ],
    },
  },
  { name: 'model_first_token_latency_ms', kind: 'histogram', labelKeys: [] },
  { name: 'model_call_latency_ms', kind: 'histogram', labelKeys: [] },
  { name: 'provider_rate_limits_total', kind: 'counter', labelKeys: [] },
  { name: 'turn_model_failed_total', kind: 'counter', labelKeys: [] },
  { name: 'turn_tool_latency_ms', kind: 'histogram', labelKeys: [] },
  {
    name: 'turn_tool_failure_total',
    kind: 'counter',
    labelKeys: ['code'],
    labelValues: {
      code: [
        'INVALID_REQUEST',
        'FORBIDDEN',
        'IDEMPOTENCY_CONFLICT',
        'RATE_LIMITED',
        'POLICY_BLOCKED',
        'CAPABILITY_UNAVAILABLE',
        'APPROVAL_REQUIRED',
        'APPROVAL_DENIED',
        'MODEL_FAILED',
        'TOOL_FAILED',
        'RUNTIME_FAILED',
        'CANCELLED',
        'BUDGET_EXCEEDED',
      ],
    },
  },
  { name: 'turn_tool_outcome_unknown_total', kind: 'counter', labelKeys: [] },
  {
    name: 'retrieval_mode_total',
    kind: 'counter',
    labelKeys: ['mode'],
    labelValues: { mode: ['vector', 'lexical'] },
  },
  {
    // Q02 检索降级 reason 分布：reason 闭集与
    // @educanvas/agent-core 的 RETRIEVAL_DEGRADATION_REASONS 保持同步，
    // 禁止扩展为自由文本（低基数标签约束）。
    name: 'retrieval_degradations',
    kind: 'counter',
    labelKeys: ['reason'],
    labelValues: {
      reason: [
        'not_configured',
        'invalid_configuration',
        'provider_timeout',
        'provider_unavailable',
        'invalid_dimensions',
        'corpus_not_embedded',
        'vector_query_timeout',
        'extension_unavailable',
        'fallback_fts',
      ],
    },
  },
  {
    name: 'worker_task_total',
    kind: 'counter',
    labelKeys: ['task', 'status'],
    labelValues: { status: ['success', 'failed'] },
  },
  { name: 'worker_task_retry_total', kind: 'counter', labelKeys: ['task'] },
  { name: 'artifact_generation_failed_total', kind: 'counter', labelKeys: [] },
  {
    name: 'telemetry_exporter_health',
    kind: 'gauge',
    labelKeys: ['status'],
    labelValues: { status: ['disabled', 'ready', 'degraded'] },
  },
];
