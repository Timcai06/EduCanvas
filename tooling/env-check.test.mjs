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
        MODEL_GATEWAY_PRIMARY_MODEL: 'deepseek-v4-flash',
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

  it('accepts a text provider paired with a separate vision provider', async () => {
    const result = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_VISION_MODEL: 'vision/model-v1',
          MODEL_GATEWAY_VISION_BASE_URL: 'https://vision.example.test/v4',
          MODEL_GATEWAY_VISION_API_KEY: 'fixture-vision-key',
        }),
      ),
    );

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects a half-configured vision provider', async () => {
    const missingBaseUrl = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_VISION_MODEL: 'vision/model-v1',
          MODEL_GATEWAY_VISION_API_KEY: 'fixture-vision-key',
        }),
      ),
    );
    const missingKey = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_VISION_MODEL: 'vision/model-v1',
          MODEL_GATEWAY_VISION_BASE_URL: 'https://vision.example.test/v4',
        }),
      ),
    );

    assert.equal(missingBaseUrl.status, 1);
    assert.match(missingBaseUrl.stderr, /missing vision provider values/);
    assert.equal(missingKey.status, 1);
    assert.match(missingKey.stderr, /missing vision provider values/);
  });

  it('rejects declaring both native vision and a separate vision provider', async () => {
    const result = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_VISION: 'true',
          MODEL_GATEWAY_VISION_MODEL: 'vision/model-v1',
          MODEL_GATEWAY_VISION_BASE_URL: 'https://vision.example.test/v4',
          MODEL_GATEWAY_VISION_API_KEY: 'fixture-vision-key',
        }),
      ),
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /mutually exclusive/);
  });

  it('rejects a vision key without printing the supplied key', async () => {
    const result = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_VISION_MODEL: 'vision/model-v1',
          MODEL_GATEWAY_VISION_BASE_URL: 'https://vision.example.test/v4',
          MODEL_GATEWAY_VISION_API_KEY: 'fixture-视觉密钥',
        }),
      ),
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /VISION_API_KEY has an invalid shape/);
    assert.doesNotMatch(result.stderr, /fixture-视觉密钥/);
  });

  it('requires https for a production vision endpoint', async () => {
    const result = runEnvCheck(
      await writeEnv(
        providerEnv({
          EDUCANVAS_DEPLOYMENT_ENV: 'production',
          MODEL_GATEWAY_VISION_MODEL: 'vision/model-v1',
          MODEL_GATEWAY_VISION_BASE_URL: 'http://vision.example.test/v4',
          MODEL_GATEWAY_VISION_API_KEY: 'fixture-vision-key',
        }),
      ),
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /VISION_BASE_URL must use https in staging\/production/,
    );
  });

  it('accepts a complete speech override and reports its state', async () => {
    const result = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
          MODEL_GATEWAY_SPEECH_MODEL: 'speech/model-v1',
          MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech.example.test/v1',
          MODEL_GATEWAY_SPEECH_API_KEY: 'fixture-speech-key',
        }),
      ),
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /speech=overridden/);
    assert.match(result.stdout, /transcription=disabled/);
  });

  it('rejects a half-configured speech override without printing the key', async () => {
    const secret = 'fixture-secret-never-log';
    const missingBaseUrl = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
          MODEL_GATEWAY_SPEECH_MODEL: 'speech/model-v1',
          MODEL_GATEWAY_SPEECH_API_KEY: secret,
        }),
      ),
    );
    const missingModel = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
          MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech.example.test/v1',
          MODEL_GATEWAY_SPEECH_API_KEY: secret,
        }),
      ),
    );

    assert.equal(missingBaseUrl.status, 1);
    assert.match(missingBaseUrl.stderr, /missing SPEECH override values/);
    assert.equal(missingModel.status, 1);
    assert.match(missingModel.stderr, /missing SPEECH override values/);
    assert.doesNotMatch(missingBaseUrl.stderr, new RegExp(secret));
    assert.doesNotMatch(missingModel.stderr, new RegExp(secret));
  });

  it('rejects an invalid capability provider', async () => {
    const result = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_IMAGE_PROVIDER: 'not-a-provider',
          MODEL_GATEWAY_IMAGE_MODEL: 'image/model-v1',
          MODEL_GATEWAY_IMAGE_BASE_URL: 'https://image.example.test/v1',
          MODEL_GATEWAY_IMAGE_API_KEY: 'fixture-image-key',
        }),
      ),
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /MODEL_GATEWAY_IMAGE_PROVIDER is not valid/);
  });

  it('accepts capability overrides under a DeepSeek primary provider', async () => {
    const result = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_PROVIDER: 'deepseek',
          MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
          MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com',
          MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
          MODEL_GATEWAY_SPEECH_MODEL: 'speech/model-v1',
          MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech.example.test/v1',
          MODEL_GATEWAY_SPEECH_API_KEY: 'fixture-speech-key',
        }),
      ),
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /speech=overridden/);
  });

  it('accepts the explicit legacy DashScope rollback profile without printing secrets', async () => {
    const secret = 'dashscope-fixture-secret';
    const result = runEnvCheck(
      await writeEnv(
        providerEnv({
          DASHSCOPE_API_KEY: secret,
          DASHSCOPE_WORKSPACE_ID: 'workspace_fixture',
          DASHSCOPE_ASR_MODEL: 'paraformer-realtime-v2',
          DASHSCOPE_TTS_MODEL: 'cosyvoice-v3-flash',
          DASHSCOPE_TTS_VOICE: 'longanyang',
        }),
      ),
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /live-voice=enabled provider=dashscope/);
    assert.doesNotMatch(result.stdout, new RegExp(secret));
  });

  it('rejects a one-sided DashScope TTS profile override', async () => {
    for (const override of [
      { DASHSCOPE_TTS_MODEL: 'cosyvoice-v3-flash' },
      { DASHSCOPE_TTS_VOICE: 'longanyang' },
    ]) {
      const result = runEnvCheck(
        await writeEnv(
          providerEnv({
            DASHSCOPE_API_KEY: 'dashscope-fixture-secret',
            DASHSCOPE_WORKSPACE_ID: 'workspace_fixture',
            ...override,
          }),
        ),
      );

      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /DASHSCOPE_TTS_MODEL and DASHSCOPE_TTS_VOICE must be configured together/,
      );
    }
  });

  it('rejects half-configured DashScope Live Voice without printing secrets', async () => {
    const secret = 'dashscope-fixture-secret';
    const result = runEnvCheck(
      await writeEnv(providerEnv({ DASHSCOPE_API_KEY: secret })),
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /missing DashScope Live Voice values: DASHSCOPE_WORKSPACE_ID/,
    );
    assert.doesNotMatch(result.stderr, new RegExp(secret));
  });

  it('rejects non-Beijing DashScope WebSocket endpoints', async () => {
    const result = runEnvCheck(
      await writeEnv(
        providerEnv({
          DASHSCOPE_API_KEY: 'dashscope-fixture-secret',
          DASHSCOPE_WORKSPACE_ID: 'workspace_fixture',
          DASHSCOPE_BEIJING_WS_URL:
            'wss://workspace_fixture.example.test/api-ws/v1/inference',
        }),
      ),
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /credential-free Beijing wss inference endpoint/,
    );
  });

  it('rejects a Beijing endpoint for a different Workspace', async () => {
    const result = runEnvCheck(
      await writeEnv(
        providerEnv({
          DASHSCOPE_API_KEY: 'dashscope-fixture-secret',
          DASHSCOPE_WORKSPACE_ID: 'workspace_fixture',
          DASHSCOPE_BEIJING_WS_URL:
            'wss://other-workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
        }),
      ),
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /credential-free Beijing wss inference endpoint/,
    );
  });

  it('requires a model version when embedding is configured', async () => {
    const missingVersion = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_EMBEDDING_PROVIDER: 'openai-compatible',
          MODEL_GATEWAY_EMBEDDING_MODEL: 'embed/model-v1',
          MODEL_GATEWAY_EMBEDDING_BASE_URL: 'https://embed.example.test/v1',
          MODEL_GATEWAY_EMBEDDING_API_KEY: 'fixture-embed-key',
        }),
      ),
    );

    assert.equal(missingVersion.status, 1);
    assert.match(
      missingVersion.stderr,
      /MODEL_GATEWAY_EMBEDDING_MODEL_VERSION is required/,
    );

    const withVersion = runEnvCheck(
      await writeEnv(
        providerEnv({
          MODEL_GATEWAY_EMBEDDING_PROVIDER: 'openai-compatible',
          MODEL_GATEWAY_EMBEDDING_MODEL: 'embed/model-v1',
          MODEL_GATEWAY_EMBEDDING_BASE_URL: 'https://embed.example.test/v1',
          MODEL_GATEWAY_EMBEDDING_API_KEY: 'fixture-embed-key',
          MODEL_GATEWAY_EMBEDDING_MODEL_VERSION: '2026-05-01',
        }),
      ),
    );

    assert.equal(withVersion.status, 0, withVersion.stderr);
    assert.match(withVersion.stdout, /embedding=overridden/);
  });
});
