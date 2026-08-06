import type { TurnApplicationTracePort } from '@educanvas/agent-runtime';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  TraceIdRatioBasedSampler,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-node';
import {
  parseTelemetryConfiguration,
  TelemetryConfigurationError,
  type TelemetryConfiguration,
  type TelemetryEnvironment,
} from './config';
import {
  NOOP_CONTINUATION_TRACE,
  OpenTelemetryContinuationTracePort,
  type ContinuationTracePort,
} from './continuation-trace-adapter';
import { MutableTelemetryHealth, type TelemetryHealthSnapshot } from './health';
import { MetricsRegistry, NOOP_METRICS, type MetricsPort } from './metrics';
import { ResilientSpanExporter } from './resilient-exporter';
import { OpenTelemetryTurnTracePort } from './turn-trace-adapter';

const NOOP_TRACE: TurnApplicationTracePort = {
  start() {
    return { carrier: () => null, event() {}, end() {} };
  },
};

export interface TelemetryRuntime {
  readonly turnTrace: TurnApplicationTracePort;
  readonly continuationTrace: ContinuationTracePort;
  /** Q04：进程内低基数指标注册表（snapshot 供端点与测试断言）。 */
  readonly metrics: MetricsPort;
  health(): TelemetryHealthSnapshot;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

/** 健康状态机的每次变化都投影到 exporter 健康 gauge（status 为闭集）。 */
function healthGaugeMetrics(
  health: MutableTelemetryHealth,
  metrics: MetricsPort,
): void {
  const snapshot = health.snapshot();
  metrics.set('telemetry_exporter_health', 1, { status: snapshot.status });
}

const inactiveRuntime = (
  health: TelemetryHealthSnapshot,
): TelemetryRuntime => ({
  turnTrace: NOOP_TRACE,
  continuationTrace: NOOP_CONTINUATION_TRACE,
  metrics: NOOP_METRICS,
  health: () => health,
  async forceFlush() {},
  async shutdown() {},
});

/** @internal 使用注入Exporter构造可测试Runtime；业务调用永远看不到Exporter异常。 */
export function createTelemetryRuntime(
  configuration: Extract<TelemetryConfiguration, { enabled: true }>,
  exporter: SpanExporter,
): TelemetryRuntime {
  const metrics = new MetricsRegistry();
  const health = new MutableTelemetryHealth({ status: 'ready' }, (snapshot) => {
    metrics.set('telemetry_exporter_health', 1, { status: snapshot.status });
  });
  // 初始 ready 状态也要投影（onChange 只覆盖后续转移）。
  healthGaugeMetrics(health, metrics);
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': configuration.serviceName,
    }),
    sampler: new TraceIdRatioBasedSampler(configuration.sampleRatio),
    spanProcessors: [
      new BatchSpanProcessor(new ResilientSpanExporter(exporter, health), {
        maxQueueSize: 512,
        maxExportBatchSize: 64,
        scheduledDelayMillis: 1_000,
        exportTimeoutMillis: configuration.exportTimeoutMs,
      }),
    ],
  });
  provider.register();
  return {
    turnTrace: new OpenTelemetryTurnTracePort(
      provider.getTracer('educanvas-turn', '1.0.0'),
    ),
    continuationTrace: new OpenTelemetryContinuationTracePort(
      provider.getTracer('educanvas-continuation', '1.0.0'),
    ),
    metrics,
    health: () => health.snapshot(),
    async forceFlush() {
      try {
        await provider.forceFlush();
      } catch {
        health.degraded('export_failed');
      }
    },
    async shutdown() {
      try {
        await provider.shutdown();
      } catch {
        health.degraded('export_failed');
      }
    },
  };
}

/** 显式环境构造OTel Runtime；disabled/配置错/初始化失败都返回安全NOOP状态。 */
export function createTelemetryRuntimeFromEnvironment(
  serviceName: string,
  environment: TelemetryEnvironment,
): TelemetryRuntime {
  let configuration: TelemetryConfiguration;
  try {
    configuration = parseTelemetryConfiguration(serviceName, environment);
  } catch (error) {
    return inactiveRuntime({
      status: 'degraded',
      failureCode:
        error instanceof TelemetryConfigurationError
          ? 'invalid_configuration'
          : 'initialization_failed',
    });
  }
  if (!configuration.enabled) {
    return inactiveRuntime({ status: 'disabled' });
  }
  try {
    return createTelemetryRuntime(
      configuration,
      new OTLPTraceExporter({
        url: configuration.endpoint,
        headers: { ...configuration.headers },
        timeoutMillis: configuration.exportTimeoutMs,
      }),
    );
  } catch {
    return inactiveRuntime({
      status: 'degraded',
      failureCode: 'initialization_failed',
    });
  }
}
