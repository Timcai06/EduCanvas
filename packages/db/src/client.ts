import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let cached: ReturnType<typeof createDb> | undefined;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL 未设置，请复制 .env.example 为 .env 并填写');
  }
  return drizzle(postgres(url), { schema });
}

/** 惰性单例：避免在构建阶段建立数据库连接 */
export function getDb() {
  cached ??= createDb();
  return cached;
}
