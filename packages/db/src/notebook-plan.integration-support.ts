import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe } from 'vitest';
import * as schema from './schema';
const suppliedUrl = process.env.TEST_DATABASE_URL;
if (suppliedUrl && !/_(integration|test)$/.test(new URL(suppliedUrl).pathname))
  throw new Error('Plan tests require an explicitly isolated database URL');
export const run = suppliedUrl ? describe : describe.skip;
export const migrationsFolder = fileURLToPath(
  new URL('../drizzle', import.meta.url),
);
function databaseUrl(name: string) {
  const url = new URL(suppliedUrl!);
  url.pathname = `/${name}`;
  return url.toString();
}
export async function createTemporaryDatabase(name: string) {
  const admin = postgres(databaseUrl('postgres'), { max: 1 });
  try {
    await admin.unsafe(`create database "${name}"`);
  } catch (error) {
    await admin.end();
    throw error;
  }
  const connection = postgres(databaseUrl(name), { max: 4 });
  return {
    connection,
    database: drizzle(connection, { schema }),
    async dispose() {
      await connection.end({ timeout: 5 });
      await admin.unsafe(`drop database "${name}"`);
      await admin.end({ timeout: 5 });
    },
  };
}
export async function priorBundle(lastIndex = 61) {
  const folder = await mkdtemp(join(tmpdir(), 'educanvas-plan-n1-'));
  const journal = JSON.parse(
    await readFile(`${migrationsFolder}/meta/_journal.json`, 'utf8'),
  );
  const entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx <= lastIndex,
  );
  await mkdir(`${folder}/meta`);
  await writeFile(
    `${folder}/meta/_journal.json`,
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries)
    await copyFile(
      `${migrationsFolder}/${entry.tag}.sql`,
      `${folder}/${entry.tag}.sql`,
    );
  return folder;
}

export async function notebook(
  fixture: Awaited<ReturnType<typeof createTemporaryDatabase>>,
  owner = `plan:${randomUUID()}`,
) {
  const notebookId = randomUUID();
  const conversationId = randomUUID();
  await fixture.database
    .insert(schema.platformUsers)
    .values({ id: owner, kind: 'registered' })
    .onConflictDoNothing();
  await fixture.database.insert(schema.spaces).values({
    id: notebookId,
    ownerSubjectId: owner,
    kind: 'notebook',
    title: 'Plans',
  });
  await fixture.database.insert(schema.notebookMemberships).values({
    notebookId,
    userId: owner,
    role: 'owner',
    grantedByUserId: owner,
  });
  await fixture.database.insert(schema.conversations).values({
    id: conversationId,
    spaceId: notebookId,
    ownerSubjectId: owner,
    title: 'Conversation',
  });
  return { notebookId, owner, conversationId };
}
export async function asset(
  fixture: Awaited<ReturnType<typeof createTemporaryDatabase>>,
  notebookId: string,
  owner: string,
) {
  const assetId = randomUUID();
  const assetVersionId = randomUUID();
  await fixture.database.insert(schema.assets).values({
    id: assetId,
    spaceId: notebookId,
    ownerSubjectId: owner,
    scope: 'space',
    kind: 'document',
    origin: 'upload',
    displayName: 'User textbook',
  });
  await fixture.database.insert(schema.assetVersions).values({
    id: assetVersionId,
    assetId,
    kind: 'original',
    mimeType: 'text/plain',
    byteSize: 10,
    contentHash: 'a'.repeat(64),
    status: 'ready',
    storageKey: `plan-test/${assetId}`,
    extractedText: 'Chapter one content',
  });
  await fixture.database
    .update(schema.assets)
    .set({ status: 'ready', currentVersionId: assetVersionId })
    .where(eq(schema.assets.id, assetId));
  return { assetId, assetVersionId };
}
