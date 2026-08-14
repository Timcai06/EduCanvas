import { JsonlSink, Logger } from '@educanvas/logging';

/**
 * Worker 进程统一 Logger — JSONL 写 stdout，orchestrator 负责按行解析分流。
 *
 * runId 由 orchestrator 通过 `EDUCANVAS_RUN_ID` 注入；默认级别可用
 * `EDUCANVAS_LOG_LEVEL` 覆盖（生产默认 info，调试时降到 debug）。
 */
export function createWorkerLogger(
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
    service: 'worker',
    runId: environment.EDUCANVAS_RUN_ID,
    sink: (record) => sink.write(record),
    minLevel,
  });
}
