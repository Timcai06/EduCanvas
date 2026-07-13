import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // 回退地址仅供本地 Drizzle CLI 零配置使用；运行时客户端仍强制要求显式 DATABASE_URL。
    url: process.env.DATABASE_URL ?? 'postgresql://educanvas:educanvas@localhost:5432/educanvas',
  },
});
