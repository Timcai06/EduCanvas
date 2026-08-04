import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema';
import { DrizzleWebSessionRepository } from './web-session-repository';
import { createHash } from 'node:crypto';

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 生成符合 DB 约束 `^[a-f0-9]{64}$` 的 tokenHash。 */
function testTokenHash(prefix: string): string {
  return sha256(`${prefix}-${randomUUID()}`);
}

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error(
      '集成测试数据库名必须以_integration或_test结尾，拒绝连接非测试数据库',
    );
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl ? postgres(testDatabaseUrl) : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

const registeredUserId = '99990000-0000-4000-8000-000000000001';

async function ensureRegisteredUser() {
  const db = getDatabase();
  await db
    .insert(schema.platformUsers)
    .values({
      id: registeredUserId,
      kind: 'registered',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

describeWithDatabase('DrizzleWebSessionRepository integration', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  const repo = new DrizzleWebSessionRepository(getDatabase());

  it('create 写入 tokenHash 后可被 findActive 查到', async () => {
    await ensureRegisteredUser();
    const tokenHash = testTokenHash('active');
    const expiresAt = new Date(Date.now() + 60_000);

    await repo.create({ userId: registeredUserId, tokenHash, expiresAt });
    const userId = await repo.findActiveRegisteredUserIdByTokenHash({
      tokenHash,
    });

    expect(userId).toBe(registeredUserId);
  });

  it('已过期的 session 以 now 参数查询时返回 null', async () => {
    await ensureRegisteredUser();
    const tokenHash = testTokenHash('expired');
    // 满足 lifecycle 约束：expiresAt > createdAt（现在 + 60s 后过期）
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 60_000);

    await repo.create({
      userId: registeredUserId,
      tokenHash,
      expiresAt,
      now: createdAt,
    });
    // 用 expiresAt 之后的时刻查询，模拟"已过期"
    const futureNow = new Date(expiresAt.getTime() + 60_000);
    const userId = await repo.findActiveRegisteredUserIdByTokenHash({
      tokenHash,
      now: futureNow,
    });

    expect(userId).toBeNull();
  });

  it('不存在的 tokenHash 返回 null', async () => {
    const userId = await repo.findActiveRegisteredUserIdByTokenHash({
      tokenHash: testTokenHash('ghost'),
    });

    expect(userId).toBeNull();
  });

  it('revokeByTokenHash 后 findActive 返回 null', async () => {
    await ensureRegisteredUser();
    const tokenHash = testTokenHash('revoke');
    const expiresAt = new Date(Date.now() + 60_000);

    await repo.create({ userId: registeredUserId, tokenHash, expiresAt });
    await repo.revokeByTokenHash({ tokenHash });

    const userId = await repo.findActiveRegisteredUserIdByTokenHash({
      tokenHash,
    });
    expect(userId).toBeNull();
  });

  it('revokeByTokenHash 对已撤销 session 幂等', async () => {
    await ensureRegisteredUser();
    const tokenHash = testTokenHash('idempotent');
    const expiresAt = new Date(Date.now() + 60_000);

    await repo.create({ userId: registeredUserId, tokenHash, expiresAt });
    await repo.revokeByTokenHash({ tokenHash });
    // 第二次撤销不应抛出异常 — WHERE revokedAt IS NULL 保证
    await repo.revokeByTokenHash({ tokenHash });

    const userId = await repo.findActiveRegisteredUserIdByTokenHash({
      tokenHash,
    });
    expect(userId).toBeNull();
  });

  it('revokeByTokenHash 对不存在的 tokenHash 静默成功', async () => {
    await repo.revokeByTokenHash({ tokenHash: testTokenHash('ghost-revoke') });
  });

  it('不同 userId 的 session 互不影响', async () => {
    const otherUserId = '99990000-0000-4000-8000-000000000002';
    const db = getDatabase();
    await db
      .insert(schema.platformUsers)
      .values({
        id: otherUserId,
        kind: 'registered',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    const tokenA = testTokenHash('user-a');
    const tokenB = testTokenHash('user-b');
    const expiresAt = new Date(Date.now() + 60_000);

    await repo.create({
      userId: registeredUserId,
      tokenHash: tokenA,
      expiresAt,
    });
    await repo.create({ userId: otherUserId, tokenHash: tokenB, expiresAt });
    await repo.revokeByTokenHash({ tokenHash: tokenA });

    // A 的 session 已撤销
    expect(
      await repo.findActiveRegisteredUserIdByTokenHash({ tokenHash: tokenA }),
    ).toBeNull();
    // B 的 session 仍有效
    expect(
      await repo.findActiveRegisteredUserIdByTokenHash({ tokenHash: tokenB }),
    ).toBe(otherUserId);
  });
});
