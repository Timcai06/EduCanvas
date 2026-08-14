import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  computeMigrationFingerprint,
  readDatabaseIdentity,
  runMigrations,
  writeMigrationState,
} from './local-db.mjs';

const temporaryDirectories = [];

async function makeTemporaryRoot() {
  const directory = await mkdtemp(path.join(tmpdir(), 'educanvas-db-'));
  temporaryDirectories.push(directory);
  return directory;
}

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const fakeRunCommand = (responses) => async (command, args) => {
  const handler =
    responses[`${command} ${args.join(' ')}`] ?? responses[command];
  if (handler) return handler(args);
  return { code: 1, stdout: '', stderr: 'unexpected command' };
};

test('computeMigrationFingerprint 基于源文件内容', async () => {
  const root = await makeTemporaryRoot();
  await writeFile(path.join(root, '0001_a.sql'), 'CREATE TABLE a;');
  await mkdir(path.join(root, 'meta'), { recursive: true });
  await writeFile(path.join(root, 'meta', '_journal.json'), '{"x":1}');
  const fingerprint = await computeMigrationFingerprint(root);
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  // 内容变化 → 指纹变化。
  await writeFile(path.join(root, '0001_a.sql'), 'CREATE TABLE b;');
  const changed = await computeMigrationFingerprint(root);
  assert.notEqual(changed, fingerprint);
});

test('readDatabaseIdentity 解析 system_identifier', async () => {
  const runCommand = fakeRunCommand({
    'docker compose exec -T db psql -U educanvas -d educanvas -tAc SELECT system_identifier FROM pg_control_system()':
      () => ({ code: 0, stdout: ' 123456789\n', stderr: '' }),
  });
  assert.equal(await readDatabaseIdentity({ runCommand }), '123456789');
});

test('readDatabaseIdentity 失败返回 null（降级为幂等迁移）', async () => {
  const runCommand = async () => ({ code: 1, stdout: '', stderr: 'no db' });
  assert.equal(await readDatabaseIdentity({ runCommand }), null);
});

test('fingerprint 与 databaseId 一致时跳过迁移', async () => {
  const root = await makeTemporaryRoot();
  await writeFile(path.join(root, '0001_a.sql'), 'CREATE TABLE a;');
  const stateFile = path.join(root, '.educanvas-migrate-state.json');
  const fingerprint = await computeMigrationFingerprint(root);
  writeMigrationState(stateFile, {
    fingerprint,
    databaseId: '123',
    updatedAt: 'now',
  });

  let migrateCalls = 0;
  const result = await runMigrations({
    projectRoot: root,
    fingerprint: () => Promise.resolve(fingerprint),
    readIdentity: () => Promise.resolve('123'),
    runCommand: async () => {
      migrateCalls += 1;
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.status, 'skipped');
  assert.equal(migrateCalls, 0);
});

test('指纹或数据库身份变化时执行迁移并更新状态', async () => {
  const root = await makeTemporaryRoot();
  const stateFile = path.join(root, '.educanvas-migrate-state.json');
  writeMigrationState(stateFile, {
    fingerprint: 'old-fingerprint',
    databaseId: '123',
    updatedAt: 'now',
  });
  let migrateCalls = 0;
  const result = await runMigrations({
    projectRoot: root,
    fingerprint: () => Promise.resolve('new-fingerprint'),
    readIdentity: () => Promise.resolve('123'),
    runCommand: async () => {
      migrateCalls += 1;
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(migrateCalls, 1);
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(state.fingerprint, 'new-fingerprint');
  assert.equal(state.databaseId, '123');
});

test('迁移失败返回 failed 状态', async () => {
  const root = await makeTemporaryRoot();
  const result = await runMigrations({
    projectRoot: root,
    fingerprint: () => Promise.resolve('f1'),
    readIdentity: () => Promise.resolve('123'),
    runCommand: async () => ({ code: 1, stdout: '', stderr: 'boom' }),
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error.message, /boom/);
});
