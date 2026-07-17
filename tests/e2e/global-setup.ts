import { spawn, type ChildProcess } from 'node:child_process';

/**
 * E2E 期间拉起真实 worker 进程(ADR-0012 的双进程形态必须被 E2E 覆盖,
 * 产物生成链路才是端到端而不是纸面)。worker 连接 E2E 隔离库并在启动时
 * 自迁移 graphile schema;退出由 globalSetup 返回的 teardown 负责。
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error('E2E_DATABASE_URL 未设置');

  const worker: ChildProcess = spawn(
    'pnpm',
    ['--filter', '@educanvas/worker', 'exec', 'tsx', 'src/index.ts'],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('worker 启动超时(30s)')),
      30_000,
    );
    worker.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('已启动')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    worker.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[e2e-worker] ${chunk.toString()}`);
    });
    worker.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`worker 提前退出,code=${code}`));
    });
  });

  return async () => {
    worker.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!worker.killed) worker.kill('SIGKILL');
  };
}
