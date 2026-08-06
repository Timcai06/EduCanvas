/**
 * Q04 Metrics 注册表 — 进程内低基数指标管线。
 *
 * 设计纪律：
 * - 指标名与标签键都必须是声明的闭集（TURN_METRIC_DEFINITIONS），防止高基数泄漏；
 * - 标签值强制短斜杠串（/^[a-z0-9_.:-]{1,64}$/），任何用户 ID、正文、URL、对象路径、
 *   Secret 或原始错误都不会通过；
 * - 注册表只是事件的进程内聚合（snapshot 供端点与测试断言），业务事实仍以 DB 账本为准；
 * - 不依赖 Collector/Exporter：告警必须能在无 Exporter 时基于 snapshot 生效。
 */

const LABEL_VALUE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

export type MetricKind = 'counter' | 'histogram' | 'gauge';

export interface MetricDefinition {
  readonly name: string;
  readonly kind: MetricKind;
  /** 允许的标签键；未声明的键会被拒绝。 */
  readonly labelKeys: readonly string[];
}

export const TURN_METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  // Turn 成功/失败/取消（outcome 为闭集）
  { name: 'turn_completed_total', kind: 'counter', labelKeys: ['outcome'] },
  // TTFT 与总延迟（毫秒）
  { name: 'turn_ttft_ms', kind: 'histogram', labelKeys: [] },
  { name: 'turn_total_ms', kind: 'histogram', labelKeys: [] },
  // 模型级错误与延迟（teaching 路径逐调用；code 为规范化错误码闭集）
  { name: 'model_error_total', kind: 'counter', labelKeys: ['code'] },
  { name: 'model_first_token_latency_ms', kind: 'histogram', labelKeys: [] },
  { name: 'model_call_latency_ms', kind: 'histogram', labelKeys: [] },
  { name: 'provider_rate_limits_total', kind: 'counter', labelKeys: [] },
  // Turn 因模型失败而失败的稳定计数
  { name: 'turn_model_failed_total', kind: 'counter', labelKeys: [] },
  // 工具延迟 / 失败 / outcome_unknown（code 为 turn 失败码闭集）
  { name: 'turn_tool_latency_ms', kind: 'histogram', labelKeys: [] },
  { name: 'turn_tool_failure_total', kind: 'counter', labelKeys: ['code'] },
  { name: 'turn_tool_outcome_unknown_total', kind: 'counter', labelKeys: [] },
  // 检索模式（vector 命中 / lexical 回退）
  { name: 'retrieval_mode_total', kind: 'counter', labelKeys: ['mode'] },
  // Worker 任务结果与重试（task 为任务名闭集）
  { name: 'worker_task_total', kind: 'counter', labelKeys: ['task', 'status'] },
  { name: 'worker_task_retry_total', kind: 'counter', labelKeys: ['task'] },
  // Artifact 生成失败（用户可见 SLI；artifact.failed 事件投影）
  { name: 'artifact_generation_failed_total', kind: 'counter', labelKeys: [] },
  // Telemetry exporter 健康（status 为 health 状态闭集；当前状态值为 1）
  { name: 'telemetry_exporter_health', kind: 'gauge', labelKeys: ['status'] },
];

export interface HistogramPoint {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  /** 非累计桶：bound 表示 (prev, bound] 区间内的样本数；overflow 为超出最大边界。 */
  readonly buckets: Readonly<Record<string, number>>;
  readonly overflow: number;
}

/** 稳定、JSON 可序列化的进程内快照；`${name}{k=v,...}` 为点键。 */
export interface MetricsSnapshot {
  readonly counters: Readonly<Record<string, number>>;
  readonly histograms: Readonly<Record<string, HistogramPoint>>;
  readonly gauges: Readonly<Record<string, number>>;
}

const HISTOGRAM_BOUNDARIES = [
  10, 25, 50, 100, 250, 500, 1_000, 2_000, 5_000, 10_000, 30_000,
] as const;

export class MetricsValidationError extends Error {
  constructor(
    public readonly code:
      | 'unknown_metric'
      | 'undeclared_label_key'
      | 'invalid_label_value'
      | 'invalid_value',
    message: string,
  ) {
    super(message);
    this.name = 'MetricsValidationError';
  }
}

interface CounterState {
  readonly points: Map<string, number>;
}
interface HistogramState {
  readonly points: Map<string, HistogramPoint>;
}
interface GaugeState {
  readonly points: Map<string, number>;
}

export interface MetricsPort {
  increment(name: string, labels?: Readonly<Record<string, string>>): void;
  record(
    name: string,
    valueMs: number,
    labels?: Readonly<Record<string, string>>,
  ): void;
  set(
    name: string,
    value: number,
    labels?: Readonly<Record<string, string>>,
  ): void;
  snapshot(): MetricsSnapshot;
}

const pointKey = (
  name: string,
  labels: Readonly<Record<string, string>>,
): string => {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return name;
  return `${name}{${keys.map((key) => `${key}=${labels[key]}`).join(',')}}`;
};

export class MetricsRegistry implements MetricsPort {
  private readonly definitions: ReadonlyMap<string, MetricDefinition>;
  private readonly counters = new Map<string, CounterState>();
  private readonly histograms = new Map<string, HistogramState>();
  private readonly gauges = new Map<string, GaugeState>();

  constructor(
    definitions: readonly MetricDefinition[] = TURN_METRIC_DEFINITIONS,
  ) {
    this.definitions = new Map(
      definitions.map((definition) => [definition.name, definition]),
    );
  }

  increment(name: string, labels: Readonly<Record<string, string>> = {}): void {
    const definition = this.requireDefinition(name, 'counter');
    this.assertLabels(definition, labels);
    const state = this.requireCounterState(definition.name);
    const key = pointKey(name, labels);
    state.points.set(key, (state.points.get(key) ?? 0) + 1);
  }

  record(
    name: string,
    valueMs: number,
    labels: Readonly<Record<string, string>> = {},
  ): void {
    const definition = this.requireDefinition(name, 'histogram');
    this.assertLabels(definition, labels);
    if (!Number.isFinite(valueMs) || valueMs < 0) {
      throw new MetricsValidationError(
        'invalid_value',
        `histogram ${name} 需要非负有限毫秒值`,
      );
    }
    const state = this.requireHistogramState(definition.name);
    const key = pointKey(name, labels);
    const current = state.points.get(key) ?? emptyHistogram();
    const buckets = { ...current.buckets };
    // 非累计桶：命中第一个 >= value 的边界；无边界则落入 overflow。
    const boundIndex = HISTOGRAM_BOUNDARIES.findIndex(
      (bound) => valueMs <= bound,
    );
    let overflow = current.overflow;
    if (boundIndex === -1) {
      overflow += 1;
    } else {
      const bound = String(HISTOGRAM_BOUNDARIES[boundIndex]);
      buckets[bound] = (buckets[bound] ?? 0) + 1;
    }
    state.points.set(key, {
      count: current.count + 1,
      sum: current.sum + valueMs,
      min: Math.min(current.min, valueMs),
      max: Math.max(current.max, valueMs),
      buckets,
      overflow,
    });
  }

  set(
    name: string,
    value: number,
    labels: Readonly<Record<string, string>> = {},
  ): void {
    const definition = this.requireDefinition(name, 'gauge');
    this.assertLabels(definition, labels);
    if (!Number.isFinite(value)) {
      throw new MetricsValidationError(
        'invalid_value',
        `gauge ${name} 需要有限数值`,
      );
    }
    const state = this.requireGaugeState(definition.name);
    // gauge 只表达一个当前状态：新点覆盖旧点。
    state.points.clear();
    state.points.set(pointKey(name, labels), value);
  }

  snapshot(): MetricsSnapshot {
    const counters: Record<string, number> = {};
    for (const state of this.counters.values()) {
      for (const [key, value] of state.points) counters[key] = value;
    }
    const histograms: Record<string, HistogramPoint> = {};
    for (const state of this.histograms.values()) {
      for (const [key, value] of state.points) histograms[key] = value;
    }
    const gauges: Record<string, number> = {};
    for (const state of this.gauges.values()) {
      for (const [key, value] of state.points) gauges[key] = value;
    }
    return { counters, histograms, gauges };
  }

  private requireDefinition(name: string, kind: MetricKind): MetricDefinition {
    const definition = this.definitions.get(name);
    if (definition === undefined) {
      throw new MetricsValidationError('unknown_metric', `未声明指标 ${name}`);
    }
    if (definition.kind !== kind) {
      throw new MetricsValidationError(
        'invalid_value',
        `指标 ${name} 类型是 ${definition.kind}，不是 ${kind}`,
      );
    }
    return definition;
  }

  private assertLabels(
    definition: MetricDefinition,
    labels: Readonly<Record<string, string>>,
  ): void {
    for (const key of Object.keys(labels)) {
      if (!definition.labelKeys.includes(key)) {
        throw new MetricsValidationError(
          'undeclared_label_key',
          `指标 ${definition.name} 未声明标签键 ${key}`,
        );
      }
      const value = labels[key];
      if (value === undefined || !LABEL_VALUE_PATTERN.test(value)) {
        throw new MetricsValidationError(
          'invalid_label_value',
          `标签 ${key} 的值不符合低基数格式`,
        );
      }
    }
  }

  private requireCounterState(name: string): CounterState {
    let state = this.counters.get(name);
    if (state === undefined) {
      state = { points: new Map() };
      this.counters.set(name, state);
    }
    return state;
  }

  private requireHistogramState(name: string): HistogramState {
    let state = this.histograms.get(name);
    if (state === undefined) {
      state = { points: new Map() };
      this.histograms.set(name, state);
    }
    return state;
  }

  private requireGaugeState(name: string): GaugeState {
    let state = this.gauges.get(name);
    if (state === undefined) {
      state = { points: new Map() };
      this.gauges.set(name, state);
    }
    return state;
  }
}

const emptyHistogram = (): HistogramPoint => ({
  count: 0,
  sum: 0,
  min: Number.POSITIVE_INFINITY,
  max: 0,
  buckets: {},
  overflow: 0,
});

/** 禁用 Runtime 使用的安全空实现：记录是 no-op，快照恒为空。 */
export const NOOP_METRICS: MetricsPort = {
  increment() {},
  record() {},
  set() {},
  snapshot: () => ({ counters: {}, histograms: {}, gauges: {} }),
};
