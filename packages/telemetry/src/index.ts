/** EduCanvas脱敏遥测Adapter公共入口；不导出OpenTelemetry实现类型。 @packageDocumentation */

export {
  parseTelemetryConfiguration,
  TelemetryConfigurationError,
  telemetryConfigurationErrorCodes,
  type TelemetryConfiguration,
  type TelemetryConfigurationErrorCode,
  type TelemetryEnvironment,
} from './config';
export type { TelemetryHealthSnapshot } from './health';
export type {
  ContinuationTraceInput,
  ContinuationTracePort,
} from './continuation-trace-adapter';
export {
  createTelemetryRuntimeFromEnvironment,
  type TelemetryRuntime,
} from './runtime';
export {
  MetricsRegistry,
  MetricsValidationError,
  NOOP_METRICS,
  recordMetricSafely,
  TURN_METRIC_DEFINITIONS,
  type HistogramPoint,
  type MetricDefinition,
  type MetricsPort,
  type MetricsSnapshot,
} from './metrics';
export {
  wrapTurnApplicationStream,
  type TurnMetricsOptions,
} from './turn-metrics';
export {
  wrapTurnModelGatewayForMetrics,
  type ModelMetricsOptions,
} from './model-metrics';
