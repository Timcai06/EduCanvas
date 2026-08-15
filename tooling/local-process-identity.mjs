/**
 * OS 进程身份 — PID 存活 / 命令行读取 / EduCanvas ownership 验证 / 进程树终止。
 *
 * 安全纪律（PR #383 blocker）：run.json 记录的 PID 不是天然可信 PID——
 * 操作系统会复用 PID，旧记录可能已经指向 VS Code、MCP server 或其他无关
 * 进程。任何基于记录 PID 的 kill 都必须先验证 ownership：
 *   PID 存在 → 读取真实命令行 → 命令行证明属于当前 EduCanvas 仓库 →
 *   （如可）匹配预期服务角色 → 才允许 SIGTERM/SIGKILL。
 * 验证失败一律 fail closed：跳过并提示用户手动处理，绝不误杀无关进程。
 *
 * 跨平台：POSIX 用 `ps -p <pid> -o pid=,command=`；Windows 沿用
 * local-core-cleanup 的 `Get-CimInstance Win32_Process`。外部命令通过
 * 注入的 runCommand 执行，测试注入 fake ps 二进制。
 */
import { execFile } from 'node:child_process';
import { isEduCanvasProcess } from './local-core-cleanup.mjs';
import { DEFAULT_LOGS_ROOT, readLatest } from './local-run-session.mjs';

/** 服务角色 → 命令行特征。角色校验是 best effort：角色不符但仓库特征匹配仍视为 owned。 */
const ROLE_PATTERNS = {
  orchestrator: /local-orchestrator\.mjs/,
  gateway: /@educanvas\/gateway/,
  web: /@educanvas\/web/,
  worker: /@educanvas\/worker/,
};

const defaultRunCommand = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 10_000 }, (error, stdout, stderr) => {
      resolve({
        code: error?.code ?? 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });

/** PID 是否存活（EPERM = 存在但无权限，视为存活）。 */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** 读取 PID 的真实命令行；读取失败返回 null（fail closed 输入）。 */
export async function readProcessCommandLine(
  pid,
  { runCommand = defaultRunCommand } = {},
) {
  if (process.platform === 'win32') {
    const powershell = await runCommand('powershell', [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`,
    ]);
    if (powershell.code !== 0 || powershell.stdout.trim() === '') return null;
    try {
      const row = JSON.parse(powershell.stdout);
      const first = Array.isArray(row) ? row[0] : row;
      return first?.CommandLine ? String(first.CommandLine) : null;
    } catch {
      return null;
    }
  }
  const ps = await runCommand('ps', ['-p', String(pid), '-o', 'pid=,command=']);
  if (ps.code !== 0) return null;
  const match = ps.stdout.match(/^\s*\d+\s+(.*)$/m);
  return match ? match[1] : null;
}

/**
 * 验证一个 PID 是否属于当前 EduCanvas runtime。返回：
 * - { verdict: 'gone' }：进程已不存在；
 * - { verdict: 'unknown' }：无法读取命令行（fail closed）；
 * - { verdict: 'unowned', commandLine }：进程存活但命令行不含 EduCanvas 特征
 *   （PID 复用/无关程序）；
 * - { verdict: 'owned', commandLine, roleMatched }：命令行证明属于本仓库；
 *   roleMatched = expectedRole 提供时命令行是否匹配预期服务角色（best effort）。
 */
export async function verifyOwnedProcess({
  pid,
  expectedRole,
  runCommand,
} = {}) {
  if (!pidAlive(pid)) return { verdict: 'gone' };
  const commandLine = await readProcessCommandLine(pid, { runCommand });
  if (commandLine === null || commandLine === '') return { verdict: 'unknown' };
  if (!isEduCanvasProcess(commandLine))
    return { verdict: 'unowned', commandLine };
  // 角色识别是增强信号：expectedRole 提供时确认命令行包含该角色特征。
  // 角色不匹配不改变放行结论——仓库特征已证明进程属于本项目，dev 工具链
  // （pnpm/tsx/next 包装）命令行形态多变，识别失败不能误判为无关进程。
  return {
    verdict: 'owned',
    commandLine,
    roleMatched: commandLineMatchesRole(commandLine, expectedRole),
  };
}

/** 命令行是否匹配预期服务角色（识别用，不参与放行/拒绝判定）。 */
export function commandLineMatchesRole(commandLine, role) {
  const pattern = ROLE_PATTERNS[role];
  return pattern === undefined || pattern.test(commandLine);
}

/** 按进程树终止 PID：POSIX 组杀（pnpm→tsx/next 全树）；Windows taskkill /T。 */
export async function killOwnedProcessTree(
  pid,
  signal,
  { runCommand = defaultRunCommand } = {},
) {
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      runCommand('taskkill', ['/F', '/T', '/PID', String(pid)]).then(() =>
        resolve(),
      );
    });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // 已退出（竞态）。
    }
  }
}

/**
 * 对 run.json 记录的全部 PID 做 ownership 验证，返回可安全终止与必须跳过
 * 的列表。跳过原因：gone（已消失）/ unowned（无关进程，PID 复用）/
 * unknown（无法读取命令行，fail closed）。
 */
export async function verifyRecordedProcesses(
  meta,
  { runCommand = defaultRunCommand } = {},
) {
  const records = [];
  if (typeof meta?.orchestratorPid === 'number' && meta.orchestratorPid > 0) {
    records.push({ pid: meta.orchestratorPid, role: 'orchestrator' });
  }
  for (const [role, service] of Object.entries(meta?.services ?? {})) {
    if (typeof service?.pid === 'number' && service.pid > 0) {
      records.push({ pid: service.pid, role });
    }
  }
  const owned = [];
  const skipped = [];
  for (const record of records) {
    const result = await verifyOwnedProcess({
      pid: record.pid,
      expectedRole: record.role,
      runCommand,
    });
    if (result.verdict === 'owned') {
      owned.push({ ...record, roleMatched: result.roleMatched });
    } else {
      skipped.push({ ...record, reason: result.verdict });
    }
  }
  return { owned, skipped };
}

/** worker 是否在跑：latest run.json 状态 + 服务 pid 存活（仅探测，不杀进程）。 */
export async function workerRunning() {
  const latest = await readLatest(DEFAULT_LOGS_ROOT);
  if (!latest || latest.state !== 'running') return false;
  const workerState = latest.services?.worker;
  if (!workerState || workerState.state !== 'ready') return false;
  const pid = workerState.pid;
  if (typeof pid !== 'number' || pid <= 0) return false;
  return pidAlive(pid);
}
