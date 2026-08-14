#!/usr/bin/env node

/**
 * EduCanvas 本地运行时统一入口（薄 CLI，业务逻辑在 local-startup /
 * local-runtime-ops / local-log-viewer）。
 *
 * 模式：
 *   all            默认安静启动：阶段摘要 ≤20 行，运行日志入 run directory
 *   all-verbose    详细启动：pretty renderer 实时输出 + 保留 JSONL
 *   web            启动完整 core 并打开浏览器
 *   tui            启动完整 core（安静）并进入 Turbo TUI
 *   status         查看 Database/Gateway/Web/Worker/Runtime 状态
 *   stop           优雅停止当前 core 与数据库
 *   stop-core      只停止当前 core 进程
 *   stop-db        只停止数据库容器
 *   logs           日志查看（委托 local-log-viewer.mjs）
 *
 * Makefile / PowerShell / CMD 都是薄入口，只负责调用本脚本。
 */

import process from 'node:process';
import { applyResolvedLocalPorts } from './local-orchestrator-config.mjs';
import { runStop, runStatus } from './local-runtime-ops.mjs';
import { runStartup } from './local-startup.mjs';
import { loadWorkspaceEnvFiles } from './workspace-env.mjs';

const SUPPORTED_PROFILES = new Set([
  'all',
  'all-verbose',
  'web',
  'tui',
  'status',
  'stop',
  'stop-core',
  'stop-db',
  'logs',
]);

const profile = process.argv[2];
if (!profile || !SUPPORTED_PROFILES.has(profile)) {
  process.stderr.write(
    'usage: local-orchestrator <all|all-verbose|web|tui|status|stop|stop-core|stop-db|logs>\n',
  );
  process.exit(2);
}

loadWorkspaceEnvFiles();
const { port, gatewayPort } = applyResolvedLocalPorts(process.env);
const webUrl = `http://127.0.0.1:${port}`;
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

const colorEnabled =
  process.env.NO_COLOR === undefined &&
  process.env.NO_COLOR !== '' &&
  process.stdout.isTTY &&
  process.env.FORCE_COLOR !== '0';
const verbose = profile === 'all-verbose';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const out = (line = '') => process.stdout.write(`${line}\n`);

/** 优雅停止所有被监督的服务；超时后 SIGKILL。 */
async function stopEverything(services) {
  await Promise.all(
    Object.values(services).map((service) =>
      service.stopWithTimeout('SIGTERM', 5_000),
    ),
  );
  for (const service of Object.values(services)) service.close();
}

async function runLogs() {
  const { spawn } = await import('node:child_process');
  const args = process.argv.slice(3);
  const child = spawn(
    process.execPath,
    ['tooling/local-log-viewer.mjs', ...args],
    {
      stdio: 'inherit',
      env: process.env,
    },
  );
  const code = await new Promise((resolve) => child.once('exit', resolve));
  process.exitCode = typeof code === 'number' ? code : 1;
}

async function main() {
  if (profile === 'status') {
    process.exitCode = (await runStatus({ webUrl, gatewayUrl, colorEnabled }))
      ? 0
      : 1;
    return;
  }
  if (profile === 'stop' || profile === 'stop-core' || profile === 'stop-db') {
    await runStop({ stopDb: profile === 'stop' || profile === 'stop-db' });
    return;
  }
  if (profile === 'logs') {
    await runLogs();
    return;
  }

  const runtime = await runStartup({
    webUrl,
    gatewayUrl,
    verbose,
    colorEnabled,
    out,
  });
  if (runtime.services === null) return; // 复用已运行的 core

  const { services, session } = runtime;
  const { monitorServiceExits } = await import('./local-startup.mjs');
  const disposeWatchers = monitorServiceExits(services, session);
  let stopped = false;
  const shutdown = async (signal) => {
    if (stopped) return;
    stopped = true;
    disposeWatchers();
    await stopEverything(services);
    const { updateRunState } = await import('./local-run-session.mjs');
    await updateRunState(session.directory, {
      state: 'stopped',
      stoppedAt: new Date().toISOString(),
      exitReason: signal,
    });
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      void shutdown(signal).then(() =>
        process.exit(
          128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1),
        ),
      );
    });
  }

  if (profile === 'web') {
    await openBrowser(webUrl);
  }
  if (profile === 'tui') {
    const { launchService } = await import('./local-service-spawn.mjs');
    const tui = launchService({
      name: 'tui',
      command: 'pnpm',
      args: ['--filter', '@educanvas/tui', 'dev'],
      env: { ...process.env, EDUCANVAS_RUN_ID: session.runId },
      runDirectory: session.directory,
      verbose: true,
      color: false,
    });
    const { code } = await tui.exitPromise;
    await shutdown('tui-exit');
    process.exitCode = typeof code === 'number' ? code : 1;
    return;
  }

  // all / all-verbose：前台 supervisor，等待任一服务退出。
  const outcomes = await Promise.allSettled(
    Object.values(services).map((service) => service.exitPromise),
  );
  if (outcomes.some((result) => result.status === 'rejected'))
    process.exitCode = 1;
  await shutdown('core-exit');
}

main().catch((error) => {
  out(`[local] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function openBrowser(url) {
  if (process.env.NO_OPEN === '1') {
    out(`[web] ${url}`);
    return;
  }
  const invocation =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  const { spawn } = await import('node:child_process');
  const child = spawn(invocation[0], invocation[1], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  out(`[web] 已打开 ${url}`);
}

void sleep;
