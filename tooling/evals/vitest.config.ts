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
const agentRuntimeNodeModules = path.join(
  repoRoot,
  'packages',
  'agent-runtime',
  'node_modules',
);

export default defineConfig({
  resolve: {
    // 数组 + 正则形式：`$` 锚定字符串键在 rolldown/vite 8 下未生效（实测
    // Cannot find package），正则精确匹配保证 '@educanvas/db' 不吞
    // '@educanvas/db/internal' 子路径。
    alias: [
      {
        find: /^@educanvas\/agent-core$/,
        replacement: aliasEntry('agent-core'),
      },
      {
        find: /^@educanvas\/agent-runtime$/,
        replacement: aliasEntry('agent-runtime'),
      },
      {
        find: /^@educanvas\/canvas-protocol$/,
        replacement: aliasEntry('canvas-protocol'),
      },
      {
        find: /^@educanvas\/db$/,
        replacement: aliasEntry('db'),
      },
      {
        find: /^@educanvas\/db\/internal$/,
        replacement: path.join(
          repoRoot,
          'packages',
          'db',
          'src',
          'internal',
          'index.ts',
        ),
      },
      {
        find: /^@educanvas\/gateway-core$/,
        replacement: aliasEntry('gateway-core'),
      },
      {
        find: /^@educanvas\/teaching-core$/,
        replacement: aliasEntry('teaching-core'),
      },
      {
        find: /^@educanvas\/teaching-runtime$/,
        replacement: aliasEntry('teaching-runtime'),
      },
      // drizzle-orm 允许子路径导入（postgres-js、postgres-js/migrator），前缀匹配。
      {
        find: /^drizzle-orm/,
        replacement: path.join(dbNodeModules, 'drizzle-orm'),
      },
      { find: /^postgres$/, replacement: path.join(dbNodeModules, 'postgres') },
      { find: /^vitest$/, replacement: path.join(dbNodeModules, 'vitest') },
      { find: /^zod$/, replacement: path.join(agentRuntimeNodeModules, 'zod') },
    ],
  },
  test: {
    include: ['rag-eval.test.ts', 'agent/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
