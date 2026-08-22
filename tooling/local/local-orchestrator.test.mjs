import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
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
const scheduleCrashAfterReady = () => {
  if (mode === 'crash-after-ready') setTimeout(() => process.exit(1), 400);
};
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
      scheduleCrashAfterReady();
    });
  }
} else {
  if (mode === 'hang') setInterval(() => {}, 1000);
  else emit({ schema: 'educanvas.log.v1', ts: new Date().toISOString(), level: 'info', service: 'worker', event: 'worker.ready', message: 'fake worker ready', taskCount: 1, concurrency: 2, pollIntervalMs: 2000 });
  scheduleCrashAfterReady();
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
    `import { appendFileSync } from 'node:fs';
const joined = process.argv.slice(2).join(' ');
if (process.env.FAKE_DOCKER_LOG) {
  appendFileSync(process.env.FAKE_DOCKER_LOG, joined + '\\n');
}
if (/compose .* up -d db/.test(joined)) process.exit(0);
if (/pg_isready/.test(joined)) process.exit(0);
if (/system_identifier/.test(joined)) { process.stdout.write('123456\\n'); process.exit(0); }
if (/compose .* ps -q db/.test(joined)) { process.stdout.write('fakecontainer\\n'); process.exit(0); }
if (/compose .* stop/.test(joined)) process.exit(0);
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
      ['tooling/local/local-orchestrator.mjs', ...args],
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

/** 种子一个「正在运行」的旧会话：latest.json + run.json（worker 为真实存活 PID）。 */
async function seedRunningCore(
  logsRoot,
  workerPid,
  { runId = 'local-20260814-000000-0bbb' } = {},
) {
  const runDir = path.join(logsRoot, runId);
  await (await import('node:fs/promises')).mkdir(runDir, { recursive: true });
  await writeFile(
    path.join(logsRoot, 'latest.json'),
    JSON.stringify(
      { schema: 'educanvas.local-run.v1', runId, state: 'running' },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(
    path.join(runDir, 'run.json'),
    JSON.stringify(
      {
        schema: 'educanvas.local-run.v1',
        runId,
        state: 'running',
        orchestratorPid: 0,
        services: { worker: { pid: workerPid, state: 'ready' } },
      },
      null,
      2,
    ),
    'utf8',
  );
  return runId;
}

/** 起一个长驻 dummy 进程（模拟旧的 worker/orchestrator），独立进程组。 */
function spawnDummyProcess() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 起一个占端口的 fixture 子进程；gateway 模式按 orchestrator 健康协议响应。 */
function spawnFixture(port, mode) {
  const script = path.resolve('tooling/local/local-core-cleanup.fixture.mjs');
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
    port: 3000,
    gatewayPort: 3200,
  });
  assert.equal(env.PORT, '3000');
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
    ['tooling/local/local-orchestrator.mjs', 'all'],
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
    ['tooling/local/local-orchestrator.mjs', 'all'],
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
    FAKE_PS_MAP: `${fixturePid}:node ${repoPath}/tooling/local/local-core-cleanup.fixture.mjs`,
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

test('第二次 make all 复用同一 runtime：runId/PID 不变、不产生第二个 worker', async () => {
  const { directory } = await makeFakeRuntimeBinaries();
  const logsRoot = await makeLogsRoot();
  const gatewayPort = 61_955;
  const webPort = 61_956;
  const env = {
    ...process.env,
    PORT: String(webPort),
    EDUCANVAS_GATEWAY_PORT: String(gatewayPort),
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    FAKE_DIR: directory,
    EDUCANVAS_LOGS_ROOT: logsRoot,
    EDUCANVAS_READY_TIMEOUT_MS: '15000',
  };
  const first = spawn(
    process.execPath,
    ['tooling/local/local-orchestrator.mjs', 'all'],
    { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  first.stdout.on('data', (chunk) => (stdout += chunk));
  first.stderr.on('data', (chunk) => (stderr += chunk));
  const firstExited = new Promise((resolve) => first.once('exit', resolve));

  const deadline = Date.now() + 20_000;
  while (
    !stdout.includes('EduCanvas · Local Runtime') &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(stdout.includes('Local Runtime'), `第一次启动未就绪: ${stderr}`);

  const before = JSON.parse(
    await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
  );
  assert.equal(before.state, 'running');
  const runIdBefore = before.runId;
  const workerPidBefore = before.services.worker.pid;

  // 第二次 make all：必须复用已有 core——不新建会话、不覆盖 latest.json、
  // 不产生任何新进程。
  const second = await run(['all'], env);
  assert.equal(second.code, 0);
  assert.match(second.stdout, /复用已运行的 EduCanvas core/);
  assert.doesNotMatch(second.stdout, /不完整的 core/);

  const after = JSON.parse(
    await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
  );
  assert.equal(after.runId, runIdBefore, 'runId 不应被新建');
  assert.equal(
    after.services.worker.pid,
    workerPidBefore,
    '不应产生第二个 worker',
  );
  assert.equal(after.state, 'running');
  const runDirs = (await readdir(logsRoot, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory(),
  );
  assert.equal(runDirs.length, 1, '不应新建 run directory');

  first.kill('SIGINT');
  const code = await Promise.race([
    firstExited,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
  ]);
  assert.equal(code, 130);
});

test('partial core 清理会连带停止旧会话记录的 worker 进程', async () => {
  // 旧会话：gateway 端口被真实 fixture 占用、worker 是真实存活进程（记录在
  // run.json 但不在任何端口监听）→ partial。清理必须按记录 PID 停掉 worker，
  // 而不是只清 Gateway/Web 端口。
  const gatewayPort = 61_957;
  const webPort = 61_958;
  const {
    child: fixture,
    exited: fixtureExited,
    ready,
  } = spawnFixture(gatewayPort, 'gateway');
  await ready;
  const worker = spawnDummyProcess();

  const logsRoot = await makeLogsRoot();
  const oldRunId = 'local-20260814-000000-0aaa';
  const oldDir = path.join(logsRoot, oldRunId);
  await (await import('node:fs/promises')).mkdir(oldDir, { recursive: true });
  await writeFile(
    path.join(logsRoot, 'latest.json'),
    JSON.stringify(
      { schema: 'educanvas.local-run.v1', runId: oldRunId, state: 'running' },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(
    path.join(oldDir, 'run.json'),
    JSON.stringify(
      {
        schema: 'educanvas.local-run.v1',
        runId: oldRunId,
        state: 'running',
        services: {
          gateway: { pid: fixture.pid, state: 'ready' },
          worker: { pid: worker.pid, state: 'ready' },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const { directory } = await makeFakeRuntimeBinaries();
  const repoPath = process.cwd();
  const child = spawn(
    process.execPath,
    ['tooling/local/local-orchestrator.mjs', 'all'],
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
        FAKE_LSOF_MAP: `${gatewayPort}:${fixture.pid}`,
        // fixture 与 worker 命令行都含 EduCanvas 特征（worker 走 run.json 记录
        // PID 路径），都应被判定为 owned 并清理。
        FAKE_PS_MAP: `${fixture.pid}:node ${repoPath}/tooling/local/local-core-cleanup.fixture.mjs;${worker.pid}:pnpm --filter @educanvas/worker dev`,
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
  assert.ok(stdout.includes('Local Runtime'), `新 core 未就绪: ${stderr}`);
  assert.match(stdout, /检测到不完整的 core/);

  // 旧 worker 必须已被清理（记录 PID 路径），而不是只清端口进程。
  assert.equal(pidAlive(worker.pid), false, '旧 worker 未被清理');
  await waitForExit(fixtureExited);

  const latest = JSON.parse(
    await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
  );
  assert.notEqual(latest.runId, oldRunId, '应创建新会话');
  assert.equal(latest.state, 'running');
  assert.equal(latest.services.worker.state, 'ready');

  child.kill('SIGINT');
  const code = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
  ]);
  assert.equal(code, 130);
});

test('recorded PID 被无关进程复用 → 清理跳过而非误杀（fail closed）', async () => {
  // 旧会话 run.json 记录 worker.pid，但该 PID 现在属于无关进程（命令行
  // 不含 EduCanvas 特征）。stale cleanup 必须跳过它、提示手动处理，绝不 kill。
  const gatewayPort = 61_967;
  const webPort = 61_968;
  const {
    child: fixture,
    exited: fixtureExited,
    ready,
  } = spawnFixture(gatewayPort, 'gateway');
  await ready;
  const worker = spawnDummyProcess();

  const logsRoot = await makeLogsRoot();
  const oldRunId = 'local-20260814-000000-0cba';
  const oldDir = path.join(logsRoot, oldRunId);
  await (await import('node:fs/promises')).mkdir(oldDir, { recursive: true });
  await writeFile(
    path.join(logsRoot, 'latest.json'),
    JSON.stringify(
      {
        schema: 'educanvas.local-run.v1',
        runId: oldRunId,
        state: 'running',
        // worker 存活使清理后的重新探测仍判 partial（fail closed），
        // 而不是误判 none 后带着冲突启动新 core。
        services: { worker: { pid: worker.pid, state: 'ready' } },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(
    path.join(oldDir, 'run.json'),
    JSON.stringify(
      {
        schema: 'educanvas.local-run.v1',
        runId: oldRunId,
        state: 'running',
        services: {
          gateway: { pid: fixture.pid, state: 'ready' },
          worker: { pid: worker.pid, state: 'ready' },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const { directory } = await makeFakeRuntimeBinaries();
  const repoPath = process.cwd();
  let result;
  try {
    result = await run(['all'], {
      PORT: String(webPort),
      EDUCANVAS_GATEWAY_PORT: String(gatewayPort),
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      FAKE_DIR: directory,
      EDUCANVAS_LOGS_ROOT: logsRoot,
      EDUCANVAS_READY_TIMEOUT_MS: '15000',
      // fixture 命令行含仓库特征 → 可清理；worker 命令行不含 EduCanvas
      // 特征（PID 复用场景）→ 必须跳过。
      FAKE_LSOF_MAP: `${gatewayPort}:${fixture.pid}`,
      FAKE_PS_MAP: `${fixture.pid}:node ${repoPath}/tooling/local/local-core-cleanup.fixture.mjs;${worker.pid}:node -e inline http server`,
    });
    // 关键断言：清理流程执行完毕且进程仍存活——不得误杀被复用的 PID。
    assert.equal(pidAlive(worker.pid), true, '清理误杀了被复用的无关进程');
  } finally {
    try {
      process.kill(-worker.pid, 'SIGKILL');
    } catch {
      /* 已退出 */
    }
  }

  assert.match(
    result.stdout,
    /跳过 PID \d+：无法确认属于当前 EduCanvas runtime/,
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /仍被占用/);
  await waitForExit(fixtureExited);
});

test('stop-core 不误杀被复用的 run.json PID', async () => {
  const logsRoot = await makeLogsRoot();
  const worker = spawnDummyProcess();
  try {
    await seedRunningCore(logsRoot, worker.pid);
    const { directory } = await makeFakeRuntimeBinaries();
    const dockerLog = path.join(logsRoot, 'docker.log');
    const result = await run(['stop-core'], {
      EDUCANVAS_LOGS_ROOT: logsRoot,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      FAKE_DOCKER_LOG: dockerLog,
      // run.json 记录 PID 现在属于无关进程（命令行不含 EduCanvas 特征）。
      FAKE_PS_MAP: `${worker.pid}:node -e inline http server`,
    });
    assert.equal(result.code, 0);
    assert.equal(pidAlive(worker.pid), true, 'stop-core 不得误杀被复用的 PID');
    assert.match(
      result.stdout,
      /跳过 PID \d+：无法确认属于当前 EduCanvas runtime/,
    );
    const latest = JSON.parse(
      await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
    );
    assert.equal(latest.state, 'running', '未实际停止任何进程，不应改写状态');
  } finally {
    try {
      process.kill(-worker.pid, 'SIGKILL');
    } catch {
      /* 已退出 */
    }
  }
});

test('stop-db 只停数据库：core 进程保持存活', async () => {
  const logsRoot = await makeLogsRoot();
  const worker = spawnDummyProcess();
  try {
    await seedRunningCore(logsRoot, worker.pid);
    const { directory } = await makeFakeRuntimeBinaries();
    const dockerLog = path.join(logsRoot, 'docker.log');
    const result = await run(['stop-db'], {
      EDUCANVAS_LOGS_ROOT: logsRoot,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      FAKE_DOCKER_LOG: dockerLog,
    });
    assert.equal(result.code, 0);
    assert.equal(pidAlive(worker.pid), true, 'stop-db 不应停止 core');
    assert.match(await readFile(dockerLog, 'utf8'), /compose .* stop/);
    const latest = JSON.parse(
      await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
    );
    assert.equal(latest.state, 'running', 'stop-db 不应改写运行状态');
  } finally {
    try {
      process.kill(-worker.pid, 'SIGTERM');
    } catch {
      try {
        process.kill(worker.pid, 'SIGTERM');
      } catch {
        /* 已退出 */
      }
    }
  }
});

test('stop-core 只停 core：数据库容器不动', async () => {
  const logsRoot = await makeLogsRoot();
  const worker = spawnDummyProcess();
  try {
    await seedRunningCore(logsRoot, worker.pid);
    const { directory } = await makeFakeRuntimeBinaries();
    const dockerLog = path.join(logsRoot, 'docker.log');
    const result = await run(['stop-core'], {
      EDUCANVAS_LOGS_ROOT: logsRoot,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      FAKE_DOCKER_LOG: dockerLog,
      // run.json 记录的 worker PID 命令行需含 EduCanvas 特征才会被 stop。
      FAKE_PS_MAP: `${worker.pid}:pnpm --filter @educanvas/worker dev`,
    });
    assert.equal(result.code, 0);
    assert.equal(pidAlive(worker.pid), false, 'stop-core 应停止 core');
    let dockerLogContent = '';
    try {
      dockerLogContent = await readFile(dockerLog, 'utf8');
    } catch {
      // docker 从未被调用（文件不存在）。
    }
    assert.doesNotMatch(dockerLogContent, /compose .* stop/);
    const latest = JSON.parse(
      await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
    );
    assert.equal(latest.state, 'stopped');
    assert.equal(latest.exitReason, 'stop-command');
  } finally {
    try {
      process.kill(-worker.pid, 'SIGKILL');
    } catch {
      /* 已退出 */
    }
  }
});

test('stop 同时停止 core 与数据库', async () => {
  const logsRoot = await makeLogsRoot();
  const worker = spawnDummyProcess();
  try {
    await seedRunningCore(logsRoot, worker.pid);
    const { directory } = await makeFakeRuntimeBinaries();
    const dockerLog = path.join(logsRoot, 'docker.log');
    const result = await run(['stop'], {
      EDUCANVAS_LOGS_ROOT: logsRoot,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      FAKE_DOCKER_LOG: dockerLog,
      // run.json 记录的 worker PID 命令行需含 EduCanvas 特征才会被 stop。
      FAKE_PS_MAP: `${worker.pid}:pnpm --filter @educanvas/worker dev`,
    });
    assert.equal(result.code, 0);
    assert.equal(pidAlive(worker.pid), false, 'stop 应停止 core');
    assert.match(await readFile(dockerLog, 'utf8'), /compose .* stop/);
    const latest = JSON.parse(
      await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
    );
    assert.equal(latest.state, 'stopped');
  } finally {
    try {
      process.kill(-worker.pid, 'SIGKILL');
    } catch {
      /* 已退出 */
    }
  }
});

test('ready 后 Worker 崩溃 → fail-fast：停止其余服务并非零退出', async () => {
  const { directory } = await makeFakeRuntimeBinaries();
  const logsRoot = await makeLogsRoot();
  const gatewayPort = 61_959;
  const webPort = 61_960;
  const child = spawn(
    process.execPath,
    ['tooling/local/local-orchestrator.mjs', 'all'],
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
        FAKE_SERVICE_WORKER: 'crash-after-ready',
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
  assert.ok(stdout.includes('Local Runtime'), `未就绪: ${stderr}`);
  const latest = JSON.parse(
    await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
  );
  const pids = [
    latest.orchestratorPid,
    ...Object.values(latest.services).map((service) => service.pid),
  ].filter((pid) => typeof pid === 'number');

  const code = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
  ]);
  assert.equal(code, 1, 'worker 崩溃后 orchestrator 应非零退出');
  assert.match(stdout, /worker 意外退出/);
  assert.match(stdout, /正在停止其余服务/);
  for (const pid of pids) {
    assert.equal(pidAlive(pid), false, `进程 ${pid} 未被清理`);
  }
  const after = JSON.parse(
    await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
  );
  assert.equal(after.state, 'failed');
});

test('ready 后 Gateway 崩溃 → fail-fast：停止其余服务并非零退出', async () => {
  const { directory } = await makeFakeRuntimeBinaries();
  const logsRoot = await makeLogsRoot();
  const gatewayPort = 61_963;
  const webPort = 61_964;
  const child = spawn(
    process.execPath,
    ['tooling/local/local-orchestrator.mjs', 'all'],
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
        FAKE_SERVICE_GATEWAY: 'crash-after-ready',
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
  assert.ok(stdout.includes('Local Runtime'), `未就绪: ${stderr}`);
  const latest = JSON.parse(
    await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
  );
  const pids = [
    latest.orchestratorPid,
    ...Object.values(latest.services).map((service) => service.pid),
  ].filter((pid) => typeof pid === 'number');

  const code = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
  ]);
  assert.equal(code, 1, 'gateway 崩溃后 orchestrator 应非零退出');
  assert.match(stdout, /gateway 意外退出/);
  for (const pid of pids) {
    assert.equal(pidAlive(pid), false, `进程 ${pid} 未被清理`);
  }
  const after = JSON.parse(
    await readFile(path.join(logsRoot, 'latest.json'), 'utf8'),
  );
  assert.equal(after.state, 'failed');
});

test('status 显示真实 DB 端口（EDUCANVAS_POSTGRES_PORT）', async () => {
  const logsRoot = await makeLogsRoot();
  const { directory } = await makeFakeRuntimeBinaries();
  const result = await run(['status'], {
    PORT: '61961',
    EDUCANVAS_GATEWAY_PORT: '61962',
    EDUCANVAS_POSTGRES_PORT: '5435',
    EDUCANVAS_LOGS_ROOT: logsRoot,
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /127\.0\.0\.1:5435/);
});
