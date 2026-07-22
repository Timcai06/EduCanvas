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
import { MutableTelemetryHealth, type TelemetryHealthSnapshot } from './health';
import { ResilientSpanExporter } from './resilient-exporter';
import { OpenTelemetryTurnTracePort } from './turn-trace-adapter';

const NOOP_TRACE: TurnApplicationTracePort = {
  start() {
    return { event() {}, end() {} };
  },
};

export interface TelemetryRuntime {
  readonly turnTrace: TurnApplicationTracePort;
  health(): TelemetryHealthSnapshot;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

const inactiveRuntime = (
  health: TelemetryHealthSnapshot,
): TelemetryRuntime => ({
  turnTrace: NOOP_TRACE,
  health: () => health,
  async forceFlush() {},
  async shutdown() {},
});

/** @internal 使用注入Exporter构造可测试Runtime；业务调用永远看不到Exporter异常。 */
export function createTelemetryRuntime(
  configuration: Extract<TelemetryConfiguration, { enabled: true }>,
  exporter: SpanExporter,
): TelemetryRuntime {
  const health = new MutableTelemetryHealth({ status: 'ready' });
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
