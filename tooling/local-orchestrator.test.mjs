import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const orchestrator = readFileSync('tooling/local-orchestrator.mjs', 'utf8');

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
  assert.match(orchestrator, /process\.env\.PORT = String\(port\)/);
  assert.match(
    orchestrator,
    /process\.env\.EDUCANVAS_GATEWAY_PORT = String\(gatewayPort\)/,
  );
});
