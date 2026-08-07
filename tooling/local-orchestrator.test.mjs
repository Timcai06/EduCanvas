import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

/**
 * 生成一个 PATH 里前置的 fake pnpm：core 一 spawn 就立即失败退出，
 * 避免黑盒测试真的拉起 turbo/web/worker 三件套。
 */
async function makeFakePnpmBin() {
  const directory = await makeTemporaryDirectory('educanvas-orchestrator-');
  if (process.platform === 'win32') {
    await writeFile(
      path.join(directory, 'pnpm.cmd'),
      '@echo off\r\nexit /b 1\r\n',
    );
  } else {
    const script = path.join(directory, 'pnpm');
    await writeFile(script, '#!/bin/sh\nexit 1\n');
    await chmod(script, 0o755);
  }
  return directory;
}

/** 起一个占端口的 fixture 子进程；gateway 模式按 orchestrator 健康协议响应。 */
function spawnFixture(port, mode) {
  // 绝对路径：node 会把脚本路径原样写进进程命令行，cleanup 按
  // 「命令行含仓库特征」判断可清理性，相对路径会漏掉特征。
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

test('rejects an unknown profile', async () => {
  const result = await run(['unknown']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /all\|web\|tui\|status/);
});

test('status reports stopped services without starting processes', async () => {
  const result = await run(['status'], {
    PORT: '61991',
    EDUCANVAS_GATEWAY_PORT: '61992',
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Gateway\s+stopped/);
  assert.match(result.stdout, /Web\s+stopped/);
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
  assert.deepEqual(env, {
    PORT: '4101',
    EDUCANVAS_GATEWAY_PORT: '4200',
  });
});

test('auto-clears a half core and proceeds to start the core', async () => {
  const gatewayPort = 61_941;
  const webPort = 61_942;
  const {
    child: fixture,
    exited: fixtureExited,
    ready,
  } = spawnFixture(gatewayPort, 'gateway');
  await ready;

  const fakeBin = await makeFakePnpmBin();
  const result = await run(['web'], {
    PORT: String(webPort),
    EDUCANVAS_GATEWAY_PORT: String(gatewayPort),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
  });

  // 残留 gateway fixture 被自动清理（fixture 路径在仓库内，命令行含 EduCanvas）。
  await waitForExit(fixtureExited);
  // 清理后尝试启动 core；fake pnpm 立即退出，orchestrator 如实报错。
  assert.match(result.stderr, /自动停止旧进程/);
  assert.match(result.stderr, /已停止 1 个残留进程/);
  assert.match(result.stderr, /core 在就绪前退出/);
  assert.equal(result.code, 1);
});

async function waitForExit(exited, timeoutMs = 10_000) {
  const result = await Promise.race([
    exited.then(() => 'exited'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
  ]);
  assert.equal(result, 'exited');
}

test('falls back to a manual hint when cleanup cannot free the ports', async () => {
  const gatewayPort = 61_951;
  const webPort = 61_952;

  // 构造半个 core：gateway 端口空着，web 端口被一个与 EduCanvas 无关的
  // 进程（node -e 内联，命令行不含仓库特征）占住且回 200。cleanup 按
  // 端口 + 命令行双重校验，不该杀它；随后重新探测发现 web 端口仍是
  // ready（200），判定清理失败，回退到手动清理提示——而不是误杀，
  // 也不是带着端口冲突继续启动。
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

  const fakeBin = await makeFakePnpmBin();
  let result;
  try {
    result = await run(['web'], {
      PORT: String(webPort),
      EDUCANVAS_GATEWAY_PORT: String(gatewayPort),
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    });
  } finally {
    foreign.kill();
    await waitForExit(foreignExited);
  }

  assert.match(result.stderr, /自动清理失败/);
  assert.match(
    result.stderr,
    new RegExp(`请手动结束占用 ${gatewayPort}/${webPort} 端口的进程`),
  );
  assert.equal(result.code, 1);
});
