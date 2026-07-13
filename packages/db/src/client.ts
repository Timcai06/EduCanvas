import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let cached: ReturnType<typeof createDb> | undefined;

// 环境变量在首次业务访问时读取，避免 Next.js 构建和只做类型检查的进程被迫连接数据库。
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL 未设置，请复制 .env.example 为 .env 并填写');
  }
  return drizzle(postgres(url), { schema });
}

/**
 * 在单个服务进程内复用连接池，避免每次请求创建新连接；惰性初始化也让构建阶段无需可用数据库。
 * 该单例不跨进程共享，高并发下的连接上限仍由部署与 PostgreSQL 配置负责，见 docs/05-engineering/backend.md。
 */
export function getDb() {
  cached ??= createDb();
  return cached;
}
