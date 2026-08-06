import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL 未设置；RAG 评测必须显式使用隔离测试数据库（_test/_eval 后缀）',
  );
}

/**
 * 评测 harness 从仓库根目录运行（tooling/ 不是 pnpm workspace 包，无
 * @educanvas/* 链接），因此把评测用到的 workspace 包直接 alias 到源码。
 * 与 packages/db 集成测试相同的解析语义（vite 加载 TS 源码）。
 * drizzle-orm/postgres/vitest 同理 alias 到 packages/db 的 node_modules
 * （pnpm 布局下 tooling/ 的 Node 解析链走不到这些包）。
 */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const aliasEntry = (pkg: string) =>
  path.join(repoRoot, 'packages', pkg, 'src', 'index.ts');
const dbNodeModules = path.join(repoRoot, 'packages', 'db', 'node_modules');

export default defineConfig({
  resolve: {
    alias: {
      '@educanvas/agent-core': aliasEntry('agent-core'),
      '@educanvas/canvas-protocol': aliasEntry('canvas-protocol'),
      '@educanvas/db': aliasEntry('db'),
      '@educanvas/gateway-core': aliasEntry('gateway-core'),
      '@educanvas/teaching-core': aliasEntry('teaching-core'),
      '@educanvas/teaching-runtime': aliasEntry('teaching-runtime'),
      'drizzle-orm': path.join(dbNodeModules, 'drizzle-orm'),
      postgres: path.join(dbNodeModules, 'postgres'),
      vitest: path.join(dbNodeModules, 'vitest'),
    },
  },
  test: {
    include: ['rag-eval.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
