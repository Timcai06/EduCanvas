import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const SCRIPT = path.resolve('tooling/local-mineru.mjs');

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'educanvas-mineru-'));
  const environment = path.join(root, 'env');
  const bin = path.join(environment, 'bin');
  await mkdir(bin, { recursive: true });
  const apiBin = path.join(bin, 'mineru-api');
  await writeFile(apiBin, '#!/bin/sh\nwhile true; do sleep 1; done\n', {
    mode: 0o755,
  });
  return {
    root,
    apiBin,
    env: {
      ...process.env,
      MINERU_ENV: environment,
      MINERU_STATE_FILE: path.join(root, 'state.json'),
      MINERU_LOG: path.join(root, 'mineru.log'),
      MINERU_PORT: '65530',
      MINERU_START_TIMEOUT_MS: '1000',
    },
  };
}

function run(command, env) {
  return spawnSync(process.execPath, [SCRIPT, command], {
    env,
    encoding: 'utf8',
    timeout: 5_000,
  });
}

test('stop without repository state never scans or kills a foreign mineru process', async () => {
  const value = await fixture();
  const foreign = spawn(
    value.apiBin,
    ['--host', '127.0.0.1', '--port', '65530'],
    {
      detached: true,
      stdio: 'ignore',
    },
  );
  foreign.unref();
  try {
    const result = run('stop', value.env);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /未停止任何进程/u);
    assert.doesNotThrow(() => process.kill(foreign.pid, 0));
  } finally {
    try {
      process.kill(-foreign.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    await rm(value.root, { recursive: true, force: true });
  }
});

test('stop refuses a recorded PID whose command line does not match the configured executable', async () => {
  const value = await fixture();
  const foreign = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    {
      detached: true,
      stdio: 'ignore',
    },
  );
  foreign.unref();
  try {
    await writeFile(
      value.env.MINERU_STATE_FILE,
      JSON.stringify({
        schema: 'educanvas.local-mineru.v1',
        pid: foreign.pid,
        apiBin: value.apiBin,
        host: '127.0.0.1',
        port: '65530',
        startedAt: new Date().toISOString(),
      }),
    );
    const result = run('stop', value.env);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /无法确认仍属于/u);
    assert.doesNotThrow(() => process.kill(foreign.pid, 0));
    assert.match(await readFile(value.env.MINERU_STATE_FILE, 'utf8'), /pid/u);
  } finally {
    try {
      process.kill(-foreign.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    await rm(value.root, { recursive: true, force: true });
  }
});

test('non-loopback binding fails closed unless explicitly allowed', async () => {
  const value = await fixture();
  try {
    const result = run('status', { ...value.env, MINERU_HOST: '0.0.0.0' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /MINERU_ALLOW_REMOTE=1/u);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
