import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  createRunId,
  createRunSession,
  latestPath,
  listRuns,
  pruneRuns,
  readLatest,
  readRunMeta,
  updateRunState,
} from './local-run-session.mjs';

const temporaryDirectories = [];

async function makeTemporaryLogsRoot() {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'educanvas-run-session-'),
  );
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

const FIXED_NOW = new Date('2026-08-14T18:23:39.102Z');

test('createRunId 生成稳定格式且可复现', () => {
  const runId = createRunId(FIXED_NOW, 'a7f2');
  // 本地时区日期 + 固定随机后缀；同输入必然同输出。
  assert.equal(runId, createRunId(FIXED_NOW, 'a7f2'));
  assert.match(runId, /^local-\d{8}-\d{6}-a7f2$/);
  assert.notEqual(
    createRunId(FIXED_NOW, '0001'),
    createRunId(FIXED_NOW, '0002'),
  );
});

test('createRunSession 创建独立 run directory 并写 run.json/latest.json', async () => {
  const logsRoot = await makeTemporaryLogsRoot();
  const session = await createRunSession({
    logsRoot,
    now: FIXED_NOW,
    orchestratorPid: 48000,
    webUrl: 'http://127.0.0.1:3101',
    gatewayUrl: 'http://127.0.0.1:3200',
    randomHex: 'a7f2',
  });
  assert.match(session.runId, /^local-\d{8}-\d{6}-a7f2$/);
  assert.equal(session.meta.state, 'starting');
  assert.equal(session.meta.orchestratorPid, 48000);

  const meta = await readRunMeta(session.directory);
  assert.equal(meta.schema, 'educanvas.local-run.v1');
  assert.equal(meta.webUrl, 'http://127.0.0.1:3101');

  const latest = await readLatest(logsRoot);
  assert.equal(latest.runId, session.runId);
  assert.equal(latest.state, 'starting');
});

test('每次运行互不混杂：两个会话目录不同且 latest 指向最新', async () => {
  const logsRoot = await makeTemporaryLogsRoot();
  const first = await createRunSession({
    logsRoot,
    now: FIXED_NOW,
    randomHex: '0001',
  });
  const second = await createRunSession({
    logsRoot,
    now: new Date('2026-08-14T18:24:00.000Z'),
    randomHex: '0002',
  });
  assert.notEqual(first.directory, second.directory);
  const latest = await readLatest(logsRoot);
  assert.equal(latest.runId, second.runId);
});

test('updateRunState 从 starting 流转到 running/stopped，并同步 latest', async () => {
  const logsRoot = await makeTemporaryLogsRoot();
  const session = await createRunSession({
    logsRoot,
    now: FIXED_NOW,
    randomHex: '0001',
  });

  await updateRunState(session.directory, { state: 'running' });
  assert.equal((await readRunMeta(session.directory)).state, 'running');
  assert.equal((await readLatest(logsRoot)).state, 'running');

  await updateRunState(session.directory, {
    state: 'stopped',
    stoppedAt: '2026-08-14T18:30:00.000Z',
    exitReason: 'SIGINT',
  });
  const meta = await readRunMeta(session.directory);
  assert.equal(meta.state, 'stopped');
  assert.equal(meta.exitReason, 'SIGINT');
  assert.equal(meta.stoppedAt, '2026-08-14T18:30:00.000Z');
});

test('pruneRuns 保留最近 N 次且不删除当前运行', async () => {
  const logsRoot = await makeTemporaryLogsRoot();
  for (let index = 0; index < 5; index += 1) {
    await createRunSession({
      logsRoot,
      now: new Date(2026, 7, 14, 11, 30, index),
      randomHex: String(index).padStart(4, '0'),
    });
  }
  const current = await createRunSession({
    logsRoot,
    now: new Date(2026, 7, 14, 11, 30, 9),
    randomHex: '0009',
  });

  const { removed, warnings } = await pruneRuns(logsRoot, {
    retention: 3,
    currentRunId: current.runId,
  });
  assert.equal(warnings.length, 0);
  assert.equal(removed, 3); // 6 个会话 - 保留 3 个
  const remaining = await listRuns(logsRoot);
  assert.equal(remaining.length, 3);
  assert.ok(remaining.includes(current.runId), '当前运行必须保留');
});

test('损坏的 latest.json 不崩溃，readLatest 返回 null', async () => {
  const logsRoot = await makeTemporaryLogsRoot();
  await writeFile(latestPath(logsRoot), '{broken json', 'utf8');
  assert.equal(await readLatest(logsRoot), null);
});

test('空目录 listRuns 返回空数组', async () => {
  const logsRoot = await makeTemporaryLogsRoot();
  assert.deepEqual(await listRuns(logsRoot), []);
});
