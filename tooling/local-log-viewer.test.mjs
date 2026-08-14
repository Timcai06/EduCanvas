import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const temporaryDirectories = [];

async function makeLogsFixture({ state = 'stopped' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'educanvas-viewer-'));
  temporaryDirectories.push(root);
  const runId = 'local-20260814-112339-a7f2';
  const runDir = path.join(root, runId);
  await (await import('node:fs/promises')).mkdir(runDir, { recursive: true });
  await writeFile(
    path.join(root, 'latest.json'),
    JSON.stringify({ schema: 'educanvas.local-run.v1', runId, state }, null, 2),
    'utf8',
  );
  const rows = [
    [
      'worker',
      'info',
      'worker.ready',
      '后台任务 Worker 已就绪',
      { jobId: undefined },
    ],
    ['worker', 'warn', 'worker.job.retrying', '任务重试', { jobId: 'job-481' }],
    ['worker', 'error', 'worker.job.failed', '任务失败', { jobId: 'job-482' }],
    [
      'gateway',
      'info',
      'gateway.operation.transitioned',
      '操作迁移',
      { operationId: 'op-7a31c2' },
    ],
    [
      'gateway',
      'debug',
      'gateway.http.completed',
      '健康检查完成',
      { traceId: 'trace-1' },
    ],
  ];
  const combined = rows
    .map(([service, level, event, message, extra]) =>
      JSON.stringify({
        schema: 'educanvas.log.v1',
        ts: '2026-08-14T11:26:04.112Z',
        level,
        service,
        event,
        message,
        ...extra,
      }),
    )
    .join('\n');
  await writeFile(path.join(runDir, 'combined.jsonl'), `${combined}\n`, 'utf8');
  return root;
}

function runViewer(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['tooling/local-log-viewer.mjs', ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test('service 过滤只显示匹配服务', async () => {
  const logsRoot = await makeLogsFixture();
  const result = await runViewer(['--json', '--service=worker'], {
    EDUCANVAS_LOGS_ROOT: logsRoot,
  });
  assert.equal(result.code, 0);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 3);
  for (const line of lines) assert.equal(JSON.parse(line).service, 'worker');
});

test('level 过滤', async () => {
  const logsRoot = await makeLogsFixture();
  const result = await runViewer(['--json', '--level=error'], {
    EDUCANVAS_LOGS_ROOT: logsRoot,
  });
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).event, 'worker.job.failed');
});

test('event 过滤', async () => {
  const logsRoot = await makeLogsFixture();
  const result = await runViewer(['--json', '--event=retrying'], {
    EDUCANVAS_LOGS_ROOT: logsRoot,
  });
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).event, 'worker.job.retrying');
});

test('operationId 过滤（OP=...）', async () => {
  const logsRoot = await makeLogsFixture();
  const result = await runViewer(['--json', '--op=op-7a31c2'], {
    EDUCANVAS_LOGS_ROOT: logsRoot,
  });
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).operationId, 'op-7a31c2');
});

test('jobId 过滤（JOB=...）', async () => {
  const logsRoot = await makeLogsFixture();
  const result = await runViewer(['--json', '--job=job-481'], {
    EDUCANVAS_LOGS_ROOT: logsRoot,
  });
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).jobId, 'job-481');
});

test('JSON 模式输出无额外文本、无 ANSI', async () => {
  const logsRoot = await makeLogsFixture();
  const result = await runViewer(['--json'], { EDUCANVAS_LOGS_ROOT: logsRoot });
  for (const line of result.stdout.trim().split('\n')) {
    assert.doesNotThrow(() => JSON.parse(line));
    assert.ok(!line.includes('\x1b['));
  }
  assert.ok(!result.stderr.includes('educanvas'));
});

test('缺少 latest run 时给出明确错误', async () => {
  const empty = await mkdtemp(path.join(tmpdir(), 'educanvas-viewer-empty-'));
  temporaryDirectories.push(empty);
  const result = await runViewer([], { EDUCANVAS_LOGS_ROOT: empty });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /没有找到本地运行会话/);
});

test('指定已结束会话（--run）读取历史日志', async () => {
  const logsRoot = await makeLogsFixture({ state: 'stopped' });
  const result = await runViewer(
    ['--json', '--run=local-20260814-112339-a7f2'],
    {
      EDUCANVAS_LOGS_ROOT: logsRoot,
    },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim().split('\n').length, 5);
});

test('pretty 模式非 TTY 无颜色', async () => {
  const logsRoot = await makeLogsFixture();
  const result = await runViewer([], { EDUCANVAS_LOGS_ROOT: logsRoot });
  assert.equal(result.code, 0);
  assert.ok(!result.stdout.includes('\x1b['));
  assert.match(result.stdout, /worker\.ready/);
});

test('NO_COLOR 生效', async () => {
  const logsRoot = await makeLogsFixture();
  // 强制 TTY 外观（FORCE_COLOR=1）下，NO_COLOR 仍然优先。
  const result = await runViewer(['--service=worker'], {
    EDUCANVAS_LOGS_ROOT: logsRoot,
    FORCE_COLOR: '1',
    NO_COLOR: '1',
  });
  assert.ok(!result.stdout.includes('\x1b['));
});

test('follow 模式可被 Ctrl-C 干净终止', async () => {
  const logsRoot = await makeLogsFixture({ state: 'running' });
  const child = spawn(process.execPath, ['tooling/local-log-viewer.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, EDUCANVAS_LOGS_ROOT: logsRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  const exited = new Promise((resolve) => child.once('exit', resolve));
  // 等首屏输出后发 SIGINT。
  const deadline = Date.now() + 5_000;
  while (
    stdout.split('\n').filter(Boolean).length < 5 &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGINT');
  const code = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 5_000)),
  ]);
  assert.equal(code, 0);
});
