#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import process from 'node:process';

const SUPPORTED_PROFILES = new Set(['all', 'web', 'tui', 'status']);
const profile = process.argv[2];
if (!profile || !SUPPORTED_PROFILES.has(profile)) {
  process.stderr.write('usage: local-orchestrator <all|web|tui|status>\n');
  process.exit(2);
}

const port = Number(process.env.PORT ?? '3101');
const gatewayPort = Number(process.env.EDUCANVAS_GATEWAY_PORT ?? '3200');
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT 必须是 1..65535 的整数');
}
if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65_535) {
  throw new Error('EDUCANVAS_GATEWAY_PORT 必须是 1..65535 的整数');
}

const webUrl = `http://127.0.0.1:${port}`;
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const children = new Set();
let shuttingDown = false;

async function probe(url, predicate = () => true) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok && predicate(response);
  } catch {
    return false;
  }
}

async function gatewayReady() {
  try {
    const response = await fetch(`${gatewayUrl}/healthz`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return (
      body?.service === 'educanvas-gateway' && body?.protocol === 'gateway.v1'
    );
  } catch {
    return false;
  }
}

async function webReady() {
  return probe(webUrl);
}

async function waitFor(label, check, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} 在 ${timeoutMs}ms 内未就绪`);
}

function spawnOwned(command, args, options = {}) {
  const child = spawn(command, args, {
    shell: process.platform === 'win32' && command === 'pnpm',
    env: process.env,
    ...options,
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('error', (error) => {
    process.stderr.write(`[local] ${command} 启动失败: ${error.message}\n`);
  });
  return child;
}

async function stopOwned(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill(signal);
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 5_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    ),
  );
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void stopOwned(signal).then(() =>
      process.exit(128 + (signal === 'SIGINT' ? 2 : 15)),
    );
  });
}

function openBrowser(url) {
  if (process.env.NO_OPEN === '1') {
    process.stdout.write(`[web] ${url}\n`);
    return;
  }
  const invocation =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  const child = spawn(invocation[0], invocation[1], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  process.stdout.write(`[web] 已打开 ${url}\n`);
}

async function printStatus() {
  const [gateway, web] = await Promise.all([gatewayReady(), webReady()]);
  process.stdout.write(
    `Gateway\t${gateway ? 'ready' : 'stopped'}\t${gatewayUrl}\n`,
  );
  process.stdout.write(`Web\t${web ? 'ready' : 'stopped'}\t${webUrl}\n`);
  return gateway && web;
}

async function ensureCore({ quiet }) {
  const [gateway, web] = await Promise.all([gatewayReady(), webReady()]);
  if (gateway && web) {
    process.stdout.write('[local] 复用已运行的 EduCanvas core\n');
    return null;
  }
  if (gateway !== web) {
    throw new Error(
      `检测到不完整的 core（Gateway=${gateway ? 'ready' : 'down'}, Web=${web ? 'ready' : 'down'}）；请先停止旧进程或运行 make status`,
    );
  }

  let stdio = 'inherit';
  let logFd = null;
  if (quiet) {
    mkdirSync('tmp', { recursive: true });
    logFd = openSync('tmp/educanvas-local-runtime.log', 'a');
    stdio = ['ignore', logFd, logFd];
    process.stdout.write(
      '[local] 后台服务日志: tmp/educanvas-local-runtime.log\n',
    );
  }
  const core = spawnOwned('pnpm', ['dev:core'], { stdio });
  if (logFd !== null) closeSync(logFd);
  const failed = new Promise((_, reject) => {
    core.once('exit', (code, signal) => {
      reject(
        new Error(
          `core 在就绪前退出（code=${code ?? '-'}, signal=${signal ?? '-'}）`,
        ),
      );
    });
  });
  await Promise.race([
    Promise.all([
      waitFor('Gateway', gatewayReady),
      waitFor('Web', webReady, 60_000),
    ]),
    failed,
  ]);
  process.stdout.write(`[local] Gateway ready: ${gatewayUrl}\n`);
  process.stdout.write(`[local] Web ready: ${webUrl}\n`);
  return core;
}

async function main() {
  if (profile === 'status') {
    const ready = await printStatus();
    process.exitCode = ready ? 0 : 1;
    return;
  }

  const core = await ensureCore({ quiet: profile === 'tui' });
  if (profile === 'web') {
    openBrowser(webUrl);
  }
  if (profile === 'tui') {
    const tui = spawnOwned('pnpm', ['--filter', '@educanvas/tui', 'dev'], {
      stdio: 'inherit',
    });
    const code = await new Promise((resolve) => tui.once('exit', resolve));
    if (core) await stopOwned();
    process.exitCode = typeof code === 'number' ? code : 1;
    return;
  }

  if (!core) return;
  const code = await new Promise((resolve) => core.once('exit', resolve));
  process.exitCode = typeof code === 'number' ? code : 1;
}

main().catch(async (error) => {
  await stopOwned();
  process.stderr.write(
    `[local] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
