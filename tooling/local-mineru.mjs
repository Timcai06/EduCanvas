#!/usr/bin/env node
/**
 * MinerU 文档结构化转换服务（mineru-api）本地管理。
 *
 * 为什么单独是一个脚本而不是并入 local-orchestrator：MinerU 是独立部署的
 * GPU Python 服务（venv ~/mineru-env，见 docs/research/2026-08/03-MinerU部署手册.md），
 * 不在 orchestrator 的进程树里，`make dev`/`make stop` 管不到它；且 nohup 进程
 * 不跨重启存活，机器重启后它不会自动回来。本脚本提供 start/status/stop 三命令，
 * 挂到 Makefile 的 make mineru / mineru-status / mineru-stop，作为与 make dev 一致的入口。
 *
 * 用法：node tooling/local-mineru.mjs <start|status|stop>
 * 环境变量覆盖（按需）：
 *   MINERU_HOST  监听地址，默认 127.0.0.1（安全默认：mineru-api 无内置认证，不绑 0.0.0.0）
 *   MINERU_PORT  端口，默认 8000（与 .env 的 MINERU_BASE_URL 对齐）
 *   MINERU_ENV   venv 目录，默认 ~/mineru-env
 */

import { spawn, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { existsSync, openSync } from 'node:fs';

const MINERU_HOST = process.env.MINERU_HOST ?? '127.0.0.1';
const MINERU_PORT = process.env.MINERU_PORT ?? '8000';
const MINERU_ENV = process.env.MINERU_ENV ?? path.join(homedir(), 'mineru-env');
const API_BIN = path.join(MINERU_ENV, 'bin', 'mineru-api');
const LOG_PATH =
  process.env.MINERU_LOG ?? path.join(homedir(), 'mineru-api.log');
const HOST_URL = `http://${MINERU_HOST}:${MINERU_PORT}`;

/** 22GB 显存级别起步：并发拉满易 OOM，维持 1（部署手册第 5 步结论）。 */
const VLM_PRELOAD_TIMEOUT_MS = 240_000;

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

function fail(message, code = 1) {
  console.error(`[mineru] ${message}`);
  process.exit(code);
}

/** 找到正在运行的 mineru-api 主进程 PID（按 venv bin 的绝对路径精确匹配，避免误杀同名字面进程）。 */
function findPids() {
  try {
    const stdout = execFileSync('pgrep', ['-f', `bin/mineru-api`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return stdout
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((pid) => Number(pid));
  } catch {
    return [];
  }
}

async function cmdStatus() {
  const health = await probe();
  const pids = findPids();
  if (health && pids.length) {
    console.log(
      `[mineru] running  ${HOST_URL}/health → ${JSON.stringify(health)}  (pid ${pids.join(',')})`,
    );
    return;
  }
  console.log('[mineru] down    (8000 无响应，无 mineru-api 进程)');
  console.log('          启动：make mineru   查看归档日志：~/mineru-api.log');
}

async function cmdStart() {
  const health = await probe();
  if (health) {
    console.log(`[mineru] 已在运行 ${HOST_URL}/health → 跳过启动`);
    return;
  }
  if (!existsSync(API_BIN)) {
    fail(
      `未找到 ${API_BIN}，先按部署手册第 1-2 步安装（venv 需至少装 mineru[pipeline,vlm]）`,
    );
  }

  // detached + unref：服务不随本脚本退出而退出；stdout/stderr 落归档日志，
  // 与部署手册第 5 步 nohup 行为一致，便于事后排错。
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
      env: {
        ...process.env,
        MINERU_API_MAX_CONCURRENT_REQUESTS: '1',
      },
    },
  );
  child.unref();

  console.log(
    `[mineru] 启动中：${HOST_URL}（VLM 预载可能需要几十秒，最多等 ${VLM_PRELOAD_TIMEOUT_MS / 1000}s）`,
  );
  const startedAt = Date.now();
  while (Date.now() - startedAt < VLM_PRELOAD_TIMEOUT_MS) {
    const h = await probe();
    if (h) {
      console.log(
        `[mineru] 就绪 ${HOST_URL}/health → ${JSON.stringify(h)} (pid ${child.pid ?? '?'})`,
      );
      console.log(`         日志：${LOG_PATH}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  fail(
    `等待就绪超时（${VLM_PRELOAD_TIMEOUT_MS / 1000}s）。查看日志 ${LOG_PATH}，排错见部署手册第三、五节`,
  );
}

async function cmdStop() {
  const pids = findPids();
  if (!pids.length) {
    console.log('[mineru] 没有运行中的进程');
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // 进程刚好退出，忽略
    }
  }
  // 优雅退出最多等 5s，SIGTERM 没退就 SIGKILL，避免残留 GPU 显存占用。
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!findPids().length) {
      console.log('[mineru] 已停止');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  for (const pid of findPids()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 同上
    }
  }
  console.log('[mineru] 已强制停止（SIGKILL）');
}

const [, , command] = process.argv;
if (command === 'start') await cmdStart();
else if (command === 'status') await cmdStatus();
else if (command === 'stop') await cmdStop();
else fail('用法：node tooling/local-mineru.mjs <start|status|stop>');
