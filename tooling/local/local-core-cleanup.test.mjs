import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import {
  cleanupStaleCore,
  findStaleCoreProcesses,
  isEduCanvasProcess,
  parseWindowsNetstatListeners,
} from './local-core-cleanup.mjs';

/* ---------- 单元：netstat 输出解析 ---------- */

test('parses windows netstat listeners with IPv4 and IPv6 local addresses', () => {
  const output = [
    '  TCP    127.0.0.1:3200    0.0.0.0:0    LISTENING    12345',
    '  TCP    [::1]:3000        [::]:0        LISTENING    45678',
    '  TCP    0.0.0.0:3200      0.0.0.0:0     LISTENING    12345',
    '  TCP    127.0.0.1:5432    0.0.0.0:0     LISTENING    99999',
    '  TCP    127.0.0.1:3200    127.0.0.1:1   ESTABLISHED  12345',
    '  UDP    127.0.0.1:3200    0.0.0.0:0     LISTENING    11111',
    '',
  ].join('\r\n');
  const listeners = parseWindowsNetstatListeners(output);
  assert.deepEqual(
    [...listeners.get(3200)],
    [12345], // UDP 行与 ESTABLISHED 行都不算监听者
  );
  assert.deepEqual([...listeners.get(3000)], [45678]);
  assert.deepEqual([...listeners.get(5432)], [99999]);
});

/* ---------- 单元：命令行校验 ---------- */

test('accepts process command lines that reference the EduCanvas repo', () => {
  assert.equal(
    isEduCanvasProcess(
      '"D:\\node.exe" D:\\Projects\\EduCanvas\\apps\\web\\node_modules\\next\\dist\\bin\\next dev',
    ),
    true,
  );
  assert.equal(
    isEduCanvasProcess(
      'node /home/runner/work/EduCanvas/EduCanvas/apps/gateway/...',
    ),
    true,
  );
  assert.equal(
    isEduCanvasProcess('node /home/user/edu-canvas/worker/...'),
    true,
  );
});

test('rejects unrelated node processes and empty command lines', () => {
  assert.equal(
    isEduCanvasProcess(
      'node -e "require(\'http\').createServer().listen(3000)"',
    ),
    false,
  );
  assert.equal(isEduCanvasProcess('"D:\\node.exe" --version'), false);
  assert.equal(isEduCanvasProcess(''), false);
  assert.equal(isEduCanvasProcess(undefined), false);
  assert.equal(isEduCanvasProcess(null), false);
});

/* ---------- 集成：真实进程清理（平台真实命令） ---------- */

function listenOnce(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve());
    });
  });
}

function spawnFixture(port, mode) {
  // 绝对路径：node 会把脚本路径原样写进进程命令行，cleanup 按
  // 「命令行含仓库特征」判断可清理性，相对路径会漏掉特征。
  const script = path.resolve('tooling/local/local-core-cleanup.fixture.mjs');
  const child = spawn(
    process.execPath,
    [script, String(port), ...(mode ? [mode] : [])],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes(`listening on ${port}`)) resolve();
    });
    // fixture 提前退出（例如路径错误）时快速失败，而不是让 await 挂死。
    child.once('exit', (code) =>
      reject(new Error(`fixture exited early with code ${code}`)),
    );
  });
  return { child, exited, ready };
}

/**
 * 注入式 fake runCommand：不依赖系统 lsof/ps（CI 沙箱可能禁止 spawn ps），
 * 端口→pid 映射与 pid→命令行由测试显式提供；kill 走真实 process.kill。
 * pid 已死则视为端口释放（killStaleCoreProcesses 轮询依赖此语义）。
 */
function makeFakeRunCommand({ portToPid, pidToCommandLine }) {
  return async (command, args) => {
    const joined = `${command} ${args.join(' ')}`;
    if (joined.startsWith('lsof')) {
      const match = joined.match(/-i\s+:(\d+)/);
      const pid = match ? portToPid[Number(match[1])] : undefined;
      if (pid === undefined) return { code: 1, stdout: '', stderr: '' };
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      return alive
        ? { code: 0, stdout: `${pid}\n`, stderr: '' }
        : { code: 1, stdout: '', stderr: '' };
    }
    if (joined.startsWith('ps')) {
      const match = joined.match(/-p\s+([\d,]+)/);
      const pids = match ? match[1].split(',') : [];
      const stdout = pids
        .filter((pid) => pidToCommandLine[Number(pid)] !== undefined)
        .map((pid) => `${pid} ${pidToCommandLine[Number(pid)]}`)
        .join('\n');
      return { code: 0, stdout, stderr: '' };
    }
    if (joined.startsWith('kill')) {
      const pid = Number(args[args.length - 1]);
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // 已退出。
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unsupported' };
  };
}

async function waitForExit(exited, timeoutMs = 10_000) {
  const result = await Promise.race([
    exited.then(() => 'exited'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
  ]);
  assert.equal(result, 'exited');
}

test('cleans up a stale EduCanvas process holding a core port', async () => {
  const port = 61_931;
  const { child, exited, ready } = spawnFixture(port);
  await ready;

  const runCommand = makeFakeRunCommand({
    portToPid: { [port]: child.pid },
    pidToCommandLine: {
      [child.pid]: `node ${process.cwd()}/tooling/local/local-core-cleanup.fixture.mjs`,
    },
  });
  const result = await cleanupStaleCore([port], { runCommand });
  assert.equal(result.killed, 1);

  await waitForExit(exited);
  // 端口确实已释放，可重新绑定。
  await listenOnce(port);
});

test('never kills a process whose command line lacks the EduCanvas marker', async () => {
  const port = 61_932;
  // node -e 内联脚本：命令行不含仓库路径特征。
  const child = spawn(
    process.execPath,
    [
      '-e',
      `require('http').createServer().listen(${port}, '127.0.0.1', () => console.log('ready'))`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await new Promise((resolve, reject) =>
    child.stdout
      .on('data', (chunk) => {
        if (String(chunk).includes('ready')) resolve();
      })
      .once('exit', () => reject(new Error('foreign server exited early'))),
  );

  const runCommand = makeFakeRunCommand({
    portToPid: { [port]: child.pid },
    // 命令行不含 EduCanvas 特征 → isEduCanvasProcess 拒绝。
    pidToCommandLine: { [child.pid]: 'node -e inline http server' },
  });
  try {
    const result = await cleanupStaleCore([port], { runCommand });
    assert.equal(result.killed, 0);
    assert.equal(child.exitCode, null); // 进程仍然存活
  } finally {
    child.kill();
    await exited;
  }
});

test('findStaleCoreProcesses reports empty when no port is in use', async () => {
  const runCommand = makeFakeRunCommand({
    portToPid: {},
    pidToCommandLine: {},
  });
  const processes = await findStaleCoreProcesses([61_933], { runCommand });
  assert.deepEqual(processes, []);
});
