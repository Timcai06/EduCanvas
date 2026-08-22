/**
 * 本地运行时操作 — status / stop。
 *
 * 状态判定纪律：
 * - 不只信 run.json：进程存活（PID 探测）+ 服务健康探针（Gateway/Web HTTP）
 *   + Worker readiness（run.json 状态 + pid 存活）结合；
 * - stop 只停止「验证过 ownership 的本项目进程」（orchestrator 及其 spawn 的
 *   服务 PID），绝不按镜像名/全量 node 进程清理；run.json 记录的 PID 可能被
 *   操作系统复用，命令行不含 EduCanvas 特征或无法读取的一律跳过并提示，
 *   不误杀仓库外进程。
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { gatewayProbe, probe } from './local-health-probe.mjs';
import {
  killOwnedProcessTree,
  pidAlive,
  verifyRecordedProcesses,
  workerRunning,
} from './local-process-identity.mjs';
import { renderSummaryLine } from './local-pretty.mjs';
import { isDatabaseRunning } from './local-db.mjs';
import { composeArgs } from './local-compose.mjs';
import { GLYPHS } from '../terminal/glyphs.mjs';
import { paint } from '../terminal/theme.mjs';
import {
  DEFAULT_LOGS_ROOT,
  readLatest,
  readRunMeta,
  updateRunState,
} from './local-run-session.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 状态卡片渲染（纯函数，测试友好）。返回行数组（不含标题）。
 * 状态词保持历史契约：ready/stopped/down/none，detail 含 dbPort/urls/pid。
 */
export function renderStatusCard({
  database,
  gateway,
  web,
  worker,
  latest,
  dbPort,
  webUrl,
  gatewayUrl,
  colorEnabled,
}) {
  const rows = [
    ['Database', database ? 'ready' : 'stopped', `127.0.0.1:${dbPort}`],
    ['Gateway', gateway ? 'ready' : 'stopped', gatewayUrl],
    ['Web', web ? 'ready' : 'stopped', webUrl],
    [
      'Worker',
      worker ? 'ready' : 'down',
      worker ? `pid=${latest?.services?.worker?.pid ?? '-'}` : '',
    ],
    ['Runtime', latest?.state ?? 'none', latest?.runId ?? ''],
  ];
  return rows.map(([name, state, detail]) => {
    const mark =
      state === 'ready' || state === 'running' ? GLYPHS.ok : GLYPHS.fail;
    return `  ${renderSummaryLine(mark, name, `${state}${detail ? `  ${detail}` : ''}`, { color: colorEnabled })}`;
  });
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
  // Makefile 通过 EDUCANVAS_POSTGRES_PORT 覆盖本地 Compose 宿主端口映射，
  // 这里必须读同一环境变量，不能写死（默认 5434）。
  const dbPort = process.env.EDUCANVAS_POSTGRES_PORT ?? '5434';
  const out = (line = '') => process.stdout.write(`${line}\n`);
  out(
    `${colorEnabled ? paint(GLYPHS.brand, 'brand') : GLYPHS.brand} EduCanvas · Local Status`,
  );
  out('');
  for (const line of renderStatusCard({
    database,
    gateway,
    web,
    worker,
    latest,
    dbPort,
    webUrl,
    gatewayUrl,
    colorEnabled,
  })) {
    out(line);
  }
  return gateway && web && worker && latest?.state === 'running';
}

/**
 * 停止本地运行时。stopCore / stopDb 相互独立：
 * - stop       → stopCore=true,  stopDb=true
 * - stop-core  → stopCore=true,  stopDb=false
 * - stop-db    → stopCore=false, stopDb=true
 *
 * 从 latest.json 定位 runId，读取 run.json 中的 orchestratorPid 与服务 PID。
 * 记录 PID 一律先做 ownership 验证（local-process-identity）：PID 可能被
 * 操作系统复用，命令行不含 EduCanvas 特征或无法读取的一律跳过并提示，
 * 只对验证通过的 PID 发 SIGTERM（5s 后若仍存活则 SIGKILL）。
 */
export async function runStop({ stopCore, stopDb }) {
  const out = (line = '') => process.stdout.write(`${line}\n`);

  if (stopCore) {
    const latest = await readLatest(DEFAULT_LOGS_ROOT);
    const runDirectory = latest?.runId
      ? path.join(DEFAULT_LOGS_ROOT, latest.runId)
      : null;
    const meta = runDirectory ? await readRunMeta(runDirectory) : null;

    const { owned, skipped } = await verifyRecordedProcesses(meta);
    for (const skip of skipped) {
      if (skip.reason === 'unowned' || skip.reason === 'unknown') {
        out(`[local] 跳过 PID ${skip.pid}：无法确认属于当前 EduCanvas runtime`);
      }
    }
    const alivePids = owned.map((record) => record.pid).filter(pidAlive);
    if (alivePids.length === 0) {
      out('[local] 没有可安全停止的 EduCanvas core 进程');
    } else {
      for (const pid of alivePids) {
        await killOwnedProcessTree(pid, 'SIGTERM');
      }
      out(`[local] 已向 ${alivePids.length} 个本项目进程发送 SIGTERM`);
      // 等待优雅退出，5s 后强杀仍存活的。
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && alivePids.some(pidAlive)) {
        await sleep(250);
      }
      for (const pid of alivePids) {
        if (pidAlive(pid)) await killOwnedProcessTree(pid, 'SIGKILL');
      }
      if (runDirectory) {
        await updateRunState(runDirectory, {
          state: 'stopped',
          stoppedAt: new Date().toISOString(),
          exitReason: 'stop-command',
        });
      }
    }
  }

  if (stopDb) {
    try {
      execFileSync('docker', composeArgs('stop', 'db'), { stdio: 'inherit' });
      out('[local] 数据库已停止（数据卷保留）');
    } catch {
      out('[local] 数据库停止失败或 Docker 不可用');
    }
  }
}
