/**
 * @educanvas/logging — 统一事件日志协议（`educanvas.log.v1`）。
 *
 * 职责：事件日志、JSONL sink、pretty rendering、安全错误序列化与脱敏。
 * 与 @educanvas/telemetry（OpenTelemetry traces/metrics）职责分离：
 * logging 不承担 trace 生命周期，telemetry 不承担终端渲染与文件轮转。
 * 业务事实仍然只以数据库（operation store）为准，日志不替代事实源。
 */

export * from './types.js';
export {
  Logger,
  type LogSink,
  type LoggerOptions,
  type LogFields,
} from './logger.js';
export {
  serializeSafeError,
  safeJsonValue,
  stringifyRecord,
  type SafeErrorOptions,
} from './safe-error.js';
export { redact, redactString, type RedactOptions } from './redaction.js';
export {
  JsonlSink,
  createStreamJsonlSink,
  type JsonlSinkOptions,
} from './json-sink.js';
export {
  renderRecord,
  renderSummaryLine,
  displayWidth,
  padDisplay,
  truncateDisplay,
  type RenderOptions,
} from './pretty-renderer.js';
export {
  runWithLogContext,
  getLogContext,
  mergeLogContext,
  type LogContext,
} from './context.js';
export { MemorySink, StringSink, sinkOf } from './testing.js';
