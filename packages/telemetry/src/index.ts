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
