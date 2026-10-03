import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { spawnE2eWorker } from './e2e-worker-process.mjs';

async function fixture(t, onTerminate) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'educanvas-e2e-worker-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const entrypoint = path.join(cwd, 'worker.mjs');
  await writeFile(
    entrypoint,
    `setInterval(() => {}, 1000);
process.on('SIGTERM', () => { ${onTerminate} });
console.log(JSON.stringify({ pid: process.pid }));`,
  );
  await writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify({ private: true, scripts: { start: 'node worker.mjs' } }),
  );
  const handle = spawnE2eWorker({ entrypoint, cwd, environment: process.env });
  const lines = createInterface({ input: handle.child.stdout });
  let timeout;
  let pid;
  t.after(async () => {
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    await handle.stop(100);
    lines.close();
  });
  try {
    while (!pid) {
      const [line] = await Promise.race([
        once(lines, 'line'),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('fixture readiness timeout')),
            5000,
          );
        }),
      ]);
      clearTimeout(timeout);
      if (line.startsWith('{')) pid = JSON.parse(line).pid;
    }
  } finally {
    clearTimeout(timeout);
  }
  return { ...handle, pid };
}

test('forced teardown terminates the actual queue consumer and closes its audit stream', async (t) => {
  // A retained database pool or stuck task can keep the consumer alive after SIGTERM.
  const handle = await fixture(t, '');
  let stdoutClosed = false;
  handle.child.stdout.once('close', () => {
    stdoutClosed = true;
  });
  await handle.stop(100);
  assert.throws(() => process.kill(handle.pid, 0), { code: 'ESRCH' });
  assert.equal(stdoutClosed, true);
});

test('graceful teardown drains the final worker audit before returning and is repeatable', async (t) => {
  const handle = await fixture(
    t,
    `console.log('final-audit-record'); process.exit(0);`,
  );
  let output = '';
  handle.child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  await handle.stop(5000);
  assert.equal(handle.child.exitCode, 0);
  assert.match(output, /final-audit-record/);
  await handle.stop(100);
});

test('teardown remains bounded after startup has already failed', async (t) => {
  const cwd = await mkdtemp(
    path.join(tmpdir(), 'educanvas-e2e-worker-missing-'),
  );
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const handle = spawnE2eWorker({
    entrypoint: path.join(cwd, 'missing.mjs'),
    cwd,
    environment: process.env,
  });
  handle.child.stderr.resume();
  handle.child.stdout.resume();
  await once(handle.child, 'close');
  await handle.stop(100);
  assert.notEqual(handle.child.exitCode, 0);
});
