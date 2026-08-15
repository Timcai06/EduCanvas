/**
 * local-process-identity 单元测试：PID 存活 / 命令行读取 / ownership 验证 /
 * 角色识别 / run.json 记录分拣。全部外部命令通过注入 fake runCommand，
 * 不触碰真实 ps/powershell。
 *
 * 注意：Windows PowerShell 分支依赖 process.platform === 'win32'，本机
 * （darwin）无法直达；该分支由 Windows CI 的 `pnpm test:tooling` 覆盖
 * （与 local-core-cleanup 的 netstat 分支同一策略）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commandLineMatchesRole,
  pidAlive,
  readProcessCommandLine,
  verifyOwnedProcess,
  verifyRecordedProcesses,
} from './local-process-identity.mjs';

/** 永不存活的 PID（kill 0 必然 ESRCH）。 */
const DEAD_PID = 2_147_483_647;

/**
 * 注入式 ps/powershell fake：按 pid → 命令行映射应答，未知 pid 返回
 * code 1（模拟 ps 找不到进程）。
 */
function fakeRunCommand(cmdlineByPid) {
  return async (command, args) => {
    if (command === 'ps') {
      const match = args.join(' ').match(/-p\s+(\d+)/);
      const pid = match?.[1];
      const cmdline = pid ? cmdlineByPid[pid] : undefined;
      return cmdline === undefined
        ? { code: 1, stdout: '', stderr: '' }
        : { code: 0, stdout: `${pid} ${cmdline}\n`, stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unexpected command' };
  };
}

test('pidAlive：本进程存活，不可达 PID 视为已死', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(DEAD_PID), false);
});

test('readProcessCommandLine：POSIX ps 输出解析为命令行', async () => {
  const runCommand = fakeRunCommand({
    [process.pid]: '/usr/bin/node /repo/tooling/local-orchestrator.mjs all',
  });
  const commandLine = await readProcessCommandLine(process.pid, { runCommand });
  assert.equal(
    commandLine,
    '/usr/bin/node /repo/tooling/local-orchestrator.mjs all',
  );
});

test('readProcessCommandLine：ps 失败（进程消失）返回 null', async () => {
  const commandLine = await readProcessCommandLine(DEAD_PID, {
    runCommand: fakeRunCommand({}),
  });
  assert.equal(commandLine, null);
});

test('readProcessCommandLine：空输出返回 null', async () => {
  const runCommand = async () => ({ code: 0, stdout: '', stderr: '' });
  const commandLine = await readProcessCommandLine(process.pid, { runCommand });
  assert.equal(commandLine, null);
});

test('verifyOwnedProcess：进程已消失 → gone', async () => {
  const result = await verifyOwnedProcess({
    pid: DEAD_PID,
    runCommand: fakeRunCommand({}),
  });
  assert.equal(result.verdict, 'gone');
});

test('verifyOwnedProcess：命令行不可读 → unknown（fail closed）', async () => {
  const result = await verifyOwnedProcess({
    pid: process.pid,
    runCommand: fakeRunCommand({}),
  });
  assert.equal(result.verdict, 'unknown');
});

test('verifyOwnedProcess：命令行不含 EduCanvas 特征 → unowned（PID 复用）', async () => {
  const result = await verifyOwnedProcess({
    pid: process.pid,
    runCommand: fakeRunCommand({
      [process.pid]: 'node -e inline http server',
    }),
  });
  assert.equal(result.verdict, 'unowned');
  assert.equal(result.commandLine, 'node -e inline http server');
});

test('verifyOwnedProcess：EduCanvas 命令行 + 角色匹配 → owned', async () => {
  const result = await verifyOwnedProcess({
    pid: process.pid,
    expectedRole: 'orchestrator',
    runCommand: fakeRunCommand({
      [process.pid]: 'node /repo/EduCanvas/tooling/local-orchestrator.mjs all',
    }),
  });
  assert.equal(result.verdict, 'owned');
  assert.equal(result.roleMatched, true);
});

test('verifyOwnedProcess：角色不匹配不降级，仍为 owned', async () => {
  const result = await verifyOwnedProcess({
    pid: process.pid,
    expectedRole: 'gateway',
    runCommand: fakeRunCommand({
      [process.pid]: 'node /repo/EduCanvas/tooling/local-orchestrator.mjs all',
    }),
  });
  assert.equal(result.verdict, 'owned');
  assert.equal(result.roleMatched, false);
});

test('commandLineMatchesRole：角色特征识别', () => {
  assert.equal(
    commandLineMatchesRole(
      'node /repo/EduCanvas/tooling/local-orchestrator.mjs all',
      'orchestrator',
    ),
    true,
  );
  assert.equal(
    commandLineMatchesRole('pnpm --filter @educanvas/gateway dev', 'gateway'),
    true,
  );
  assert.equal(
    commandLineMatchesRole('pnpm --filter @educanvas/web dev', 'web'),
    true,
  );
  assert.equal(
    commandLineMatchesRole('pnpm --filter @educanvas/worker dev', 'worker'),
    true,
  );
  // 未知角色 = 不约束（true）。
  assert.equal(commandLineMatchesRole('anything', 'unknown-role'), true);
});

test('verifyRecordedProcesses：owned/skipped 分拣与原因标注', async () => {
  const meta = {
    orchestratorPid: process.pid, // owned（orchestrator 命令行）
    services: {
      worker: { pid: DEAD_PID, state: 'ready' }, // gone → skipped
      gateway: { pid: process.pid, state: 'ready' }, // owned（unowned? 见下）
    },
  };
  const { owned, skipped } = await verifyRecordedProcesses(meta, {
    runCommand: fakeRunCommand({
      [process.pid]: 'node /repo/EduCanvas/tooling/local-orchestrator.mjs',
    }),
  });
  assert.equal(owned.length, 2);
  assert.equal(owned[0].role, 'orchestrator');
  assert.equal(owned[0].roleMatched, true);
  assert.equal(owned[1].role, 'gateway');
  assert.equal(owned[1].roleMatched, false);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].role, 'worker');
  assert.equal(skipped[0].reason, 'gone');
});

test('verifyRecordedProcesses：非法记录（pid 缺失/非正数）被忽略', async () => {
  const meta = {
    orchestratorPid: 0, // 不合法 → 忽略
    services: {
      worker: { state: 'ready' }, // 无 pid → 忽略
      web: { pid: -1, state: 'ready' }, // 负数 → 忽略
    },
  };
  const { owned, skipped } = await verifyRecordedProcesses(meta, {
    runCommand: fakeRunCommand({}),
  });
  assert.deepEqual(owned, []);
  assert.deepEqual(skipped, []);
});
