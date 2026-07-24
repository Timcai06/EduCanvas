import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema';
import {
  DrizzleWebAccountRepository,
  DrizzleWebSessionRepository,
} from './web-account-repository';

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

describeWithDatabase('DrizzleWebAccountRepository integration', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('persists credential material and revokes every session after a password change', async () => {
    const account = new DrizzleWebAccountRepository(getDatabase());
    const sessions = new DrizzleWebSessionRepository(getDatabase());
    const username = `integration_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const created = await account.createRegisteredAccount({
      usernameNormalized: username,
      nickname: '集成测试用户',
      passwordMaterial: {
        passwordHash: 'a'.repeat(43),
        passwordSalt: 'a'.repeat(16),
        passwordParams: { algorithm: 'scrypt' },
      },
    });
    await expect(account.findByUsername(username)).resolves.toMatchObject({
      userId: created.userId,
      passwordHash: 'a'.repeat(43),
    });

    await sessions.create({
      userId: created.userId,
      tokenHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await sessions.create({
      userId: created.userId,
      tokenHash: 'b'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await account.updatePassword({
      userId: created.userId,
      passwordMaterial: {
        passwordHash: 'b'.repeat(43),
        passwordSalt: 'b'.repeat(16),
        passwordParams: { algorithm: 'scrypt' },
      },
    });
    await sessions.revokeAllForUser({ userId: created.userId });

    await expect(account.findByUsername(username)).resolves.toMatchObject({
      userId: created.userId,
      passwordHash: 'b'.repeat(43),
      passwordSalt: 'b'.repeat(16),
      nickname: '集成测试用户',
    });
    await expect(
      sessions.findActiveRegisteredUserIdByTokenHash({
        tokenHash: 'a'.repeat(64),
      }),
    ).resolves.toBeNull();
    await expect(
      sessions.findActiveRegisteredUserIdByTokenHash({
        tokenHash: 'b'.repeat(64),
      }),
    ).resolves.toBeNull();
  });
});
