import { run } from 'graphile-worker';
import { prepareWorkerBootstrap } from './bootstrap.js';
import { installWorkerShutdownHandlers } from './process-lifecycle.js';
import { workerCrontab } from './worker-config.js';

/**
 * EduCanvas worker 进程入口(ADR-0012)。
 * 与 Web 同库不同进程:任务即 PostgreSQL 行,graphile-worker 启动时自迁移
 * 自己的 `graphile_worker` schema,不经过 Drizzle 迁移链——两者互不感知,
 * 业务表结构仍以 packages/db 为唯一入口。
 */
async function main() {
  const { connectionString, taskList, telemetry } =
    await prepareWorkerBootstrap();
  try {
    const runner = await run({
      connectionString,
      /* 单机起步的保守并发;真实拥塞出现前不做配额设计(ADR-0012 开放问题) */
      concurrency: 2,
      crontab: workerCrontab,
      noHandleSignals: true,
      pollInterval: 2_000,
      taskList,
    });
    const removeShutdownHandlers = installWorkerShutdownHandlers({
      runner,
      onSignal(signal) {
        console.log(`[worker] 收到${signal},正在优雅停止`);
      },
      onError(error) {
        console.error('[worker] 优雅停止失败', error);
        process.exitCode = 1;
      },
    });
    console.log(
      `[worker] 已启动,注册任务: ${Object.keys(taskList).join(', ')}`,
    );
    try {
      await runner.promise;
    } finally {
      removeShutdownHandlers();
    }
  } finally {
    await telemetry.forceFlush();
    await telemetry.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error('[worker] 致命错误退出', error);
  process.exitCode = 1;
});
