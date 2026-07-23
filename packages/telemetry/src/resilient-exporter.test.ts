import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, vi } from 'vitest';
import { MutableTelemetryHealth } from './health';
import { ResilientSpanExporter } from './resilient-exporter';
import { createTelemetryRuntimeFromEnvironment } from './runtime';

describe('ResilientSpanExporter', () => {
  it('Exporter失败只更新degraded并完成回调', () => {
    const health = new MutableTelemetryHealth({ status: 'ready' });
    const inner: SpanExporter = {
      export(_spans, callback) {
        callback({ code: ExportResultCode.FAILED, error: new Error('secret') });
      },
      async shutdown() {},
    };
    const callback = vi.fn();

    new ResilientSpanExporter(inner, health).export(
      [] as ReadableSpan[],
      callback,
    );

    expect(health.snapshot()).toEqual({
      status: 'degraded',
      failureCode: 'export_failed',
    });
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: ExportResultCode.FAILED }),
    );
  });

  it('同步抛错也被收敛且不传播原异常', () => {
    const health = new MutableTelemetryHealth({ status: 'ready' });
    const inner: SpanExporter = {
      export() {
        throw new Error('exporter-secret-never-forward');
      },
      async shutdown() {},
    };
    const callback = vi.fn();

    expect(() =>
      new ResilientSpanExporter(inner, health).export([], callback),
    ).not.toThrow();
    expect(health.snapshot()).toMatchObject({ status: 'degraded' });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('底层先回调后抛错时只结算一次', () => {
    const health = new MutableTelemetryHealth({
      status: 'degraded',
      failureCode: 'export_failed',
    });
    const inner: SpanExporter = {
      export(_spans, callback) {
        callback({ code: ExportResultCode.SUCCESS });
        throw new Error('late-exporter-error');
      },
      async shutdown() {},
    };
    const callback = vi.fn();

    expect(() =>
      new ResilientSpanExporter(inner, health).export([], callback),
    ).not.toThrow();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
    expect(health.snapshot()).toEqual({ status: 'ready' });
  });
});

describe('createTelemetryRuntimeFromEnvironment', () => {
  it('关闭与非法配置都返回可检查NOOP状态', () => {
    expect(
      createTelemetryRuntimeFromEnvironment('educanvas-web', {}).health(),
    ).toEqual({ status: 'disabled' });
    expect(
      createTelemetryRuntimeFromEnvironment('educanvas-web', {
        EDUCANVAS_OTEL_ENABLED: 'true',
      }).health(),
    ).toEqual({
      status: 'degraded',
      failureCode: 'invalid_configuration',
    });
  });
});
