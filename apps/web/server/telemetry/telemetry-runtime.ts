import 'server-only';

import {
  createTelemetryRuntimeFromEnvironment,
  type TelemetryEnvironment,
  type TelemetryRuntime,
} from '@educanvas/telemetry';

interface TelemetryGlobal {
  __educanvasWebTelemetryRuntime?: TelemetryRuntime;
}

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

/** Next.js热重载期间复用进程唯一Runtime，避免重复注册全局Tracer Provider。 */
export function getWebTelemetryRuntime(): TelemetryRuntime {
  const registry = globalThis as typeof globalThis & TelemetryGlobal;
  registry.__educanvasWebTelemetryRuntime ??=
    createTelemetryRuntimeFromEnvironment(
      'educanvas-web',
      readTelemetryEnvironment(),
    );
  return registry.__educanvasWebTelemetryRuntime;
}
