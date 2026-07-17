import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { run } from 'graphile-worker';
import { taskList } from './tasks/index.js';
import { workerCrontab } from './worker-config.js';

/**
 * worker 不依赖启动入口注入环境:Next 会自己读 .env/.env.local,worker 也必须能。
 * 只填缺失键、不覆盖 shell 已有值——显式环境(make dev、CI、E2E 编排)永远优先。
 */
function loadWorkspaceEnvFiles(): void {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) break;
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
  for (const name of ['.env', '.env.local']) {
    const file = path.join(current, name);
    if (!existsSync(file)) continue;
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] ??= value;
    }
  }
}

loadWorkspaceEnvFiles();

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
    crontab: workerCrontab,
    noHandleSignals: false,
    pollInterval: 2_000,
    taskList,
  });
  console.log(`[worker] 已启动,注册任务: ${Object.keys(taskList).join(', ')}`);
  await runner.promise;
}

main().catch((error: unknown) => {
  console.error('[worker] 致命错误退出', error);
  process.exit(1);
});
