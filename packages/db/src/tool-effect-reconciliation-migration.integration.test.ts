import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';
import { createEffectFixture } from './tool-effect-reconciliation.integration.support';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('迁移测试拒绝使用非隔离数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

function withDatabaseName(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function applyMigrationFile(
  connection: ReturnType<typeof postgres>,
  fileName: string,
): Promise<void> {
  const sqlText = await readFile(`${migrationsFolder}/${fileName}`, 'utf8');
  for (const statement of sqlText.split('--> statement-breakpoint')) {
    if (statement.trim()) await connection.unsafe(statement);
  }
}

async function withTemporaryDatabase(
  operation: (
    connection: ReturnType<typeof postgres>,
    url: string,
  ) => Promise<void>,
): Promise<void> {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL未设置');
  const databaseName = `educanvas_reconciliation_${randomUUID().replaceAll('-', '')}_test`;
  const admin = postgres(withDatabaseName(testDatabaseUrl, 'postgres'), {
    max: 1,
  });
  await admin.unsafe(`create database "${databaseName}"`);
  const url = withDatabaseName(testDatabaseUrl, databaseName);
  const connection = postgres(url, { max: 1 });
  try {
    await operation(connection, url);
  } finally {
    await connection.end({ timeout: 5 });
    await admin.unsafe(
      `drop database if exists "${databaseName}" with (force)`,
    );
    await admin.end({ timeout: 5 });
  }
}

describeWithDatabase('Tool Effect决议additive migration', () => {
  it('从0032升级保留旧Effect终态且不生成虚假决议', async () => {
    await withTemporaryDatabase(async (connection) => {
      const priorMigrations = (await readdir(migrationsFolder))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0033_')
        .sort();
      for (const migration of priorMigrations) {
        await applyMigrationFile(connection, migration);
      }

      const fixture = await createEffectFixture(
        drizzle(connection, { schema }),
        { legacyToolEffectSchema: true },
      );
      const before = await connection`
        select id, status, code from tool_effects where id = ${fixture.effectId}
      `;

      await applyMigrationFile(connection, '0033_crazy_misty_knight.sql');

      expect(
        await connection`
          select id, status, code from tool_effects where id = ${fixture.effectId}
        `,
      ).toEqual(before);
      expect(before).toEqual([
        {
          id: fixture.effectId,
          status: 'outcome_unknown',
          code: 'write_outcome_unknown',
        },
      ]);
      expect(
        await connection`select * from tool_effect_reconciliations`,
      ).toEqual([]);
      expect(
        await connection`
          select reconciliation_verifier_id
          from tool_effects where id = ${fixture.effectId}
        `,
      ).toEqual([{ reconciliation_verifier_id: null }]);
    });
  });
});
