import { run } from 'graphile-worker';
import { taskList } from './tasks/index.js';

/**
 * EduCanvas worker 进程入口(ADR-0012)。
 * 与 Web 同库不同进程:任务即 PostgreSQL 行,graphile-worker 启动时自迁移
 * 自己的 `graphile_worker` schema,不经过 Drizzle 迁移链——两者互不感知,
 * 业务表结构仍以 packages/db 为唯一入口。
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL 未设置；worker 必须显式连接数据库');
}

async function main() {
  const runner = await run({
    connectionString,
    /* 单机起步的保守并发;真实拥塞出现前不做配额设计(ADR-0012 开放问题) */
    concurrency: 2,
    noHandleSignals: false,
    pollInterval: 2_000,
    taskList,
  });
  console.log(
    `[worker] 已启动,注册任务: ${Object.keys(taskList).join(', ')}`,
  );
  await runner.promise;
}

main().catch((error: unknown) => {
  console.error('[worker] 致命错误退出', error);
  process.exit(1);
});
