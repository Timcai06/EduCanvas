/**
 * V02-V dual-path matrix runner.
 *
 * localDraft：small-bilingual-int8 WASM（无热词，3 次）。
 * cloudFinal：现有 AudioTranscriptionModelGateway，经本地 fixture server 验证
 * 链路（fixture-only 不发生真实付费调用），另含未配置场景与 17 项失败行为。
 * 每次 spawn 显式剥离全部 MODEL_GATEWAY_* 环境变量，避免本机真实密钥进入
 * 验证进程；fixture 场景只注入假 key 指向 127.0.0.1。fixture server 由本脚本
 * 管理生命周期，结束时统一清理。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  V02_V_FIXTURE_RELATIVE_PATH,
  V02_V_FIXTURE_SHA256,
  V02_V_LOCAL_PROFILE,
  V02_V_REPETITIONS,
} from './v02-v-evaluation.mjs';
import { V02_U_NODE_VERSIONS } from './v02-u-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const workerDir = join(repoRoot, 'apps/worker');
const fixture = resolve(here, V02_V_FIXTURE_RELATIVE_PATH);
const outputDir = join(here, 'results/v02-v');
const servers = [];

const options = parseArgs(process.argv.slice(2));
const nodeExecutable = options.node ?? process.execPath;
const nodeVersion = spawnSync(nodeExecutable, ['--version'], {
  encoding: 'utf8',
}).stdout.trim();
if (!V02_U_NODE_VERSIONS.includes(nodeVersion)) {
  fail(
    `V02-V requires a declared Node 22/24 executable; got ${nodeVersion || 'unknown'}.`,
  );
}
await main(options.mode, options.cloudScope);
console.log('V02-V matrix completed. Generate and review the summary.');

async function main(mode, cloudScope) {
  try {
    if (mode === 'local' || mode === 'all') await runLocalDraft();
    if (mode === 'cloud' || mode === 'all') await runCloudFinal(cloudScope);
    if (mode === 'failures' || mode === 'all') await runFailures();
  } finally {
    // 任何一步抛错也要清理 fixture server，避免孤儿进程持续监听端口。
    for (const child of servers) child.kill();
  }
}

async function runLocalDraft() {
  mkdirSync(outputDir, { recursive: true });
  for (let repetition = 1; repetition <= V02_V_REPETITIONS; repetition++) {
    // run-compare.mjs 拒绝绝对输出路径（证据防本机路径泄漏），必须传相对路径。
    const output = `results/v02-v/local-draft-${repetition}.json`;
    const args = [
      'run-compare.mjs',
      '--engine',
      'wasm',
      '--model-profile',
      V02_V_LOCAL_PROFILE,
      '--fixture',
      V02_V_FIXTURE_RELATIVE_PATH,
      '--chunk-ms',
      '100',
      '--tail-seconds',
      '1.5',
      '--output',
      output,
    ];
    runNode(nodeExecutable, args, here, noModelGatewayEnv());
    console.log(`localDraft ${repetition} ok`);
  }
}

async function runCloudFinal(scope) {
  mkdirSync(outputDir, { recursive: true });
  const realProvider = scope === 'real-provider';
  const env = realProvider
    ? realProviderEnv()
    : fixtureEnv(await startFixtureServer('success'));
  for (let repetition = 1; repetition <= V02_V_REPETITIONS; repetition++) {
    const result = runTranscribe(env, {
      audio: relative(workerDir, fixture),
      expectedSha256: V02_V_FIXTURE_SHA256,
    });
    writeJson(
      join(outputDir, `cloud-final-${repetition}.json`),
      sanitize(result),
    );
    console.log(`cloudFinal ${repetition} exit=${result.exitCode}`);
  }
  writeJson(join(outputDir, 'cloud-scope.json'), {
    scope,
    paidAuthorized: realProvider,
    externalAudioUploadAuthorized: realProvider,
  });
  // 未配置 Provider：确定性 BLOCKED，不是错误。
  const unconfigured = runTranscribe(noModelGatewayEnv(), {
    audio: relative(workerDir, fixture),
    expectedSha256: V02_V_FIXTURE_SHA256,
  });
  writeJson(join(outputDir, 'cloud-unconfigured.json'), sanitize(unconfigured));
  console.log(`cloudFinal unconfigured exit=${unconfigured.exitCode}`);
}

async function runFailures() {
  const failuresDir = join(outputDir, 'failures');
  mkdirSync(failuresDir, { recursive: true });
  // 空音频 fixture：0 字节文件，用于触发 empty_audio 失败行为。
  writeFileSync(join(here, 'fixtures/generated/empty.wav'), Buffer.alloc(0));
  writeFileSync(join(outputDir, 'outside-fixture-root.wav'), Buffer.from([1]));
  const audio = relative(workerDir, fixture);
  const base = { audio, expectedSha256: V02_V_FIXTURE_SHA256 };
  const successPort = await startFixtureServer('success');
  const cases = [
    {
      name: 'provider_not_configured',
      env: noModelGatewayEnv(),
      args: base,
    },
    {
      name: 'audio_file_missing',
      env: fixtureEnv(successPort),
      args: {
        ...base,
        audio: relative(
          workerDir,
          join(here, 'fixtures/generated/does-not-exist.wav'),
        ),
      },
    },
    {
      name: 'fixture_sha256_mismatch',
      env: fixtureEnv(successPort),
      args: { ...base, expectedSha256: 'a'.repeat(64) },
    },
    {
      name: 'expected_sha256_required',
      env: fixtureEnv(successPort),
      args: { audio },
    },
    {
      name: 'invalid_expected_sha256',
      env: fixtureEnv(successPort),
      args: { audio, expectedSha256: 'invalid' },
    },
    {
      name: 'audio_path_outside_fixture_root',
      env: fixtureEnv(successPort),
      args: {
        audio: relative(workerDir, join(outputDir, 'outside-fixture-root.wav')),
        expectedSha256: V02_V_FIXTURE_SHA256,
      },
    },
    {
      name: 'empty_audio',
      env: fixtureEnv(successPort),
      args: {
        ...base,
        audio: relative(workerDir, join(here, 'fixtures/generated/empty.wav')),
      },
    },
    {
      name: 'unsupported_mime',
      env: fixtureEnv(successPort),
      args: {
        ...base,
        audio: relative(
          workerDir,
          join(here, 'fixtures/v02v-fixture-server.mjs'),
        ),
      },
    },
    {
      name: 'audio_too_large',
      env: fixtureEnv(successPort, {
        MODEL_GATEWAY_TRANSCRIPTION_MAX_INPUT_BYTES: '1024',
      }),
      args: base,
    },
    {
      name: 'provider_unauthorized_401',
      env: fixtureEnv(await startFixtureServer('unauthorized')),
      args: base,
    },
    {
      name: 'provider_forbidden_403',
      env: fixtureEnv(await startFixtureServer('forbidden')),
      args: base,
    },
    {
      name: 'provider_rate_limit_429',
      env: fixtureEnv(await startFixtureServer('rate_limit')),
      args: base,
    },
    {
      name: 'provider_server_error_500',
      env: fixtureEnv(await startFixtureServer('server_error')),
      args: base,
    },
    {
      name: 'timeout',
      env: fixtureEnv(await startFixtureServer('slow:8000'), {
        MODEL_GATEWAY_TRANSCRIPTION_TIMEOUT_MS: '5000',
      }),
      args: base,
    },
    {
      name: 'invalid_json',
      env: fixtureEnv(await startFixtureServer('invalid_json')),
      args: base,
    },
    {
      name: 'empty_transcript',
      env: fixtureEnv(await startFixtureServer('empty_transcript')),
      args: base,
    },
    {
      name: 'abort_signal',
      env: fixtureEnv(await startFixtureServer('slow:8000')),
      args: { ...base, abortAfterMs: '20' },
    },
  ];
  for (const item of cases) {
    const result = runTranscribe(item.env, item.args);
    writeJson(join(failuresDir, `${item.name}.json`), sanitize(result));
    const code =
      result.json?.errorCode ??
      result.json?.blockerCode ??
      result.json?.verdict ??
      'unparsed';
    console.log(`failure ${item.name} exit=${result.exitCode} code=${code}`);
  }
}

function startFixtureServer(scenario) {
  return new Promise((resolvePort, reject) => {
    const child = spawn(
      nodeExecutable,
      ['fixtures/v02v-fixture-server.mjs', scenario],
      { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    servers.push(child);
    let buffer = '';
    let resolved = false;
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const line = buffer.split('\n')[0];
      if (line && !resolved) {
        resolved = true;
        resolvePort(Number(line.trim()));
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!resolved) reject(new Error(`fixture server exited early (${code})`));
    });
  });
}

function fixtureEnv(port, overrides = {}) {
  return {
    ...noModelGatewayEnv(),
    // 主配置是媒体能力 override 的投影基底（config-capability 首行判空），
    // 因此必须同时提供假主配置；transcription override 的 baseUrl/apiKey 会
    // 覆盖主配置，请求只发往 127.0.0.1 fixture server，绝不接触真实 Provider。
    EDUCANVAS_DEPLOYMENT_ENV: 'local',
    MODEL_GATEWAY_PROVIDER: 'openai-compatible',
    MODEL_GATEWAY_BASE_URL: 'http://127.0.0.1:1/v1',
    MODEL_GATEWAY_API_KEY: 'fixture-primary-key-only',
    MODEL_GATEWAY_PRIMARY_MODEL: 'fixture-primary-model',
    MODEL_GATEWAY_TRANSCRIPTION_PROVIDER: 'openai-compatible',
    MODEL_GATEWAY_TRANSCRIPTION_MODEL: 'fixture-transcription-model',
    MODEL_GATEWAY_TRANSCRIPTION_BASE_URL: `http://127.0.0.1:${port}/v1`,
    MODEL_GATEWAY_TRANSCRIPTION_API_KEY: 'fixture-local-key-only',
    MODEL_GATEWAY_TRANSCRIPTION_TIMEOUT_MS: '5000',
    MODEL_GATEWAY_TRANSCRIPTION_MAX_INPUT_BYTES: '26214400',
    ...overrides,
  };
}

/** 剥离全部 MODEL_GATEWAY_*，确保本机真实 Provider 密钥绝不进入验证进程。 */
function noModelGatewayEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('MODEL_GATEWAY_'),
    ),
  );
}

function realProviderEnv() {
  if (
    process.env.ALLOW_PAID_TRANSCRIPTION_SMOKE !== '1' ||
    process.env.ALLOW_EXTERNAL_AUDIO_UPLOAD !== '1'
  ) {
    fail(
      'real-provider requires ALLOW_PAID_TRANSCRIPTION_SMOKE=1 and ALLOW_EXTERNAL_AUDIO_UPLOAD=1',
    );
  }
  const required = [
    'MODEL_GATEWAY_TRANSCRIPTION_PROVIDER',
    'MODEL_GATEWAY_TRANSCRIPTION_MODEL',
    'MODEL_GATEWAY_TRANSCRIPTION_BASE_URL',
    'MODEL_GATEWAY_TRANSCRIPTION_API_KEY',
  ];
  if (required.some((key) => !process.env[key]?.trim())) {
    fail('real transcription Provider configuration is incomplete');
  }
  let endpoint;
  try {
    endpoint = new URL(process.env.MODEL_GATEWAY_TRANSCRIPTION_BASE_URL);
  } catch {
    fail('real transcription Provider base URL is invalid');
  }
  if (
    ['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname.toLowerCase())
  ) {
    fail('real-provider scope cannot use a loopback fixture endpoint');
  }
  return { ...process.env };
}

function runTranscribe(env, args) {
  const spawnArgs = [
    'exec',
    'tsx',
    'tooling/v02v-transcribe.ts',
    '--audio',
    args.audio,
  ];
  if (args.expectedSha256) {
    spawnArgs.push('--expected-sha256', args.expectedSha256);
  }
  if (args.abortAfterMs) {
    spawnArgs.push('--abort-after-ms', String(args.abortAfterMs));
  }
  const result = spawnSync('pnpm', spawnArgs, {
    cwd: workerDir,
    env: {
      ...env,
      PATH: `${dirname(nodeExecutable)}:${env.PATH ?? process.env.PATH ?? ''}`,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout.trim());
  } catch {
    // 输出不可解析时不伪造证据；原始输出只进进程内诊断，不落盘。
  }
  return {
    exitCode: result.status,
    json,
  };
}

function sanitize(result) {
  // 只允许稳定字段进入证据；出现绝对路径、密钥或堆栈时拒绝落盘。
  const json = result.json ?? {};
  const allowed = [
    'schemaVersion',
    'verdict',
    'blockerCode',
    'provider',
    'resolvedModelId',
    'transcript',
    'latencyMs',
    'language',
    'durationSeconds',
    'fixtureSha256',
    'errorCode',
  ];
  const sanitized = {};
  for (const key of allowed) {
    if (key in json) sanitized[key] = json[key];
  }
  sanitized.exitCode = result.exitCode;
  sanitized.node = nodeVersion;
  assertSafeEvidence(sanitized);
  return sanitized;
}

function assertSafeEvidence(value) {
  const raw = JSON.stringify(value);
  if (
    /(?:\/Users\/|\/home\/|\/tmp\/|[A-Za-z]:\\\\)|(?:Bearer\s+|\bsk-[A-Za-z0-9_-]{8,}|\bgh[opsu]_[A-Za-z0-9]{8,})|(?:\n\s*at\s+\S)/.test(
      raw,
    )
  ) {
    fail('unsafe evidence value rejected');
  }
}

function runNode(executable, args, cwd, env) {
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const stableError = result.stderr.trim().split('\n')[0];
    fail(stableError || `command failed with exit ${result.status}.`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = { mode: 'all', cloudScope: 'fixture-only', node: null };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === '--mode') parsed.mode = value;
    else if (option === '--cloud-scope') parsed.cloudScope = value;
    else if (option === '--node') parsed.node = value;
    else fail(`Unknown option: ${option}`);
  }
  if (!['all', 'local', 'cloud', 'failures'].includes(parsed.mode)) {
    fail('--mode must be all, local, cloud, or failures');
  }
  if (!['fixture-only', 'real-provider'].includes(parsed.cloudScope)) {
    fail('--cloud-scope must be fixture-only or real-provider');
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
