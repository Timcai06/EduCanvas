#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import process from 'node:process';
import { cleanupStaleCore } from './local-core-cleanup.mjs';
import { applyResolvedLocalPorts } from './local-orchestrator-config.mjs';
import { loadWorkspaceEnvFiles } from './workspace-env.mjs';

loadWorkspaceEnvFiles();

const SUPPORTED_PROFILES = new Set(['all', 'web', 'tui', 'status']);
const profile = process.argv[2];
if (!profile || !SUPPORTED_PROFILES.has(profile)) {
  process.stderr.write('usage: local-orchestrator <all|web|tui|status>\n');
  process.exit(2);
}

const { port, gatewayPort } = applyResolvedLocalPorts(process.env);

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

async function waitFor(label, check, timeoutMs = 30_000, aborted) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (aborted?.current) throw new Error(`${label} 探测已中止`);
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
  // 进程退出的权威信号。事件发生后不能重新挂 .once 监听（会永久挂起），
  // 因此立刻固定成一个 promise，之后随时 await 都立即拿到结果。
  // spawn 失败（ENOENT 等）不会触发 exit，这里一并兜底。
  child.exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) =>
      resolve({ code: null, signal: null, error }),
    );
  });
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
    // 半个 core：旧进程树还占着端口，无法复用也无法启动新 core。
    // 自动定位并清理「监听本服务端口且属于 EduCanvas 仓库」的残留进程
    //（按端口 + 命令行双重校验，绝不 taskkill 全量 node.exe），清理失败
    // 才回退到手动提示。make status 在 Windows 上不可用（Makefile 是
    // POSIX 语法），因此提示改为通用的端口占用说明。
    process.stderr.write(
      `[local] 检测到不完整的 core（Gateway=${gateway ? 'ready' : 'down'}, Web=${web ? 'ready' : 'down'}），正在自动停止旧进程…\n`,
    );
    try {
      const { killed } = await cleanupStaleCore([gatewayPort, port]);
      if (killed > 0) {
        process.stderr.write(
          `[local] 已停止 ${killed} 个残留进程，重新探测…\n`,
        );
      }
      const [gatewayAfter, webAfter] = await Promise.all([
        gatewayReady(),
        webReady(),
      ]);
      if (gatewayAfter || webAfter) {
        throw new Error(`端口 ${gatewayPort}/${port} 仍被占用`);
      }
    } catch (error) {
      throw new Error(
        `检测到不完整的 core（Gateway=${gateway ? 'ready' : 'down'}, Web=${web ? 'ready' : 'down'}）；自动清理失败：${error.message}。请手动结束占用 ${gatewayPort}/${port} 端口的进程后重试`,
      );
    }
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
  // core 先退出时中止两个探测循环（resolve 而非 reject：race 已定胜负后
  // 再 resolve 是安全的多余事件，reject 会变成未处理的 rejection）。
  const aborted = { current: false };
  const failed = core.exitPromise.then(({ code, signal }) => {
    aborted.current = true;
    return new Error(
      `core 在就绪前退出（code=${code ?? '-'}, signal=${signal ?? '-'}）`,
    );
  });
  const outcome = await Promise.race([
    Promise.all([
      waitFor('Gateway', gatewayReady, 30_000, aborted),
      waitFor('Web', webReady, 60_000, aborted),
    ]).then(() => null),
    failed,
  ]);
  if (outcome) throw outcome;
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
  const { code } = await core.exitPromise;
  process.exitCode = typeof code === 'number' ? code : 1;
}

main().catch(async (error) => {
  await stopOwned();
  process.stderr.write(
    `[local] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
