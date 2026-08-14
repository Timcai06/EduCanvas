/**
 * 统一启动状态机 — environment → database → migration → core → readiness。
 *
 * 阶段语义（见统一日志协议 ADR）：
 * - Database：docker compose up -d db 后等 pg_isready 真正健康；
 * - Migration：fingerprint + system_identifier 双因子跳过，失败即整体失败；
 * - Core：gateway/web/worker 三服务独立 spawn、独立 readiness，全部就绪才
 *   宣布 runtime.ready；任一服务在就绪前退出或 fatal，整体启动失败；
 * - Worker readiness 只认结构化 `worker.ready` 事件，不匹配文本。
 */

import { cleanupStaleCore } from './local-core-cleanup.mjs';
import { runMigrations, startDatabase } from './local-db.mjs';
import { renderSummaryLine } from './local-pretty.mjs';
import {
  createRunSession,
  DEFAULT_LOGS_ROOT,
  pruneRuns,
  readLatest,
  updateRunState,
} from './local-run-session.mjs';
import { launchService } from './local-service-spawn.mjs';
import { renderFailureSummary } from './local-startup-report.mjs';

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

/** worker 是否在跑：latest run.json 状态 + 服务 pid 存活。 */
export async function workerRunning() {
  const latest = await readLatest(DEFAULT_LOGS_ROOT);
  if (!latest || latest.state !== 'running') return false;
  const workerState = latest.services?.worker;
  if (!workerState || workerState.state !== 'ready') return false;
  const pid = workerState.pid;
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** 检测已运行 core：full=可复用；partial=半个 core（需清理）；none。 */
export async function detectExistingCore({ webUrl, gatewayUrl }) {
  const [gateway, web, worker] = await Promise.all([
    gatewayProbe(gatewayUrl),
    probe(webUrl),
    workerRunning(),
  ]);
  if (gateway && web && worker) return 'full';
  if (gateway || web) return 'partial';
  return 'none';
}

/** 等待单个服务就绪：事件/探测/退出/fatal 四路信号。 */
export async function waitForReady(service, probeFn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (service.failed) {
      const detail = service.fatalError?.message ?? 'fatal 事件';
      throw new Error(`${service.name} 启动失败: ${detail}`);
    }
    if (service.ready || (await probeFn())) {
      service.ready = true;
      service.readyAt ??= Date.now();
      return;
    }
    const exit = service.exitPromise
      ? await Promise.race([service.exitPromise, sleep(250).then(() => null)])
      : null;
    if (exit !== null) {
      throw new Error(
        `${service.name} 在就绪前退出（code=${exit.code ?? '-'}, signal=${exit.signal ?? '-'}）`,
      );
    }
    await sleep(250);
  }
  throw new Error(`${service.name} 在 ${timeoutMs}ms 内未就绪`);
}

function launchCoreServices({ session, verbose, colorEnabled }) {
  const env = { ...process.env, EDUCANVAS_RUN_ID: session.runId };
  const common = {
    env,
    runDirectory: session.directory,
    verbose,
    color: colorEnabled,
  };
  return {
    gateway: launchService({
      ...common,
      name: 'gateway',
      command: 'pnpm',
      args: ['--filter', '@educanvas/gateway', 'dev'],
    }),
    web: launchService({
      ...common,
      name: 'web',
      command: 'pnpm',
      args: ['--filter', '@educanvas/web', 'dev'],
    }),
    worker: launchService({
      ...common,
      name: 'worker',
      command: 'pnpm',
      args: ['--filter', '@educanvas/worker', 'dev'],
    }),
  };
}

function printStartupSummary({
  stages,
  session,
  webUrl,
  gatewayUrl,
  colorEnabled,
  out,
}) {
  out('');
  out('EduCanvas · Local Runtime');
  out('─'.repeat(56));
  out('');
  out('  STARTUP');
  out('');
  for (const stage of stages) {
    out(
      `  ${renderSummaryLine(stage.ok ? '✓' : '✗', stage.label, stage.detail, { color: colorEnabled })}`,
    );
  }
  out('');
  out(`  Web       ${webUrl}`);
  out(`  Gateway   ${gatewayUrl}`);
  out(`  Logs      ${session.directory}`);
  out('');
  out('  make logs · make status · Ctrl-C to stop');
}

function buildFailure({ stages, session, services, error }) {
  const message = error instanceof Error ? error.message : String(error);
  const failures = [];
  // 首个失败条目优先携带真实错误（readiness 退出/超时/fatal 原因）。
  if (message !== '') failures.push({ reason: message });
  if (services !== null) {
    for (const service of Object.values(services)) {
      if (!service.ready && service.fatalError) {
        failures.push({
          service: service.name,
          reason: service.fatalError.message,
          exitCode: service.exitCode,
        });
      }
    }
  }
  if (failures.length === 0) failures.push({ reason: '未知错误' });
  const recentRecords = {};
  if (services !== null) {
    for (const [name, service] of Object.entries(services)) {
      // 摘要只包含失败/未就绪的服务，不倾倒已就绪服务的无关日志。
      if (!service.ready && service.recent.length > 0) {
        recentRecords[name] = service.recent;
      }
    }
  }
  const errorText = error instanceof Error ? error.message : String(error);
  const suggestedCommands = [];
  if (/DATABASE_URL/.test(errorText))
    suggestedCommands.push('pnpm env:check .env');
  if (/端口|port|EADDRINUSE|占用/.test(errorText)) {
    suggestedCommands.push('检查并释放占用端口后重试');
  }
  if (suggestedCommands.length === 0)
    suggestedCommands.push('make status', '查看日志目录中的失败服务 jsonl');
  return {
    stages,
    failures,
    recentRecords,
    logDirectory: session.directory,
    suggestedCommands,
  };
}

/**
 * 执行完整启动流程。成功返回 { session, services, stages }；
 * 失败时渲染失败摘要并抛错（入口负责设置退出码）。
 */
export async function runStartup({
  webUrl,
  gatewayUrl,
  verbose,
  colorEnabled,
  out = (line = '') => process.stdout.write(`${line}\n`),
}) {
  const stages = [];
  stages.push({
    label: 'Environment',
    ok: true,
    detail: `Node ${process.version.replace('v', '')} · Docker ready`,
  });

  const session = await createRunSession({ webUrl, gatewayUrl });
  process.env.EDUCANVAS_RUN_ID = session.runId;
  let services = null;

  try {
    try {
      const db = await startDatabase();
      stages.push({
        label: 'Database',
        ok: true,
        detail: `PostgreSQL ready · ${db.durationMs}ms`,
      });
    } catch (error) {
      stages.push({ label: 'Database', ok: false, detail: 'failed' });
      throw error;
    }

    const migration = await runMigrations();
    if (migration.status === 'failed') {
      stages.push({ label: 'Migration', ok: false, detail: 'failed' });
      throw migration.error ?? new Error('migration failed');
    }
    stages.push({
      label: 'Migration',
      ok: true,
      detail:
        migration.status === 'skipped'
          ? 'schema unchanged · skipped'
          : `schema current · ${migration.durationMs}ms`,
    });

    const existing = await detectExistingCore({ webUrl, gatewayUrl });
    if (existing === 'partial') {
      out('[local] 检测到不完整的 core，自动清理残留进程…');
      try {
        const { killed } = await cleanupStaleCore([
          gatewayPortOf(gatewayUrl),
          webPortOf(webUrl),
        ]);
        if (killed > 0) out(`[local] 已停止 ${killed} 个残留进程`);
        // 清理后重新探测：仍残留（无关进程占端口）则明确报错，不带着
        // 端口冲突继续启动，也绝不误杀仓库外进程。
        const after = await detectExistingCore({ webUrl, gatewayUrl });
        if (after === 'partial') {
          throw new Error(
            `端口 ${gatewayPortOf(gatewayUrl)}/${webPortOf(webUrl)} 在清理后仍被占用；请手动结束占用端口的进程后重试`,
          );
        }
      } catch (error) {
        throw new Error(`残留进程清理失败：${error.message}`);
      }
    }
    if (existing === 'full') {
      await updateRunState(session.directory, { state: 'running' });
      out('[local] 复用已运行的 EduCanvas core（Web/Gateway/Worker 均已就绪）');
      stages.push({
        label: 'Gateway',
        ok: true,
        detail: `ready · ${gatewayUrl}`,
      });
      stages.push({ label: 'Web', ok: true, detail: `ready · ${webUrl}` });
      stages.push({
        label: 'Worker',
        ok: true,
        detail: 'ready · 复用现有进程',
      });
      printStartupSummary({
        stages,
        session,
        webUrl,
        gatewayUrl,
        colorEnabled,
        out,
      });
      return { session, services: null, stages };
    }

    services = launchCoreServices({ session, verbose, colorEnabled });
    await updateRunState(session.directory, {
      state: 'running',
      services: {
        gateway: { pid: services.gateway.child.pid, state: 'starting' },
        web: { pid: services.web.child.pid, state: 'starting' },
        worker: { pid: services.worker.child.pid, state: 'starting' },
      },
    });

    const readyResults = await Promise.allSettled([
      waitForReady(
        services.gateway,
        () => gatewayProbe(gatewayUrl),
        readyTimeoutMs(30_000),
      ),
      waitForReady(services.web, () => probe(webUrl), readyTimeoutMs(60_000)),
      waitForReady(
        services.worker,
        () => services.worker.ready,
        readyTimeoutMs(30_000),
      ),
    ]);
    const rejected = readyResults.find(
      (result) => result.status === 'rejected',
    );
    if (rejected) throw rejected.reason;

    const readyMs = {
      gateway: services.gateway.readyAtMs(),
      web: services.web.readyAtMs(),
      worker: services.worker.readyAtMs(),
    };
    await updateRunState(session.directory, {
      state: 'running',
      services: {
        gateway: { pid: services.gateway.child.pid, state: 'ready' },
        web: { pid: services.web.child.pid, state: 'ready' },
        worker: { pid: services.worker.child.pid, state: 'ready' },
      },
    });

    stages.push({
      label: 'Gateway',
      ok: true,
      detail: `ready · ${gatewayUrl} · ${(readyMs.gateway / 1000).toFixed(2)}s`,
    });
    stages.push({
      label: 'Web',
      ok: true,
      detail: `ready · ${webUrl} · ${(readyMs.web / 1000).toFixed(2)}s`,
    });
    stages.push({
      label: 'Worker',
      ok: true,
      detail: `ready · ${(readyMs.worker / 1000).toFixed(2)}s`,
    });
    printStartupSummary({
      stages,
      session,
      webUrl,
      gatewayUrl,
      colorEnabled,
      out,
    });

    // 保留策略：保留最近 10 次运行，永不删除当前运行；失败只记 warning。
    const { warnings } = await pruneRuns(DEFAULT_LOGS_ROOT, {
      currentRunId: session.runId,
    });
    for (const warning of warnings) out(`[local] ${warning}`);

    return { session, services, stages };
  } catch (error) {
    if (services !== null) {
      await Promise.all(
        Object.values(services).map((service) =>
          service.stopWithTimeout('SIGTERM', 5_000),
        ),
      );
      for (const service of Object.values(services)) service.close();
    }
    await updateRunState(session.directory, {
      state: 'failed',
      stoppedAt: new Date().toISOString(),
      exitReason: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    // 失败摘要走 stderr（错误路径），stdout 保持干净供管道消费。
    process.stderr.write(
      `${renderFailureSummary(
        buildFailure({ stages, session, services, error }),
        {
          colorEnabled: false,
        },
      )}\n`,
    );
    throw error;
  }
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

function gatewayPortOf(url) {
  return Number(new URL(url).port);
}

function webPortOf(url) {
  return Number(new URL(url).port);
}

/** readiness 超时可注入（测试用）：EDUCANVAS_READY_TIMEOUT_MS。 */
function readyTimeoutMs(defaultMs) {
  const raw = Number(process.env.EDUCANVAS_READY_TIMEOUT_MS);
  return Number.isInteger(raw) && raw > 0 ? raw : defaultMs;
}
