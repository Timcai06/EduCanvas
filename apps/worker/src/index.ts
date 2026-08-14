import { run } from 'graphile-worker';
import { prepareWorkerBootstrap } from './bootstrap.js';
import { createGraphileLogger } from './graphile-logger.js';
import { createWorkerLogger } from './logging.js';
import { installWorkerShutdownHandlers } from './process-lifecycle.js';
import { workerCrontab } from './worker-config.js';

/**
 * EduCanvas worker 进程入口(ADR-0005)。
 * 与 Web 同库不同进程:任务即 PostgreSQL 行,graphile-worker 启动时自迁移
 * 自己的 `graphile_worker` schema,不经过 Drizzle 迁移链——两者互不感知,
 * 业务表结构仍以 packages/db 为唯一入口。
 *
 * readiness：`worker.ready` 事件是 orchestrator 判定 Worker 就绪的唯一
 * 结构化信号（taskCount/concurrency/pollIntervalMs），不匹配任何文本。
 */
const logger = createWorkerLogger();

async function main() {
  const { connectionString, taskList, telemetry } =
    await prepareWorkerBootstrap();
  try {
    const runner = await run({
      connectionString,
      /* 单机起步的保守并发;真实拥塞出现前不做配额设计(ADR-0005 拆分门槛) */
      concurrency: 2,
      crontab: workerCrontab,
      noHandleSignals: true,
      pollInterval: 2_000,
      taskList,
      logger: createGraphileLogger(logger),
    });
    const removeShutdownHandlers = installWorkerShutdownHandlers({
      runner,
      onSignal(signal) {
        logger.info('service.stopping', `收到${signal}，正在优雅停止`);
      },
      onError(error) {
        logger.errorWithError('service.failed', '优雅停止失败', error);
        process.exitCode = 1;
      },
    });
    logger.info('worker.ready', '后台任务 Worker 已就绪', {
      taskCount: Object.keys(taskList).length,
      concurrency: 2,
      pollIntervalMs: 2_000,
    });
    try {
      await runner.promise;
    } finally {
      removeShutdownHandlers();
    }
    logger.info('service.stopped', 'Worker 已停止');
  } finally {
    await telemetry.forceFlush();
    await telemetry.shutdown();
  }
}

main().catch((error: unknown) => {
  logger.fatal('service.failed', 'Worker 致命错误退出', { error });
  process.exitCode = 1;
});
