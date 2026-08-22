/**
 * 本地运行会话（run session）— run directory / run.json / latest.json / retention。
 *
 * 设计（见统一日志协议 ADR）：
 * - 每次启动创建独立 run directory（`tmp/logs/local/local-<ts>-<rand>/`），
 *   不同会话日志互不混杂，文件内绝无 ANSI；
 * - `run.json` 是会话事实源（schema/state/pid/URLs/服务 pid）；
 * - `latest.json` 定位最近一次或当前运行；
 * - 保留策略：默认保留最近 10 次运行，永不删除当前运行；
 * - 清理失败只记录 warning，不阻断启动。
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const LOCAL_RUN_SCHEMA = 'educanvas.local-run.v1';
export const DEFAULT_LOGS_ROOT =
  process.env.EDUCANVAS_LOGS_ROOT ?? path.join('tmp', 'logs', 'local');
export const DEFAULT_RETENTION = 10;

/** 生成 `local-YYYYMMDD-HHMMSS-xxxx` 形式的运行 ID（时间 + 随机后缀）。 */
export function createRunId(
  now = new Date(),
  randomHex = randomBytes(2).toString('hex'),
) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  const date = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('');
  const time = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
  return `local-${date}-${time}-${randomHex}`;
}

export function runDirectoryFor(logsRoot, runId) {
  return path.join(logsRoot, runId);
}

function runMetaPath(directory) {
  return path.join(directory, 'run.json');
}

export function latestPath(logsRoot) {
  return path.join(logsRoot, 'latest.json');
}

export function serviceJsonlPath(directory, service) {
  return path.join(directory, `${service}.jsonl`);
}

/**
 * 创建新会话：建目录、写 run.json（state=starting）、更新 latest.json。
 * 返回 { runId, directory, meta }。
 */
export async function createRunSession({
  logsRoot = DEFAULT_LOGS_ROOT,
  now = new Date(),
  orchestratorPid = process.pid,
  webUrl,
  gatewayUrl,
  randomHex,
} = {}) {
  const runId = createRunId(now, randomHex);
  const directory = runDirectoryFor(logsRoot, runId);
  await mkdir(directory, { recursive: true });

  const meta = {
    schema: LOCAL_RUN_SCHEMA,
    runId,
    startedAt: now.toISOString(),
    orchestratorPid,
    state: 'starting',
  };
  if (webUrl !== undefined) meta.webUrl = webUrl;
  if (gatewayUrl !== undefined) meta.gatewayUrl = gatewayUrl;
  await writeRunMeta(directory, meta);
  await writeLatest(logsRoot, meta);
  return { runId, directory, meta };
}

/** 读取 run.json；缺失或损坏返回 null（调用方决定降级策略）。 */
export async function readRunMeta(directory) {
  try {
    const raw = await readFile(runMetaPath(directory), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeRunMeta(directory, meta) {
  await writeFile(
    runMetaPath(directory),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8',
  );
}

/**
 * 更新会话状态：写 run.json 并同步 latest.json。
 * patch 支持 state/stoppedAt/exitReason/services 等字段。
 */
export async function updateRunState(directory, patch) {
  const current = (await readRunMeta(directory)) ?? {};
  const next = { ...current, ...patch };
  await writeRunMeta(directory, next);
  await writeLatest(path.dirname(directory), next);
  return next;
}

/** 读取 latest.json；不存在或损坏返回 null。 */
export async function readLatest(logsRoot) {
  try {
    const raw = await readFile(latestPath(logsRoot), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeLatest(logsRoot, meta) {
  await mkdir(logsRoot, { recursive: true });
  await writeFile(
    latestPath(logsRoot),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8',
  );
}

/** 按目录名排序的运行会话（runId 时间戳前缀保证字典序即时间序）。 */
export async function listRuns(logsRoot) {
  let entries = [];
  try {
    entries = await readdir(logsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^local-\d{8}-\d{6}-[0-9a-f]{4}$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * 保留策略：按时间序保留最近 retention 个会话，绝不删除 currentRunId。
 * 清理失败不抛错，返回 { removed, warnings }。
 */
export async function pruneRuns(
  logsRoot,
  { retention = DEFAULT_RETENTION, currentRunId } = {},
) {
  const runs = await listRuns(logsRoot);
  const removable = runs.slice(0, Math.max(0, runs.length - retention));
  const warnings = [];
  let removed = 0;
  for (const runId of removable) {
    if (runId === currentRunId) continue;
    try {
      await rm(runDirectoryFor(logsRoot, runId), {
        recursive: true,
        force: true,
      });
      removed += 1;
    } catch (error) {
      warnings.push(`清理旧运行 ${runId} 失败: ${error.message}`);
    }
  }
  return { removed, warnings };
}

/**
 * 监视服务退出并更新 run.json 状态。返回 dispose：shutdown 时先取消，
 * 防止并发写 latest.json 与停止流程互相干扰（process.exit 会中断未完成
 * 的 writeFile，留下半写文件）。
 */
export function monitorServiceExits(services, session) {
  const active = new Set(Object.values(services));
  const watchers = new Map();
  for (const [name, service] of Object.entries(services)) {
    const watcher = ({ code }) => {
      if (!active.has(service)) return;
      void (async () => {
        const latest = await readLatest(DEFAULT_LOGS_ROOT);
        await updateRunState(session.directory, {
          services: {
            ...(latest?.services ?? {}),
            [name]: {
              pid: service.child?.pid,
              state: code === 0 ? 'stopped' : 'failed',
            },
          },
        });
      })();
    };
    service.exitPromise.then(watcher);
    watchers.set(service, () => active.delete(service));
  }
  return () => {
    for (const dispose of watchers.values()) dispose();
  };
}
