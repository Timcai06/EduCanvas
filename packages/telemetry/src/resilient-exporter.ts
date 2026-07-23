import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { MutableTelemetryHealth } from './health';

/** @internal Exporter失败只更新安全健康状态并回调，绝不向Turn抛异常。 */
export class ResilientSpanExporter implements SpanExporter {
  constructor(
    private readonly inner: SpanExporter,
    private readonly health: MutableTelemetryHealth,
  ) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    let settled = false;
    const settle = (result: ExportResult): void => {
      if (settled) return;
      settled = true;
      if (result.code === ExportResultCode.SUCCESS) this.health.ready();
      else this.health.degraded('export_failed');
      resultCallback(result);
    };

    try {
      this.inner.export(spans, settle);
    } catch {
      settle({ code: ExportResultCode.FAILED });
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.inner.shutdown();
    } catch {
      this.health.degraded('export_failed');
    }
  }

  async forceFlush(): Promise<void> {
    try {
      await this.inner.forceFlush?.();
    } catch {
      this.health.degraded('export_failed');
    }
  }
}
