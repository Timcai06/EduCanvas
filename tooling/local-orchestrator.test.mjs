import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { applyResolvedLocalPorts } from './local-orchestrator-config.mjs';

const temporaryDirectories = [];

async function makeTemporaryDirectory(prefix) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
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

/**
 * 生成 fake 工具链：docker / pnpm / fake-service。
 * - fake docker：compose up/ps/pg_isready/psql 快速成功（system_identifier
 *   固定 123456，迁移指纹缓存可命中）；
 * - fake pnpm：db:migrate 成功；`--filter @educanvas/<svc> dev` 转发到
 *   fake-service（信号透传，Ctrl-C 才能验证进程树停止）；
 * - fake-service：按 FAKE_SERVICE_<NAME> 环境变量决定行为：
 *   ready（HTTP+事件）/ exit-before-ready / fatal / hang。
 */
async function makeFakeRuntimeBinaries(overrides = {}) {
  const directory = await makeTemporaryDirectory('educanvas-orchestrator-');
  const serviceScript = path.join(directory, 'fake-service.mjs');
  await writeFile(
    serviceScript,
    `import { createServer } from 'node:http';
const service = process.argv[2];
const mode = process.env['FAKE_SERVICE_' + service.toUpperCase()] ?? 'ready';
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
if (mode === 'exit-before-ready') process.exit(1);
if (mode === 'fatal') {
  emit({ schema: 'educanvas.log.v1', ts: new Date().toISOString(), level: 'fatal', service, event: 'service.failed', message: '模拟启动失败', error: { code: 'FAKE_BOOTSTRAP_FAILED', message: '模拟启动失败' } });
  setInterval(() => {}, 1000);
}
if (service === 'gateway' || service === 'web') {
  if (mode === 'hang') {
    setInterval(() => {}, 1000);
  } else {
    const port = service === 'gateway' ? Number(process.env.EDUCANVAS_GATEWAY_PORT) : Number(process.env.PORT);
    const server = createServer((req, res) => {
      if (service === 'gateway' && req.url === '/healthz') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ service: 'educanvas-gateway', protocol: 'gateway.v1' }));
        return;
      }
      res.end('ok');
    });
    server.listen(port, '127.0.0.1', () => {
      emit({ schema: 'educanvas.log.v1', ts: new Date().toISOString(), level: 'info', service, event: 'service.ready', message: 'fake ready' });
    });
  }
} else {
  if (mode === 'hang') setInterval(() => {}, 1000);
  else emit({ schema: 'educanvas.log.v1', ts: new Date().toISOString(), level: 'info', service: 'worker', event: 'worker.ready', message: 'fake worker ready', taskCount: 1, concurrency: 2, pollIntervalMs: 2000 });
  setInterval(() => {}, 1000);
}
`,
    'utf8',
  );

  const fakePnpm = path.join(directory, 'fake-pnpm.mjs');
  await writeFile(
    fakePnpm,
    `import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
const joined = process.argv.slice(2).join(' ');
if (joined === 'db:migrate') process.exit(0);
const match = joined.match(/--filter @educanvas\\/(\\w+) dev/);
if (match) {
  const service = match[1];
  const child = spawn(process.execPath, [path.join(process.env.FAKE_DIR, 'fake-service.mjs'), service], { stdio: 'inherit', env: process.env });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  process.exit(1);
}
`,
    'utf8',
  );

  const fakeDocker = path.join(directory, 'fake-docker.mjs');
  await writeFile(
    fakeDocker,
    `const joined = process.argv.slice(2).join(' ');
if (/compose up -d db/.test(joined)) process.exit(0);
if (/pg_isready/.test(joined)) process.exit(0);
if (/system_identifier/.test(joined)) { process.stdout.write('123456\\n'); process.exit(0); }
if (/compose ps -q db/.test(joined)) { process.stdout.write('fakecontainer\\n'); process.exit(0); }
if (/compose stop/.test(joined)) process.exit(0);
process.exit(1);
`,
    'utf8',
  );

  // cleanupStaleCore 需要 lsof/ps 定位监听端口的进程。测试环境沙箱禁止
  // spawn 系统 ps（EPERM），这里注入 fake 实现：端口→pid 映射来自
  // FAKE_LSOF_MAP，pid→命令行来自 FAKE_PS_MAP；pid 已死则视为端口释放。
  const fakeLsof = path.join(directory, 'fake-lsof.mjs');
  await writeFile(
    fakeLsof,
    `const match = process.argv.slice(2).join(' ').match(/-i\\s+:?(\\d+)/);
if (!match) process.exit(1);
const port = match[1];
const map = Object.fromEntries((process.env.FAKE_LSOF_MAP ?? '').split(',').filter(Boolean).map((pair) => pair.split(':')));
const pid = map[port];
if (!pid) process.exit(1);
let alive = true;
try { process.kill(Number(pid), 0); } catch { alive = false; }
if (!alive) process.exit(1);
process.stdout.write(pid + '\\n');
process.exit(0);
`,
    'utf8',
  );
  const fakePs = path.join(directory, 'fake-ps.mjs');
  await writeFile(
    fakePs,
    `const match = process.argv.slice(2).join(' ').match(/-p\\s+([\\d,]+)/);
if (!match) process.exit(1);
const pids = match[1].split(',');
const map = Object.fromEntries((process.env.FAKE_PS_MAP ?? '').split(';').filter(Boolean).map((pair) => {
  const index = pair.indexOf(':');
  return [pair.slice(0, index), pair.slice(index + 1)];
}));
for (const pid of pids) {
  if (map[pid]) process.stdout.write(pid + ' ' + map[pid] + '\\n');
}
process.exit(0);
`,
    'utf8',
  );

  const launcher = (target) =>
    process.platform === 'win32'
      ? `@echo off\r\nnode "%~dp0${target}" %*\r\n`
      : `#!/bin/sh\nexec node "$(dirname "$0")/${target}" "$@"\n`;

  const pnpmBin = path.join(
    directory,
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  );
  await writeFile(pnpmBin, launcher('fake-pnpm.mjs'), 'utf8');
  if (process.platform !== 'win32') await chmod(pnpmBin, 0o755);
  const dockerBin = path.join(
    directory,
    process.platform === 'win32' ? 'docker.cmd' : 'docker',
  );
  await writeFile(dockerBin, launcher('fake-docker.mjs'), 'utf8');
  if (process.platform !== 'win32') await chmod(dockerBin, 0o755);
  const lsofBin = path.join(directory, 'lsof');
  await writeFile(lsofBin, launcher('fake-lsof.mjs'), 'utf8');
  if (process.platform !== 'win32') await chmod(lsofBin, 0o755);
  const psBin = path.join(directory, 'ps');
  await writeFile(psBin, launcher('fake-ps.mjs'), 'utf8');
  if (process.platform !== 'win32') await chmod(psBin, 0o755);

  return { directory, serviceScript };
}

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['tooling/local-orchestrator.mjs', ...args],
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

/** 每个测试独立的日志根目录，避免串扰。 */
async function makeLogsRoot() {
  return await makeTemporaryDirectory('educanvas-logs-');
}

/** 起一个占端口的 fixture 子进程；gateway 模式按 orchestrator 健康协议响应。 */
function spawnFixture(port, mode) {
  const script = path.resolve('tooling/local-core-cleanup.fixture.mjs');
  const child = spawn(
    process.execPath,
    [script, String(port), ...(mode ? [mode] : [])],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes(`listening on ${port}`)) resolve();
    });
    child.once('exit', (code) =>
      reject(new Error(`fixture exited early with code ${code}`)),
    );
  });
  return { child, exited, ready };
}

async function waitForExit(exited, timeoutMs = 10_000) {
  const result = await Promise.race([
    exited.then(() => 'exited'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
  ]);
  assert.equal(result, 'exited');
}

test('rejects an unknown profile', async () => {
  const result = await run(['unknown']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /local-orchestrator <all/);
});

test('status reports stopped services without starting processes', async () => {
  const logsRoot = await makeLogsRoot();
  const result = await run(['status'], {
    PORT: '61991',
    EDUCANVAS_GATEWAY_PORT: '61992',
    EDUCANVAS_LOGS_ROOT: logsRoot,
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Gateway\s+stopped/);
  assert.match(result.stdout, /Web\s+stopped/);
  assert.match(result.stdout, /Runtime\s+none/);
});

test('propagates resolved default ports to spawned core services', () => {
  const env = {};
  assert.deepEqual(applyResolvedLocalPorts(env), {
    port: 3101,
    gatewayPort: 3200,
  });
  assert.equal(env.PORT, '3101');
  assert.equal(env.EDUCANVAS_GATEWAY_PORT, '3200');
});

test('preserves validated custom ports for spawned core services', () => {
  const env = { PORT: '4101', EDUCANVAS_GATEWAY_PORT: '4200' };
  assert.deepEqual(applyResolvedLocalPorts(env), {
    port: 4101,
    gatewayPort: 4200,
  });
  assert.deepEqual(env, { PORT: '4101', EDUCANVAS_GATEWAY_PORT: '4200' });
});

test('全部服务 ready 才宣布 runtime ready，run.json 与 JSONL 正确', async () => {
  const { directory } = await makeFakeRuntimeBinaries();
  const logsRoot = await makeLogsRoot();
  const gatewayPort = 61_931;
  const webPort = 61_932;
  const child = spawn(
    process.execPath,
    ['tooling/local-orchestrator.mjs', 'all'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(webPort),
        EDUCANVAS_GATEWAY_PORT: String(gatewayPort),
        PATH: `${directory}${path.delimiter}${process.env.PATH}`,
        FAKE_DIR: directory,
        EDUCANVAS_LOGS_ROOT: logsRoot,
        EDUCANVAS_READY_TIMEOUT_MS: '15000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => child.once('exit', resolve));

  const deadline = Date.now() + 20_000;
  while (
    !stdout.includes('EduCanvas · Local Runtime') &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(stdout.includes('Local Runtime'), `orchestrator 未就绪: ${stderr}`);
  assert.match(stdout, /✓  Database/);
  assert.match(stdout, /✓  Gateway/);
  assert.match(stdout, /✓  Web/);
  assert.match(stdout, /✓  Worker/);
  // run.json 状态流转到 running。
  const latest = JSON.parse(
    await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
  );
  assert.equal(latest.state, 'running');
  assert.equal(latest.services.worker.state, 'ready');
  // JSONL 每行可独立解析。
  const combined = await readFile(
    path.join(logsRoot, latest.runId, 'combined.jsonl'),
    'utf8',
  );
  for (const line of combined.split('\n').filter(Boolean)) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
  // 前台 supervisor：SIGINT 优雅退出。
  child.kill('SIGINT');
  const code = await Promise.race([
    exited.then((value) => value),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
  ]);
  assert.equal(code, 130);
});

test('Worker 在 ready 前退出 → 整体启动失败，不宣布 ready', async () => {
  const { directory } = await makeFakeRuntimeBinaries();
  const logsRoot = await makeLogsRoot();
  const result = await run(['all'], {
    PORT: '61941',
    EDUCANVAS_GATEWAY_PORT: '61942',
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    FAKE_DIR: directory,
    FAKE_SERVICE_WORKER: 'exit-before-ready',
    EDUCANVAS_LOGS_ROOT: logsRoot,
    EDUCANVAS_READY_TIMEOUT_MS: '15000',
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /在就绪前退出/);
  assert.match(result.stderr, /Startup failed/);
  assert.doesNotMatch(result.stdout, /✓  Web/);
});

test('Gateway 在 ready 前退出 → 整体启动失败', async () => {
  const { directory } = await makeFakeRuntimeBinaries();
  const logsRoot = await makeLogsRoot();
  const result = await run(['all'], {
    PORT: '61943',
    EDUCANVAS_GATEWAY_PORT: '61944',
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    FAKE_DIR: directory,
    FAKE_SERVICE_GATEWAY: 'exit-before-ready',
    EDUCANVAS_LOGS_ROOT: logsRoot,
    EDUCANVAS_READY_TIMEOUT_MS: '15000',
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /在就绪前退出/);
});

test('Web readiness 超时 → 整体启动失败', async () => {
  const { directory } = await makeFakeRuntimeBinaries();
  const logsRoot = await makeLogsRoot();
  const result = await run(['all'], {
    PORT: '61945',
    EDUCANVAS_GATEWAY_PORT: '61946',
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    FAKE_DIR: directory,
    FAKE_SERVICE_WEB: 'hang',
    EDUCANVAS_LOGS_ROOT: logsRoot,
    EDUCANVAS_READY_TIMEOUT_MS: '1500',
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /web 在 1500ms 内未就绪/);
});

test('Ctrl-C 优雅停止全部 owned 进程', async () => {
  const { directory } = await makeFakeRuntimeBinaries();
  const logsRoot = await makeLogsRoot();
  const gatewayPort = 61_947;
  const webPort = 61_948;
  const child = spawn(
    process.execPath,
    ['tooling/local-orchestrator.mjs', 'all'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(webPort),
        EDUCANVAS_GATEWAY_PORT: String(gatewayPort),
        PATH: `${directory}${path.delimiter}${process.env.PATH}`,
        FAKE_DIR: directory,
        EDUCANVAS_LOGS_ROOT: logsRoot,
        EDUCANVAS_READY_TIMEOUT_MS: '15000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  const exited = new Promise((resolve) => child.once('exit', resolve));

  const deadline = Date.now() + 20_000;
  while (
    !stdout.includes('EduCanvas · Local Runtime') &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(stdout.includes('Local Runtime'), 'orchestrator 未就绪');

  const latest = JSON.parse(
    await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
  );
  const pids = [
    latest.orchestratorPid,
    ...Object.values(latest.services).map((s) => s.pid),
  ].filter((pid) => typeof pid === 'number');

  child.kill('SIGINT');
  const result = await Promise.race([
    exited.then((code) => code),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
  ]);
  assert.equal(result, 130, 'SIGINT 应退出码 130');

  // owned 进程必须全部终止（不残留孤儿）。
  for (const pid of pids) {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, `进程 ${pid} 未被清理`);
  }
  // run.json 状态更新为 stopped。
  const afterStop = JSON.parse(
    await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
  );
  assert.equal(afterStop.state, 'stopped');
});

test('auto-clears a half core and proceeds to start the core', async () => {
  const gatewayPort = 61_949;
  const webPort = 61_950;
  const {
    child: fixture,
    exited: fixtureExited,
    ready,
  } = spawnFixture(gatewayPort, 'gateway');
  await ready;
  const fixturePid = fixture.pid;

  const { directory } = await makeFakeRuntimeBinaries();
  const logsRoot = await makeLogsRoot();
  const repoPath = process.cwd();
  const result = await run(['web'], {
    PORT: String(webPort),
    EDUCANVAS_GATEWAY_PORT: String(gatewayPort),
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    FAKE_DIR: directory,
    FAKE_SERVICE_GATEWAY: 'exit-before-ready',
    EDUCANVAS_LOGS_ROOT: logsRoot,
    EDUCANVAS_READY_TIMEOUT_MS: '15000',
    // fake lsof/ps：fixture 命令行含仓库特征（EduCanvas），应被判定可清理。
    FAKE_LSOF_MAP: `${gatewayPort}:${fixturePid}`,
    FAKE_PS_MAP: `${fixturePid}:node ${repoPath}/tooling/local-core-cleanup.fixture.mjs`,
  });

  await waitForExit(fixtureExited);
  assert.match(result.stdout, /检测到不完整的 core/);
  assert.match(result.stdout, /已停止 1 个残留进程/);
  assert.equal(result.code, 1);
});

test('falls back to a manual hint when cleanup cannot free the ports', async () => {
  const gatewayPort = 61_951;
  const webPort = 61_952;

  const foreign = spawn(
    process.execPath,
    [
      '-e',
      `require('http').createServer((req, res) => res.end('ok')).listen(${webPort}, '127.0.0.1', () => console.log('ready'))`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const foreignExited = new Promise((resolve) => foreign.once('exit', resolve));
  await new Promise((resolve, reject) =>
    foreign.stdout
      .on('data', (chunk) => {
        if (String(chunk).includes('ready')) resolve();
      })
      .once('exit', () => reject(new Error('foreign server exited early'))),
  );

  const { directory } = await makeFakeRuntimeBinaries();
  const logsRoot = await makeLogsRoot();
  let result;
  try {
    result = await run(['web'], {
      PORT: String(webPort),
      EDUCANVAS_GATEWAY_PORT: String(gatewayPort),
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      FAKE_DIR: directory,
      EDUCANVAS_LOGS_ROOT: logsRoot,
      EDUCANVAS_READY_TIMEOUT_MS: '15000',
      // 无关进程命令行不含仓库特征 → cleanup 不得误杀。
      FAKE_LSOF_MAP: `${webPort}:${foreign.pid}`,
      FAKE_PS_MAP: `${foreign.pid}:node -e inline http server`,
    });
  } finally {
    foreign.kill();
    await waitForExit(foreignExited);
  }

  assert.match(result.stderr, /残留进程清理失败/);
  assert.match(result.stderr, /仍被占用/);
  assert.equal(result.code, 1);
});

test('失败摘要只包含相关服务（不倾倒无关日志）', async () => {
  const { directory } = await makeFakeRuntimeBinaries();
  const logsRoot = await makeLogsRoot();
  const result = await run(['all'], {
    PORT: '61953',
    EDUCANVAS_GATEWAY_PORT: '61954',
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    FAKE_DIR: directory,
    FAKE_SERVICE_WORKER: 'exit-before-ready',
    EDUCANVAS_LOGS_ROOT: logsRoot,
    EDUCANVAS_READY_TIMEOUT_MS: '15000',
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Recent worker events/);
  assert.doesNotMatch(result.stderr, /Recent web events/);
});
