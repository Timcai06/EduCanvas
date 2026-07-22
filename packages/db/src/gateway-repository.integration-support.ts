import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { describe } from 'vitest';
import * as schema from './schema';

/**
 * Gateway 仓储集成测试的共享夹具：隔离数据库连接、迁移、清库与固定时间。
 * 拆分后的多个 gateway-*.integration.test.ts 均复用此处，以保证清库表集与建连方式完全一致。
 * 集成配置强制串行（fileParallelism:false, maxWorkers:1），因此各文件在同一隔离库上清库互不干扰。
 */

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('集成测试拒绝使用非隔离数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
export const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 4 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

export function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

export const now = new Date('2026-07-19T04:00:00.000Z');

export async function migrateGatewaySchema(): Promise<void> {
  await migrate(getDatabase(), {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
}

export async function truncateGatewayTables(): Promise<void> {
  await getDatabase().execute(sql`
      truncate table
        gateway_handoff_tokens,
        operation_continuations,
        tool_approval_intents,
        gateway_approvals,
        gateway_operation_events,
        gateway_deliveries,
        gateway_node_invocations,
        gateway_node_pairings,
        gateway_channel_thread_bindings,
        gateway_channel_account_bindings,
        agent_operations,
        conversation_messages,
        conversations,
        notebook_memberships,
        spaces,
        personal_agents,
        platform_users
      restart identity cascade
    `);
}

export async function closeGatewayConnection(): Promise<void> {
  await connection?.end({ timeout: 5 });
}
