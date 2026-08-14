/**
 * 本地运行时操作 — status / stop。
 *
 * 状态判定纪律：
 * - 不只信 run.json：进程存活（PID 探测）+ 服务健康探针（Gateway/Web HTTP）
 *   + Worker readiness（run.json 状态 + pid 存活）结合；
 * - stop 只停止 run.json 记录的「本项目进程」（orchestrator 及其 spawn 的
 *   服务 PID），绝不按镜像名/全量 node 进程清理，不误杀仓库外进程。
 */

import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { renderSummaryLine } from './local-pretty.mjs';
import { isDatabaseRunning } from './local-db.mjs';
import {
  DEFAULT_LOGS_ROOT,
  readLatest,
  readRunMeta,
  updateRunState,
} from './local-run-session.mjs';
import { workerRunning } from './local-startup.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function gatewayProbe(gatewayUrl) {
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

/** 输出当前状态表；返回是否全部就绪。 */
export async function runStatus({ webUrl, gatewayUrl, colorEnabled }) {
  const [gateway, web, worker, latest, database] = await Promise.all([
    gatewayProbe(gatewayUrl),
    probe(webUrl),
    workerRunning(),
    readLatest(DEFAULT_LOGS_ROOT),
    isDatabaseRunning(),
  ]);
  const out = (line = '') => process.stdout.write(`${line}\n`);
  out('EduCanvas · Local Status');
  out('');
  const rows = [
    ['Database', database ? 'ready' : 'stopped', '127.0.0.1:5434'],
    ['Gateway', gateway ? 'ready' : 'stopped', gatewayUrl],
    ['Web', web ? 'ready' : 'stopped', webUrl],
    [
      'Worker',
      worker ? 'ready' : 'down',
      worker ? `pid=${latest?.services?.worker?.pid ?? '-'}` : '',
    ],
    ['Runtime', latest?.state ?? 'none', latest?.runId ?? ''],
  ];
  for (const [name, state, detail] of rows) {
    const mark = state === 'ready' || state === 'running' ? '✓' : '✗';
    out(
      `  ${renderSummaryLine(mark, name, `${state}${detail ? `  ${detail}` : ''}`, { color: colorEnabled })}`,
    );
  }
  return gateway && web && worker && latest?.state === 'running';
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * 停止当前运行：从 latest.json 定位 runId，读取 run.json 中的
 * orchestratorPid 与服务 PID，仅对记录在案的 PID 发 SIGTERM（5s 后
 * 若仍存活则 SIGKILL）。Windows 下同样走 PID 精确路径。
 */
export async function runStop({ stopDb }) {
  const out = (line = '') => process.stdout.write(`${line}\n`);
  const latest = await readLatest(DEFAULT_LOGS_ROOT);
  const runDirectory = latest?.runId
    ? path.join(DEFAULT_LOGS_ROOT, latest.runId)
    : null;
  const meta = runDirectory ? await readRunMeta(runDirectory) : null;

  const targetPids = new Set();
  if (meta?.orchestratorPid) targetPids.add(meta.orchestratorPid);
  for (const service of Object.values(meta?.services ?? {})) {
    if (typeof service?.pid === 'number') targetPids.add(service.pid);
  }
  const alivePids = [...targetPids].filter(pidAlive);
  if (alivePids.length === 0) {
    out('[local] 没有运行中的 EduCanvas core');
  } else {
    for (const pid of alivePids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // 进程已消失（竞态）。
      }
    }
    out(`[local] 已向 ${alivePids.length} 个本项目进程发送 SIGTERM`);
    // 等待优雅退出，5s 后强杀仍存活的。
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && alivePids.some(pidAlive)) {
      await sleep(250);
    }
    for (const pid of alivePids) {
      if (pidAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // 已退出。
        }
      }
    }
    if (runDirectory) {
      await updateRunState(runDirectory, {
        state: 'stopped',
        stoppedAt: new Date().toISOString(),
        exitReason: 'stop-command',
      });
    }
  }

  if (stopDb) {
    try {
      execFileSync('docker', ['compose', 'stop', 'db'], { stdio: 'inherit' });
      out('[local] 数据库已停止（数据卷保留）');
    } catch {
      out('[local] 数据库停止失败或 Docker 不可用');
    }
  }
  void execFile;
}
