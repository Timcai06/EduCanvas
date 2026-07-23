import {
  createTelemetryRuntimeFromEnvironment,
  type TelemetryEnvironment,
  type TelemetryRuntime,
} from '@educanvas/telemetry';

let runtime: TelemetryRuntime | undefined;

const readTelemetryEnvironment = (): TelemetryEnvironment => ({
  EDUCANVAS_DEPLOYMENT_ENV: process.env.EDUCANVAS_DEPLOYMENT_ENV,
  EDUCANVAS_OTEL_ENABLED: process.env.EDUCANVAS_OTEL_ENABLED,
  EDUCANVAS_OTEL_EXPORTER_OTLP_ENDPOINT:
    process.env.EDUCANVAS_OTEL_EXPORTER_OTLP_ENDPOINT,
  EDUCANVAS_OTEL_EXPORTER_HEADERS_JSON:
    process.env.EDUCANVAS_OTEL_EXPORTER_HEADERS_JSON,
  EDUCANVAS_OTEL_SAMPLE_RATIO: process.env.EDUCANVAS_OTEL_SAMPLE_RATIO,
  EDUCANVAS_OTEL_EXPORT_TIMEOUT_MS:
    process.env.EDUCANVAS_OTEL_EXPORT_TIMEOUT_MS,
});

/** Gateway进程唯一遥测Runtime；首次调用发生在工作区env加载之后。 */
export function getGatewayTelemetryRuntime(): TelemetryRuntime {
  runtime ??= createTelemetryRuntimeFromEnvironment(
    'educanvas-gateway',
    readTelemetryEnvironment(),
  );
  return runtime;
}
