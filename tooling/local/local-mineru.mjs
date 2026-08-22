#!/usr/bin/env node
/**
 * MinerU 独立 GPU 服务本地管理。服务不属于 `make dev` 进程树，因此使用仓库根
 * 状态文件记录本脚本启动的唯一 PID；停止前还会复验绝对可执行路径与监听参数，
 * 绝不扫描或终止未记录的 mineru-api 进程。
 */

import { spawn, execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const STATE_SCHEMA = 'educanvas.local-mineru.v1';
const MINERU_HOST = process.env.MINERU_HOST ?? '127.0.0.1';
const MINERU_PORT = process.env.MINERU_PORT ?? '8000';
const MINERU_ENV = path.resolve(
  process.env.MINERU_ENV ?? path.join(homedir(), 'mineru-env'),
);
const API_BIN = path.join(MINERU_ENV, 'bin', 'mineru-api');
const LOG_PATH = path.resolve(
  process.env.MINERU_LOG ?? path.join(homedir(), 'mineru-api.log'),
);
const STATE_PATH = path.resolve(
  process.env.MINERU_STATE_FILE ??
    path.join(PROJECT_ROOT, '.educanvas-mineru-state.json'),
);
const HOST_URL = `http://${MINERU_HOST}:${MINERU_PORT}`;
const VLM_PRELOAD_TIMEOUT_MS = Number(
  process.env.MINERU_START_TIMEOUT_MS ?? 240_000,
);

function fail(message, code = 1) {
  console.error(`[mineru] ${message}`);
  process.exit(code);
}

function validateConfiguration() {
  const port = Number(MINERU_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail('MINERU_PORT 必须是 1-65535 的整数');
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(MINERU_HOST);
  if (!loopback && process.env.MINERU_ALLOW_REMOTE !== '1') {
    fail('MinerU 无内置认证；非回环监听需显式设置 MINERU_ALLOW_REMOTE=1');
  }
  if (
    !Number.isFinite(VLM_PRELOAD_TIMEOUT_MS) ||
    VLM_PRELOAD_TIMEOUT_MS < 1_000
  ) {
    fail('MINERU_START_TIMEOUT_MS 必须至少为 1000');
  }
}

async function probe() {
  try {
    const response = await fetch(`${HOST_URL}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function readState() {
  try {
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    if (
      state?.schema !== STATE_SCHEMA ||
      !Number.isInteger(state.pid) ||
      state.pid < 1 ||
      state.apiBin !== API_BIN ||
      state.host !== MINERU_HOST ||
      state.port !== MINERU_PORT
    ) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function writeState(pid) {
  const state = {
    schema: STATE_SCHEMA,
    pid,
    apiBin: API_BIN,
    host: MINERU_HOST,
    port: MINERU_PORT,
    startedAt: new Date().toISOString(),
  };
  const temporary = `${STATE_PATH}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, STATE_PATH);
}

function clearState() {
  try {
    unlinkSync(STATE_PATH);
  } catch {
    // Missing state is already clear.
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readCommandLine(pid) {
  try {
    if (process.platform === 'win32') {
      return execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function ownedState() {
  const state = readState();
  if (!state || !pidAlive(state.pid)) return null;
  const commandLine = readCommandLine(state.pid);
  const owns =
    commandLine.includes(state.apiBin) &&
    commandLine.includes(`--host ${state.host}`) &&
    commandLine.includes(`--port ${state.port}`);
  return owns ? state : null;
}

async function cmdStatus() {
  const health = await probe();
  const owned = ownedState();
  if (health && owned) {
    console.log(
      `[mineru] running  ${HOST_URL}/health → ${JSON.stringify(health)}  (pid ${owned.pid})`,
    );
    return;
  }
  if (health) {
    console.log(
      `[mineru] external ${HOST_URL}/health 有响应，但不是当前仓库记录的进程`,
    );
    return;
  }
  console.log(`[mineru] down    (${MINERU_HOST}:${MINERU_PORT} 无响应)`);
}

async function cmdStart() {
  const health = await probe();
  if (health) {
    const ownership = ownedState() ? '已由当前仓库启动' : '由外部进程提供';
    console.log(`[mineru] ${ownership} ${HOST_URL}/health → 跳过启动`);
    return;
  }
  if (!existsSync(API_BIN)) {
    fail(`未找到 ${API_BIN}，请先安装 mineru[pipeline,vlm]`);
  }

  const outFd = openSync(LOG_PATH, 'a');
  const child = spawn(
    API_BIN,
    [
      '--host',
      MINERU_HOST,
      '--port',
      MINERU_PORT,
      '--enable-vlm-preload',
      'true',
    ],
    {
      detached: true,
      stdio: ['ignore', outFd, outFd],
      env: { ...process.env, MINERU_API_MAX_CONCURRENT_REQUESTS: '1' },
    },
  );
  closeSync(outFd);
  if (!child.pid) fail('MinerU 进程未能启动');
  writeState(child.pid);
  child.unref();

  console.log(
    `[mineru] 启动中：${HOST_URL}（最多等待 ${VLM_PRELOAD_TIMEOUT_MS / 1000}s）`,
  );
  const startedAt = Date.now();
  while (Date.now() - startedAt < VLM_PRELOAD_TIMEOUT_MS) {
    const ready = await probe();
    if (ready) {
      console.log(
        `[mineru] 就绪 ${HOST_URL}/health → ${JSON.stringify(ready)} (pid ${child.pid})`,
      );
      console.log(`         日志：${LOG_PATH}`);
      return;
    }
    if (!pidAlive(child.pid)) {
      clearState();
      fail(`MinerU 启动进程已退出；查看日志 ${LOG_PATH}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  fail(`等待就绪超时；进程仍保留并记录在 ${STATE_PATH}，查看日志 ${LOG_PATH}`);
}

async function cmdStop() {
  const state = readState();
  if (!state) {
    console.log('[mineru] 没有当前配置对应的仓库状态记录；未停止任何进程');
    return;
  }
  const owned = ownedState();
  if (!owned) {
    console.log(
      `[mineru] 跳过 PID ${state.pid}：无法确认仍属于当前 MinerU 服务`,
    );
    return;
  }
  process.kill(owned.pid, 'SIGTERM');
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && pidAlive(owned.pid)) {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (pidAlive(owned.pid)) {
    const reverified = ownedState();
    if (!reverified) {
      console.log(`[mineru] 跳过 SIGKILL：PID ${owned.pid} 的身份已变化`);
      return;
    }
    process.kill(reverified.pid, 'SIGKILL');
  }
  clearState();
  console.log('[mineru] 已停止');
}

validateConfiguration();
const [, , command] = process.argv;
if (command === 'start') await cmdStart();
else if (command === 'status') await cmdStatus();
else if (command === 'stop') await cmdStop();
else fail('用法：node tooling/local/local-mineru.mjs <start|status|stop>');
