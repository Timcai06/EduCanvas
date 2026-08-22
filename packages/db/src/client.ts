import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

type Database = ReturnType<typeof createDb>;

/* Next.js dev 会热重载 server module；仅放在模块作用域的连接池缓存会随重载丢失，
   旧 postgres.js pool 却继续存活，数次编辑即可耗尽本地 PostgreSQL 的连接上限。
   globalThis 跨 HMR module instance 保持同一进程只有一个 pool；生产进程同样只取一次。 */
const processCache = globalThis as typeof globalThis & {
  __educanvasDatabase?: Database;
};

// 环境变量在首次业务访问时读取，避免 Next.js 构建和只做类型检查的进程被迫连接数据库。
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL 未设置，请先运行 pnpm env:init 并填写 .env');
  }
  return drizzle(postgres(url), { schema });
}

/**
 * 在单个服务进程内复用连接池，避免每次请求创建新连接；惰性初始化也让构建阶段无需可用数据库。
 * 该单例不跨进程共享，高并发下的连接上限仍由部署与 PostgreSQL 配置负责，见 docs/05-engineering/02-后端工程.md。
 */
export function getDb() {
  processCache.__educanvasDatabase ??= createDb();
  return processCache.__educanvasDatabase;
}
