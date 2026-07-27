import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

const temporaryDirectories = [];

function runEnvCheck(envPath) {
  return spawnSync(process.execPath, ['tooling/env-check.mjs', envPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

async function writeEnv(contents) {
  const directory = await mkdtemp(path.join(tmpdir(), 'educanvas-env-check-'));
  temporaryDirectories.push(directory);
  const envPath = path.join(directory, '.env');
  await writeFile(envPath, contents, 'utf8');
  return envPath;
}

function providerEnv(overrides = {}) {
  const values = {
    DATABASE_URL: 'postgresql://educanvas:educanvas@localhost:5432/educanvas',
    EDUCANVAS_DEPLOYMENT_ENV: 'local',
    MODEL_GATEWAY_PROVIDER: 'openai-compatible',
    MODEL_GATEWAY_RUNTIME: 'native',
    MODEL_GATEWAY_ALLOW_DEEPSEEK: 'false',
    MODEL_GATEWAY_BASE_URL: 'https://models.example.test/v1',
    MODEL_GATEWAY_API_KEY: 'fixture-key',
    MODEL_GATEWAY_PRIMARY_MODEL: 'fixture/model-v1',
    MODEL_GATEWAY_TIMEOUT_MS: '30000',
    MODEL_GATEWAY_MAX_OUTPUT_TOKENS: '2048',
    ...overrides,
  };
  return `${Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n')}\n`;
}

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('env-check', () => {
  it('accepts the repository example environment', () => {
    const result = runEnvCheck('.env.example');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /model provider disabled/);
  });

  it('fails early when DeepSeek is selected without the explicit allow flag', async () => {
    const envPath = await writeEnv(
      providerEnv({
        MODEL_GATEWAY_PROVIDER: 'deepseek',
        MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com',
        MODEL_GATEWAY_PRIMARY_MODEL: 'deepseek-chat',
      }),
    );

    const result = runEnvCheck(envPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /MODEL_GATEWAY_ALLOW_DEEPSEEK must be true/);
  });

  it('requires HTTPS for a production model endpoint', async () => {
    const envPath = await writeEnv(
      providerEnv({
        EDUCANVAS_DEPLOYMENT_ENV: 'production',
        MODEL_GATEWAY_BASE_URL: 'http://models.example.test/v1',
      }),
    );

    const result = runEnvCheck(envPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /must use https in staging\/production/);
  });

  it('rejects unknown provider and runtime selections', async () => {
    const invalidProvider = runEnvCheck(
      await writeEnv(
        providerEnv({ MODEL_GATEWAY_PROVIDER: 'unknown-provider' }),
      ),
    );
    const invalidRuntime = runEnvCheck(
      await writeEnv(providerEnv({ MODEL_GATEWAY_RUNTIME: 'fallback' })),
    );

    assert.equal(invalidProvider.status, 1);
    assert.match(invalidProvider.stderr, /PROVIDER is not valid/);
    assert.equal(invalidRuntime.status, 1);
    assert.match(invalidRuntime.stderr, /RUNTIME must be native or ai-sdk/);
  });

  it('rejects credentials, query strings and fragments in provider URLs', async () => {
    const envPath = await writeEnv(
      providerEnv({
        MODEL_GATEWAY_BASE_URL:
          'https://fixture:secret@models.example.test/v1?debug=true',
      }),
    );

    const result = runEnvCheck(envPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /without credentials, query, or fragment/);
    assert.doesNotMatch(result.stderr, /fixture:secret/);
  });

  it('rejects non-ASCII API keys without printing the supplied key', async () => {
    const envPath = await writeEnv(
      providerEnv({ MODEL_GATEWAY_API_KEY: 'fixture-密钥' }),
    );

    const result = runEnvCheck(envPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /API_KEY has an invalid shape/);
    assert.doesNotMatch(result.stderr, /fixture-密钥/);
  });

  it('rejects malformed model IDs and numeric values outside bounds', async () => {
    const invalidModel = runEnvCheck(
      await writeEnv(
        providerEnv({ MODEL_GATEWAY_PRIMARY_MODEL: 'model with spaces' }),
      ),
    );
    const invalidTimeout = runEnvCheck(
      await writeEnv(providerEnv({ MODEL_GATEWAY_TIMEOUT_MS: '999' })),
    );
    const invalidTokenLimit = runEnvCheck(
      await writeEnv(providerEnv({ MODEL_GATEWAY_MAX_OUTPUT_TOKENS: '65537' })),
    );

    assert.equal(invalidModel.status, 1);
    assert.match(invalidModel.stderr, /PRIMARY_MODEL is not a valid model id/);
    assert.equal(invalidTimeout.status, 1);
    assert.match(invalidTimeout.stderr, /integer between 1000 and 120000/);
    assert.equal(invalidTokenLimit.status, 1);
    assert.match(invalidTokenLimit.stderr, /integer between 1 and 65536/);
  });

  it('accepts a complete production openai-compatible configuration', async () => {
    const result = runEnvCheck(
      await writeEnv(providerEnv({ EDUCANVAS_DEPLOYMENT_ENV: 'production' })),
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /model provider openai-compatible/);
  });
});
