import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

function runEnvCheck(envPath) {
  return spawnSync(process.execPath, ['tooling/env-check.mjs', envPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

async function writeEnv(contents) {
  const directory = await mkdtemp(path.join(tmpdir(), 'educanvas-env-check-'));
  const envPath = path.join(directory, '.env');
  await writeFile(envPath, contents, 'utf8');
  return envPath;
}

describe('env-check', () => {
  it('accepts the repository example environment', () => {
    const result = runEnvCheck('.env.example');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /model provider disabled/);
  });

  it('fails early when DeepSeek is selected without the explicit allow flag', async () => {
    const envPath = await writeEnv(`
DATABASE_URL=postgresql://educanvas:educanvas@localhost:5432/educanvas
EDUCANVAS_DEPLOYMENT_ENV=local
MODEL_GATEWAY_PROVIDER=deepseek
MODEL_GATEWAY_RUNTIME=native
MODEL_GATEWAY_ALLOW_DEEPSEEK=false
MODEL_GATEWAY_BASE_URL=https://api.deepseek.com
MODEL_GATEWAY_API_KEY=fixture-key
MODEL_GATEWAY_PRIMARY_MODEL=deepseek-chat
`);

    const result = runEnvCheck(envPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /MODEL_GATEWAY_ALLOW_DEEPSEEK must be true/);
  });
});
