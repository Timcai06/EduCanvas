import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';

function resolveTestDatabaseUrl(): string | undefined {
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

type MigrationJournal = {
  version: string;
  dialect: string;
  entries: {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }[];
};

function withDatabaseName(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function withMigrationBundleThrough(
  lastIndex: number,
  operation: (folder: string) => Promise<void>,
): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), `educanvas-audio-${lastIndex}-`));
  const journal = JSON.parse(
    await readFile(`${migrationsFolder}/meta/_journal.json`, 'utf8'),
  ) as MigrationJournal;
  const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
  try {
    await mkdir(`${folder}/meta`);
    await writeFile(
      `${folder}/meta/_journal.json`,
      JSON.stringify({ ...journal, entries }),
    );
    for (const entry of entries) {
      await copyFile(
        `${migrationsFolder}/${entry.tag}.sql`,
        `${folder}/${entry.tag}.sql`,
      );
    }
    await operation(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function withTemporaryDatabase(
  operation: (connection: ReturnType<typeof postgres>) => Promise<void>,
): Promise<void> {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL未设置');
  const databaseName = `educanvas_audio_${randomUUID().replaceAll('-', '')}_test`;
  const admin = postgres(withDatabaseName(testDatabaseUrl, 'postgres'), {
    max: 1,
  });
  await admin.unsafe(`create database "${databaseName}"`);
  const connection = postgres(withDatabaseName(testDatabaseUrl, databaseName), {
    max: 1,
  });
  try {
    await operation(connection);
  } finally {
    await connection.end({ timeout: 5 });
    await admin.unsafe(
      `drop database if exists "${databaseName}" with (force)`,
    );
    await admin.end({ timeout: 5 });
  }
}

describeWithDatabase('Audio transcription 0043 additive migration', () => {
  it('从0042升级保留旧Asset并开放受约束的转录任务与表示', async () => {
    await withTemporaryDatabase(async (connection) => {
      await withMigrationBundleThrough(42, async (priorFolder) => {
        await withMigrationBundleThrough(43, async (targetFolder) => {
          const database = drizzle(connection, { schema });
          await migrate(database, { migrationsFolder: priorFolder });

          const userId = 'user:audio-migration';
          const spaceId = randomUUID();
          const assetId = randomUUID();
          const versionId = randomUUID();
          await connection`
            insert into platform_users (id, kind)
            values (${userId}, 'registered')
          `;
          await connection`
            insert into spaces (id, owner_subject_id, kind, title)
            values (${spaceId}, ${userId}, 'notebook', 'Audio migration')
          `;
          await connection`
            insert into assets (
              id, owner_subject_id, space_id, scope, kind, origin,
              display_name, mime_type, status
            ) values (
              ${assetId}, ${userId}, ${spaceId}, 'space', 'audio', 'upload',
              'lesson.wav', 'audio/wav', 'processing'
            )
          `;
          await connection`
            insert into asset_versions (
              id, asset_id, kind, mime_type, byte_size, content_hash,
              status, storage_key
            ) values (
              ${versionId}, ${assetId}, 'audio', 'audio/wav', 128,
              ${'a'.repeat(64)}, 'processing', 'assets/fixture/lesson.wav'
            )
          `;

          await migrate(database, { migrationsFolder: targetFolder });

          expect(
            await connection`
              select transcription_text, transcription_metadata
              from asset_versions where id = ${versionId}
            `,
          ).toEqual([
            { transcription_text: null, transcription_metadata: null },
          ]);
          await connection`
            insert into asset_processing_jobs (
              asset_version_id, kind, status, attempts
            ) values (${versionId}, 'transcribe_audio', 'queued', 0)
          `;
          await connection`
            insert into asset_representations (
              asset_version_id, kind, mime_type, status
            ) values (${versionId}, 'transcription', 'text/plain', 'processing')
          `;
          expect(
            await connection`
              select kind from asset_processing_jobs
              where asset_version_id = ${versionId}
            `,
          ).toEqual([{ kind: 'transcribe_audio' }]);
        });
      });
    });
  });
});
