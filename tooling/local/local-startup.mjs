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

import {
  cleanupStaleRuntime,
  gatewayPortOf,
  webPortOf,
} from './local-core-cleanup.mjs';
import { runMigrations, startDatabase } from './local-db.mjs';
import { gatewayProbe, probe, webRuntimeProbe } from './local-health-probe.mjs';
import {
  killOwnedProcessTree,
  pidAlive,
  verifyRecordedProcesses,
  workerRunning,
} from './local-process-identity.mjs';
import {
  buildFailure,
  printStartupSummary,
  renderFailureSummary,
} from './local-startup-report.mjs';
import {
  createRunSession,
  DEFAULT_LOGS_ROOT,
  pruneRuns,
  readLatest,
  readRunMeta,
  runDirectoryFor,
  updateRunState,
} from './local-run-session.mjs';
import { launchService } from './local-service-spawn.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 检测已运行 core：full=可复用；partial=半个 core（含「只有 worker 存活」的
 * 情况——单 latest.json 指针无法承载两个并发 core，任何组件存活都算残留，
 * 需清理）；none。
 */
export async function detectExistingCore({
  webUrl,
  gatewayUrl,
  runtimeHealthUrl,
}) {
  const [gateway, web, worker, runtime] = await Promise.all([
    gatewayProbe(gatewayUrl),
    probe(webUrl),
    workerRunning(),
    runtimeHealthUrl ? webRuntimeProbe(runtimeHealthUrl) : false,
  ]);
  if (gateway && web && worker && runtime) return 'full';
  if (gateway || web || worker || runtime) return 'partial';
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
    /* web_app 产物在 sandbox iframe 里由这个独立进程托管。此前它不在 core 里，
       开发态打开 web_app 产物必然「启动失败」（#489）。它与 Web 必须跨站，
       站点对由 applyResolvedLocalPorts 统一决定。 */
    runtime: launchService({
      ...common,
      name: 'runtime',
      command: 'pnpm',
      args: ['--filter', '@educanvas/web-runtime', 'dev'],
    }),
  };
}

/**
 * 执行完整启动流程。成功返回 { session, services, stages }；
 * 失败时渲染失败摘要并抛错（入口负责设置退出码）。
 */
export async function runStartup({
  webUrl,
  gatewayUrl,
  runtimeHealthUrl,
  runtimeOrigin,
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
  let session = null;
  let services = null;

  try {
    try {
      const db = await startDatabase();
      stages.push({
        label: 'Database',
        ok: true,
        detail: 'PostgreSQL',
        durationMs: db.durationMs,
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
        migration.status === 'skipped' ? 'schema unchanged' : 'schema current',
      durationMs: migration.durationMs,
    });

    // 关键顺序：先基于「旧的 latest.json」探测已运行 core，再决定是否新建
    // 会话。若先 createRunSession 覆盖 latest.json，worker 探测就永远读不到
    // 旧会话的 worker 信息，第二次 make all 会被误判为 partial 并误清残留。
    const existing = await detectExistingCore({
      webUrl,
      gatewayUrl,
      runtimeHealthUrl,
    });
    if (existing === 'full') {
      // 复用旧会话：不新建 run directory，不覆盖 latest.json，runId 不变。
      const latest = await readLatest(DEFAULT_LOGS_ROOT);
      const directory = latest?.runId
        ? runDirectoryFor(DEFAULT_LOGS_ROOT, latest.runId)
        : null;
      if (!latest || !directory) {
        throw new Error('复用检测失败：latest.json 缺失或损坏');
      }
      session = {
        runId: latest.runId,
        directory,
        meta: (await readRunMeta(directory)) ?? latest,
      };
      process.env.EDUCANVAS_RUN_ID = session.runId;
      out(
        '[local] 复用已运行的 EduCanvas core（Web/Gateway/Worker/Runtime 均已就绪）',
      );
      stages.push({
        label: 'Gateway',
        ok: true,
        detail: gatewayUrl,
      });
      stages.push({ label: 'Web', ok: true, detail: webUrl });
      stages.push({
        label: 'Worker',
        ok: true,
        detail: 'ready · 复用现有进程',
      });
      stages.push({
        label: 'Runtime',
        ok: true,
        detail: runtimeOrigin ?? 'ready · 复用现有进程',
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
    if (existing === 'partial') {
      out('[local] 检测到不完整的 core，自动清理残留进程…');
      try {
        const { killed } = await cleanupStaleRuntime({
          webUrl,
          gatewayUrl,
          out,
        });
        if (killed > 0) out(`[local] 已停止 ${killed} 个残留进程`);
        // 清理后重新探测：仍残留（无关进程占端口或旧 Worker 未死）则明确
        // 报错，不带着端口冲突继续启动，也绝不误杀仓库外进程。
        const after = await detectExistingCore({
          webUrl,
          gatewayUrl,
          runtimeHealthUrl,
        });
        if (after === 'partial') {
          throw new Error(
            `端口 ${gatewayPortOf(gatewayUrl)}/${webPortOf(webUrl)} 在清理后仍被占用（或旧 Worker 仍存在）；请手动结束后重试`,
          );
        }
      } catch (error) {
        throw new Error(`残留进程清理失败：${error.message}`);
      }
    }
    // none（或清理后）：此时才创建新会话，latest.json 才会被覆盖。
    session = await createRunSession({ webUrl, gatewayUrl });
    process.env.EDUCANVAS_RUN_ID = session.runId;

    services = launchCoreServices({ session, verbose, colorEnabled });
    await updateRunState(session.directory, {
      state: 'running',
      services: {
        gateway: { pid: services.gateway.child.pid, state: 'starting' },
        web: { pid: services.web.child.pid, state: 'starting' },
        worker: { pid: services.worker.child.pid, state: 'starting' },
        runtime: { pid: services.runtime.child.pid, state: 'starting' },
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
      waitForReady(
        services.runtime,
        () => webRuntimeProbe(runtimeHealthUrl),
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
      runtime: services.runtime.readyAtMs(),
    };
    await updateRunState(session.directory, {
      state: 'running',
      services: {
        gateway: { pid: services.gateway.child.pid, state: 'ready' },
        web: { pid: services.web.child.pid, state: 'ready' },
        worker: { pid: services.worker.child.pid, state: 'ready' },
        runtime: { pid: services.runtime.child.pid, state: 'ready' },
      },
    });

    stages.push({
      label: 'Gateway',
      ok: true,
      detail: gatewayUrl,
      durationMs: readyMs.gateway,
    });
    stages.push({
      label: 'Web',
      ok: true,
      detail: webUrl,
      durationMs: readyMs.web,
    });
    stages.push({
      label: 'Worker',
      ok: true,
      detail: 'ready',
      durationMs: readyMs.worker,
    });
    stages.push({
      label: 'Runtime',
      ok: true,
      detail: runtimeOrigin ?? 'ready',
      durationMs: readyMs.runtime,
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
    // session 可能在 createRunSession 之前就失败（数据库/迁移/清理），
    // 此时没有 run directory 可写，直接走失败摘要。
    if (session !== null) {
      await updateRunState(session.directory, {
        state: 'failed',
        stoppedAt: new Date().toISOString(),
        exitReason: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    }
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

/** readiness 超时可注入（测试用）：EDUCANVAS_READY_TIMEOUT_MS。 */
function readyTimeoutMs(defaultMs) {
  const raw = Number(process.env.EDUCANVAS_READY_TIMEOUT_MS);
  return Number.isInteger(raw) && raw > 0 ? raw : defaultMs;
}
