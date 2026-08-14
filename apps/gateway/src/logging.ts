import { JsonlSink, Logger } from '@educanvas/logging';

/**
 * Gateway 进程统一 Logger — JSONL 写 stdout，orchestrator 按行解析分流。
 *
 * runId 由 orchestrator 通过 `EDUCANVAS_RUN_ID` 注入；`EDUCANVAS_LOG_LEVEL`
 * 可覆盖默认级别。GatewayObservability 的低基数安全边界不在此处放宽。
 */
export function createGatewayLogger(
  environment: NodeJS.ProcessEnv = process.env,
): Logger {
  const sink = new JsonlSink({
    write: (line) => process.stdout.write(line),
  });
  const minLevel =
    environment.EDUCANVAS_LOG_LEVEL === 'debug' ||
    environment.EDUCANVAS_LOG_LEVEL === 'warn' ||
    environment.EDUCANVAS_LOG_LEVEL === 'error'
      ? environment.EDUCANVAS_LOG_LEVEL
      : 'info';
  return new Logger({
    service: 'gateway',
    runId: environment.EDUCANVAS_RUN_ID,
    sink: (record) => sink.write(record),
    minLevel,
  });
}
