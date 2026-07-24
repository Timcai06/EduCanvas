import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema';
import {
  DrizzleWebAccountRepository,
  WebCredentialChangedError,
  WebUsernameTakenError,
} from './web-account-repository';
import { DrizzleWebSessionRepository } from './web-session-repository';

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

  it('maps a concurrent username unique-key race to the stable domain error', async () => {
    const account = new DrizzleWebAccountRepository(getDatabase());
    const username = `race_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const create = () =>
      account.createRegisteredAccount({
        usernameNormalized: username,
        nickname: '并发注册用户',
        passwordMaterial: {
          passwordHash: 'a'.repeat(43),
          passwordSalt: 'a'.repeat(16),
          passwordParams: {
            version: 1,
            algorithm: 'scrypt',
            N: 16_384,
            r: 8,
            p: 1,
            keyLength: 32,
          },
        },
      });

    const results = await Promise.allSettled([create(), create()]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(WebUsernameTakenError);
  });

  it('首个session写入失败时回滚整个公共注册', async () => {
    const account = new DrizzleWebAccountRepository(getDatabase());
    const username = `rollback_${randomUUID().replaceAll('-', '').slice(0, 20)}`;

    await expect(
      account.createRegisteredAccount({
        usernameNormalized: username,
        nickname: '事务回滚用户',
        passwordMaterial: {
          passwordHash: 'a'.repeat(43),
          passwordSalt: 'a'.repeat(16),
          passwordParams: {
            version: 1,
            algorithm: 'scrypt',
            N: 16_384,
            r: 8,
            p: 1,
            keyLength: 32,
          },
        },
        newSession: {
          tokenHash: 'invalid-token-hash',
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(account.findByUsername(username)).resolves.toBeNull();
  });

  it('atomically updates password, revokes old sessions, and creates the replacement', async () => {
    const account = new DrizzleWebAccountRepository(getDatabase());
    const sessions = new DrizzleWebSessionRepository(getDatabase());
    const username = `integration_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const oldTokenHash = randomUUID().replaceAll('-', '').repeat(2);
    const replacementTokenHash = randomUUID().replaceAll('-', '').repeat(2);
    const expiresAt = new Date(Date.now() + 60_000);
    const created = await account.createRegisteredAccount({
      usernameNormalized: username,
      nickname: '集成测试用户',
      passwordMaterial: {
        passwordHash: 'a'.repeat(43),
        passwordSalt: 'a'.repeat(16),
        passwordParams: {
          version: 1,
          algorithm: 'scrypt',
          N: 16_384,
          r: 8,
          p: 1,
          keyLength: 32,
        },
      },
    });
    await expect(account.findByUsername(username)).resolves.toMatchObject({
      userId: created.userId,
      passwordHash: 'a'.repeat(43),
    });

    await sessions.create({
      userId: created.userId,
      tokenHash: oldTokenHash,
      expiresAt,
    });

    await expect(
      account.updatePasswordAndRotateSession({
        userId: created.userId,
        expectedCredential: {
          passwordHash: 'z'.repeat(43),
          passwordSalt: 'z'.repeat(16),
        },
        passwordMaterial: {
          passwordHash: 'b'.repeat(43),
          passwordSalt: 'b'.repeat(16),
          passwordParams: {
            version: 1,
            algorithm: 'scrypt',
            N: 16_384,
            r: 8,
            p: 1,
            keyLength: 32,
          },
        },
        newSession: { tokenHash: replacementTokenHash, expiresAt },
      }),
    ).rejects.toBeInstanceOf(WebCredentialChangedError);

    await expect(
      account.updatePasswordAndRotateSession({
        userId: created.userId,
        expectedCredential: {
          passwordHash: 'a'.repeat(43),
          passwordSalt: 'a'.repeat(16),
        },
        passwordMaterial: {
          passwordHash: 'b'.repeat(43),
          passwordSalt: 'b'.repeat(16),
          passwordParams: {
            version: 1,
            algorithm: 'scrypt',
            N: 16_384,
            r: 8,
            p: 1,
            keyLength: 32,
          },
        },
        newSession: {
          tokenHash: 'invalid-token-hash',
          expiresAt,
        },
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(account.findByUsername(username)).resolves.toMatchObject({
      passwordHash: 'a'.repeat(43),
      passwordSalt: 'a'.repeat(16),
    });
    await expect(
      sessions.findActiveRegisteredUserIdByTokenHash({
        tokenHash: oldTokenHash,
      }),
    ).resolves.toBe(created.userId);

    await account.updatePasswordAndRotateSession({
      userId: created.userId,
      expectedCredential: {
        passwordHash: 'a'.repeat(43),
        passwordSalt: 'a'.repeat(16),
      },
      passwordMaterial: {
        passwordHash: 'b'.repeat(43),
        passwordSalt: 'b'.repeat(16),
        passwordParams: {
          version: 1,
          algorithm: 'scrypt',
          N: 16_384,
          r: 8,
          p: 1,
          keyLength: 32,
        },
      },
      newSession: { tokenHash: replacementTokenHash, expiresAt },
    });

    await expect(account.findByUsername(username)).resolves.toMatchObject({
      userId: created.userId,
      passwordHash: 'b'.repeat(43),
      passwordSalt: 'b'.repeat(16),
      nickname: '集成测试用户',
    });
    await expect(
      sessions.findActiveRegisteredUserIdByTokenHash({
        tokenHash: oldTokenHash,
      }),
    ).resolves.toBeNull();
    await expect(
      sessions.findActiveRegisteredUserIdByTokenHash({
        tokenHash: replacementTokenHash,
      }),
    ).resolves.toBe(created.userId);
  });

  it('allows only one concurrent password rotation for the same verified credential', async () => {
    const account = new DrizzleWebAccountRepository(getDatabase());
    const sessions = new DrizzleWebSessionRepository(getDatabase());
    const username = `rotate_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const oldTokenHash = randomUUID().replaceAll('-', '').repeat(2);
    const replacementHashes = [
      randomUUID().replaceAll('-', '').repeat(2),
      randomUUID().replaceAll('-', '').repeat(2),
    ] as const;
    const expiresAt = new Date(Date.now() + 60_000);
    const created = await account.createRegisteredAccount({
      usernameNormalized: username,
      nickname: '并发改密用户',
      passwordMaterial: {
        passwordHash: 'c'.repeat(43),
        passwordSalt: 'c'.repeat(16),
        passwordParams: {
          version: 1,
          algorithm: 'scrypt',
          N: 16_384,
          r: 8,
          p: 1,
          keyLength: 32,
        },
      },
    });
    await sessions.create({
      userId: created.userId,
      tokenHash: oldTokenHash,
      expiresAt,
    });

    const rotate = (index: 0 | 1) =>
      account.updatePasswordAndRotateSession({
        userId: created.userId,
        expectedCredential: {
          passwordHash: 'c'.repeat(43),
          passwordSalt: 'c'.repeat(16),
        },
        passwordMaterial: {
          passwordHash: (index === 0 ? 'd' : 'e').repeat(43),
          passwordSalt: (index === 0 ? 'd' : 'e').repeat(16),
          passwordParams: {
            version: 1,
            algorithm: 'scrypt',
            N: 16_384,
            r: 8,
            p: 1,
            keyLength: 32,
          },
        },
        newSession: {
          tokenHash: replacementHashes[index],
          expiresAt,
        },
      });
    const results = await Promise.allSettled([rotate(0), rotate(1)]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(WebCredentialChangedError);
    await expect(
      sessions.findActiveRegisteredUserIdByTokenHash({
        tokenHash: oldTokenHash,
      }),
    ).resolves.toBeNull();
    const activeReplacements = await Promise.all(
      replacementHashes.map((tokenHash) =>
        sessions.findActiveRegisteredUserIdByTokenHash({ tokenHash }),
      ),
    );
    expect(activeReplacements.filter(Boolean)).toEqual([created.userId]);
  });
});
