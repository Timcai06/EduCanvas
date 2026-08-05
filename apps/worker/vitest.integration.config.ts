import { defineConfig } from 'vitest/config';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL 未设置；PostgreSQL 集成测试必须显式使用隔离测试数据库',
  );
}

const databaseName = decodeURIComponent(
  new URL(process.env.TEST_DATABASE_URL).pathname.slice(1),
);
if (!databaseName.endsWith('_integration') && !databaseName.endsWith('_test')) {
  throw new Error(
    '集成测试数据库名必须以_integration或_test结尾，拒绝连接非测试数据库',
  );
}

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
