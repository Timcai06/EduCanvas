import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { applyResolvedLocalPorts } from './local-orchestrator-config.mjs';

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['tooling/local-orchestrator.mjs', ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

test('rejects an unknown profile', async () => {
  const result = await run(['unknown']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /all\|web\|tui\|status/);
});

test('status reports stopped services without starting processes', async () => {
  const result = await run(['status'], {
    PORT: '61991',
    EDUCANVAS_GATEWAY_PORT: '61992',
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Gateway\s+stopped/);
  assert.match(result.stdout, /Web\s+stopped/);
});

test('propagates resolved default ports to spawned core services', () => {
  const env = {};
  assert.deepEqual(applyResolvedLocalPorts(env), {
    port: 3101,
    gatewayPort: 3200,
  });
  assert.equal(env.PORT, '3101');
  assert.equal(env.EDUCANVAS_GATEWAY_PORT, '3200');
});

test('preserves validated custom ports for spawned core services', () => {
  const env = { PORT: '4101', EDUCANVAS_GATEWAY_PORT: '4200' };
  assert.deepEqual(applyResolvedLocalPorts(env), {
    port: 4101,
    gatewayPort: 4200,
  });
  assert.deepEqual(env, {
    PORT: '4101',
    EDUCANVAS_GATEWAY_PORT: '4200',
  });
});
