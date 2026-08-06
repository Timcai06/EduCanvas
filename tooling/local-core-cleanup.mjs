/**
 * 半个 core 残留进程清理（Windows / macOS / Linux）。
 *
 * 触发场景：EduCanvas 的 dev core 中途挂掉一部分（例如 web 编译报错但
 * gateway 还活着），local-orchestrator 无法复用也无法启动新 core。
 *
 * 清理纪律（与 cyk 早期 `taskkill /F /IM node.exe` 粗暴方案的差异）：
 *
 * - 只杀「正在监听 EduCanvas 本地端口」的进程——按端口定位，不按镜像名
 *   一刀切，绝不误伤用户机器上的其他 node 进程（MCP server、其他项目
 *   dev server 等）；
 * - 杀之前校验进程命令行包含仓库路径特征（EduCanvas 大小写不敏感）——
 *   同一端口也可能是完全无关的程序在监听；
 * - 杀完轮询等待端口释放，确认干净后才把控制权交还给 orchestrator。
 *
 * 所有外部命令通过注入的 runCommand 执行，便于测试注入假输出。
 */
import { execFile } from 'node:child_process';

const REPO_PATTERN = /edu[-_ ]?canvas/i;

/**
 * 解析 Windows `netstat -ano` 输出，返回 端口 → 监听 PID 集合。
 * 行格式：`TCP    127.0.0.1:3200    0.0.0.0:0    LISTENING    12345`
 * IPv6 本地地址为 `[::1]:3200`；只关心 TCP + LISTENING。
 */
export function parseWindowsNetstatListeners(netstatOutput) {
  const listeners = new Map();
  for (const line of netstatOutput.split(/\r?\n/)) {
    // 行首带空格（netstat 实际输出如此）；本地地址段用懒惰量词：
    // 贪婪版会把 `127.0.0.1:3200` 回溯成 `127.0.0.1:320` + `:0`，
    // 捕获到错误的端口。
    const match = line.match(
      /^\s*TCP\s+\S+?:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i,
    );
    if (!match) continue;
    const port = Number(match[1]);
    const pid = Number(match[2]);
    const existing = listeners.get(port) ?? new Set();
    existing.add(pid);
    listeners.set(port, existing);
  }
  return listeners;
}

/** 命令行是否属于 EduCanvas 仓库的进程。 */
export function isEduCanvasProcess(commandLine) {
  return typeof commandLine === 'string' && REPO_PATTERN.test(commandLine);
}

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

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 找出监听给定端口的可疑残留进程。
 *
 * 返回 `{ port, pid, commandLine }[]`——只包含命令行通过仓库特征校验的
 * 进程；同端口多进程（IPv4/IPv6 双栈）会各自列出。
 */
export async function findStaleCoreProcesses(
  ports,
  { runCommand = defaultRunCommand } = {},
) {
  const candidates = new Map(); // pid → { port, commandLine }
  if (process.platform === 'win32') {
    const netstat = await runCommand('netstat', ['-ano']);
    if (netstat.code !== 0) return [];
    const listeners = parseWindowsNetstatListeners(netstat.stdout);
    for (const [port, pids] of listeners) {
      if (!ports.includes(port)) continue;
      for (const pid of pids)
        candidates.set(pid, { port, pid, commandLine: '' });
    }
    if (candidates.size === 0) return [];
    // 一次 PowerShell 调用批量读取所有候选 PID 的命令行。
    const filter = [...candidates.keys()]
      .map((pid) => `ProcessId=${pid}`)
      .join(' OR ');
    const powershell = await runCommand('powershell', [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`,
    ]);
    if (powershell.code === 0 && powershell.stdout.trim() !== '') {
      try {
        const rows = JSON.parse(powershell.stdout);
        for (const row of Array.isArray(rows) ? rows : [rows]) {
          const candidate = candidates.get(Number(row.ProcessId));
          if (candidate) candidate.commandLine = String(row.CommandLine ?? '');
        }
      } catch {
        // PowerShell 输出无法解析时保留空命令行，由校验统一拒绝。
      }
    }
  } else {
    for (const port of ports) {
      const lsof = await runCommand('lsof', ['-t', '-i', `:${port}`]);
      if (lsof.code !== 0 || lsof.stdout.trim() === '') continue;
      for (const pid of lsof.stdout.trim().split(/\s+/)) {
        candidates.set(Number(pid), {
          port,
          pid: Number(pid),
          commandLine: '',
        });
      }
    }
    if (candidates.size === 0) return [];
    const ps = await runCommand('ps', [
      '-p',
      [...candidates.keys()].join(','),
      '-o',
      'pid=,command=',
    ]);
    if (ps.code === 0) {
      for (const line of ps.stdout.split(/\r?\n/)) {
        const match = line.match(/^\s*(\d+)\s+(.*)$/);
        if (!match) continue;
        const candidate = candidates.get(Number(match[1]));
        if (candidate) candidate.commandLine = match[2];
      }
    }
  }
  return [...candidates.values()].filter((candidate) =>
    isEduCanvasProcess(candidate.commandLine),
  );
}

/**
 * 强杀给定进程列表并轮询等待端口释放。
 *
 * 返回实际杀掉的进程数；端口在超时后仍被占用时返回 null（调用方应
 * 回退到手动清理提示）。
 */
export async function killStaleCoreProcesses(
  processes,
  { runCommand = defaultRunCommand, sleep = defaultSleep, waitMs = 5_000 } = {},
) {
  if (processes.length === 0) return 0;
  const kill = (pid) =>
    process.platform === 'win32'
      ? runCommand('taskkill', ['/F', '/PID', String(pid)])
      : runCommand('kill', ['-9', String(pid)]);
  await Promise.all(processes.map((process) => kill(process.pid)));

  // 轮询直到所有涉及的端口都没有残留监听者。端口可能被旧进程的
  // 子进程重新绑定，因此检查端口而非进程列表。
  const ports = [...new Set(processes.map((process) => process.port))];
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const remaining = await findStaleCoreProcesses(ports, { runCommand });
    if (remaining.length === 0) return processes.length;
    await sleep(250);
  }
  return null;
}

/**
 * 组合入口：找到并清理监听指定端口的 EduCanvas 残留进程。
 *
 * 返回 `{ killed: number }`；没有可清理进程或全部清理成功都视为成功，
 * 端口超时仍被占用才抛错（调用方回退到手动清理提示）。
 */
export async function cleanupStaleCore(
  ports,
  { runCommand = defaultRunCommand, sleep = defaultSleep } = {},
) {
  const processes = await findStaleCoreProcesses(ports, { runCommand });
  if (processes.length === 0) return { killed: 0 };
  const killed = await killStaleCoreProcesses(processes, { runCommand, sleep });
  if (killed === null) {
    throw new Error(
      `端口 ${ports.join('/')} 在清理后仍被占用；请手动结束对应进程`,
    );
  }
  return { killed };
}
