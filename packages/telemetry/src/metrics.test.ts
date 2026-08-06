import { describe, expect, it } from 'vitest';
import {
  MetricsRegistry,
  MetricsValidationError,
  TURN_METRIC_DEFINITIONS,
} from './metrics';

describe('MetricsRegistry（Q04）', () => {
  it('未声明指标名被拒绝（闭集防高基数）', () => {
    const registry = new MetricsRegistry();
    expect(() => registry.increment('user_typed_text')).toThrow(
      MetricsValidationError,
    );
    expect(() => registry.increment('user_typed_text')).toThrow(/未声明指标/);
  });

  it('未声明标签键被拒绝', () => {
    const registry = new MetricsRegistry();
    expect(() =>
      registry.increment('turn_completed_total', { userId: 'u-1' }),
    ).toThrow(/未声明标签键 userId/);
  });

  it('标签值必须是短斜杠串（拒绝正文/路径/URL）', () => {
    const registry = new MetricsRegistry();
    expect(() =>
      registry.increment('turn_completed_total', {
        outcome: 'http://x/某用户正文',
      }),
    ).toThrow(/低基数格式/);
    expect(() =>
      registry.increment('worker_task_total', {
        task: 'artifact:generate',
        status: 'failed',
      }),
    ).not.toThrow();
  });

  it('counter 与标签聚合', () => {
    const registry = new MetricsRegistry();
    registry.increment('turn_completed_total', { outcome: 'completed' });
    registry.increment('turn_completed_total', { outcome: 'completed' });
    registry.increment('turn_completed_total', { outcome: 'failed' });
    const snapshot = registry.snapshot();
    expect(snapshot.counters['turn_completed_total{outcome=completed}']).toBe(
      2,
    );
    expect(snapshot.counters['turn_completed_total{outcome=failed}']).toBe(1);
  });

  it('histogram 记录 count/sum/min/max 与非累计桶', () => {
    const registry = new MetricsRegistry();
    registry.record('turn_ttft_ms', 40);
    registry.record('turn_ttft_ms', 120);
    registry.record('turn_ttft_ms', 3_000);
    const point = registry.snapshot().histograms['turn_ttft_ms']!;
    expect(point.count).toBe(3);
    expect(point.sum).toBe(3_160);
    expect(point.min).toBe(40);
    expect(point.max).toBe(3_000);
    expect(point.buckets['50']).toBe(1);
    expect(point.buckets['250']).toBe(1);
    expect(point.buckets['5000']).toBe(1);
    expect(point.overflow).toBe(0);
  });

  it('超出最大边界的样本进入 overflow', () => {
    const registry = new MetricsRegistry();
    registry.record('turn_total_ms', 60_000);
    expect(registry.snapshot().histograms['turn_total_ms']!.overflow).toBe(1);
  });

  it('histogram 拒绝负数与非有限值', () => {
    const registry = new MetricsRegistry();
    expect(() => registry.record('turn_total_ms', -1)).toThrow(/非负有限/);
    expect(() => registry.record('turn_total_ms', Number.NaN)).toThrow(
      /非负有限/,
    );
  });

  it('gauge 记录与覆盖', () => {
    const registry = new MetricsRegistry();
    registry.set('telemetry_exporter_health', 1, { status: 'ready' });
    expect(
      registry.snapshot().gauges['telemetry_exporter_health{status=ready}'],
    ).toBe(1);
    registry.set('telemetry_exporter_health', 1, { status: 'degraded' });
    const gauges = registry.snapshot().gauges;
    expect(gauges['telemetry_exporter_health{status=ready}']).toBeUndefined();
    expect(gauges['telemetry_exporter_health{status=degraded}']).toBe(1);
  });

  it('指标定义覆盖 Q04 全部 8 项最低 SLI', () => {
    const names = new Set(TURN_METRIC_DEFINITIONS.map((d) => d.name));
    expect(names).toContain('turn_completed_total'); // Turn 成功/失败/取消
    expect(names).toContain('turn_ttft_ms'); // TTFT
    expect(names).toContain('turn_total_ms'); // 总延迟
    expect(names).toContain('model_error_total'); // Model/provider 错误
    expect(names).toContain('turn_tool_latency_ms'); // Tool 延迟
    expect(names).toContain('turn_tool_failure_total'); // Tool 失败
    expect(names).toContain('turn_tool_outcome_unknown_total'); // outcome_unknown
    expect(names).toContain('retrieval_mode_total'); // 检索 fallback/vector
    expect(names).toContain('worker_task_total'); // Worker 任务
    expect(names).toContain('worker_task_retry_total'); // Worker 重试
    expect(names).toContain('artifact_generation_failed_total'); // Artifact 生成失败
    expect(names).toContain('telemetry_exporter_health'); // Exporter 健康
  });
});
