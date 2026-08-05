/**
 * V02-W runner: TeleSpeechASR 真实终稿对照实验的薄编排。
 *
 * 只做两件事：V02-W02 调用前门禁、V02-W03 恰好 3 次真实转录。真实转录复用
 * 现有 apps/worker/tooling/v02v-transcribe.ts（同一入口，不新拼 HTTP 请求、
 * 不解析 Provider 原始响应）；公共算法在 v02-w-evaluation.mjs。本 runner
 * 不含任何重试循环：固定计数 for 循环恰好执行 3 次，失败不补跑、无第四次。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  V02_W_BASE_URL_HOST,
  V02_W_FIXTURE_RELATIVE_PATH,
  V02_W_FIXTURE_SHA256,
  V02_W_MODEL_ID,
  V02_W_REPETITIONS,
} from './v02-w-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const workerDir = join(repoRoot, 'apps/worker');
const fixtureRoot = resolve(here, 'fixtures/generated');
const fixture = resolve(here, V02_W_FIXTURE_RELATIVE_PATH);
const outputDir = join(here, 'results/v02-w');
const nodeVersion = process.version;

// —— V02-W02 调用前门禁：任一失败都在首次网络请求前停止（exit 2 + 稳定码）。
assertGates();

// —— V02-W03 恰好 3 次真实转录；固定计数循环，无自动重试、无补跑。
for (let repetition = 1; repetition <= V02_W_REPETITIONS; repetition++) {
  const result = runTranscribe({
    audio: relative(workerDir, fixture),
    expectedSha256: V02_W_FIXTURE_SHA256,
  });
  writeJson(
    join(outputDir, `cloud-final-${repetition}.json`),
    sanitize(result),
  );
  console.log(`V02-W cloudFinal ${repetition} exit=${result.exitCode}`);
}
console.log(
  `V02-W completed: exactly ${V02_W_REPETITIONS} TeleSpeechASR calls, no retries.`,
);

/** 门禁顺序即任务顺序；全部通过后才允许任何网络请求。 */
function assertGates() {
  const relativeFixture = relative(fixtureRoot, fixture);
  if (
    relativeFixture.startsWith('..') ||
    isAbsolute(relativeFixture) ||
    !relativeFixture.endsWith('v02-s-human.wav')
  ) {
    failGate('fixture_path_outside_controlled_dir');
  }
  if (fixtureSha256() !== V02_W_FIXTURE_SHA256) {
    failGate('fixture_sha256_mismatch');
  }
  if (process.env.MODEL_GATEWAY_TRANSCRIPTION_MODEL !== V02_W_MODEL_ID) {
    failGate('model_id_mismatch');
  }
  if (V02_W_REPETITIONS !== 3) {
    failGate('repetitions_mismatch');
  }
  let hostname = null;
  try {
    hostname = new URL(
      process.env.MODEL_GATEWAY_TRANSCRIPTION_BASE_URL ?? '',
    ).hostname.toLowerCase();
  } catch {
    // hostname 保持 null，走 base_url_host_mismatch。
  }
  if (hostname !== V02_W_BASE_URL_HOST) {
    failGate('base_url_host_mismatch');
  }
  if (
    process.env.MODEL_GATEWAY_TRANSCRIPTION_PROVIDER !== 'openai-compatible'
  ) {
    failGate('provider_mismatch');
  }
  if (process.env.ALLOW_PAID_TRANSCRIPTION_SMOKE !== '1') {
    failGate('paid_transcription_not_authorized');
  }
  if (process.env.ALLOW_EXTERNAL_AUDIO_UPLOAD !== '1') {
    failGate('external_audio_upload_not_authorized');
  }
  // 无自动重试是结构约束：本 runner 只有上面的固定计数 for 循环，
  // 无 while / catch 补跑 / 重试分支；输出目录也必须独立于 V02-V。
  if (outputDir === join(here, 'results/v02-v')) {
    failGate('output_dir_overlaps_v02v');
  }
  if (outputDir === join(here, 'results/v02-w')) {
    return;
  }
  failGate('output_dir_unexpected');
}

/** 复用现有 v02v-transcribe.ts；env 只覆盖模型与临时授权变量，Key 仍来自 .env 注入。 */
function runTranscribe(args) {
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
  const result = spawnSync('pnpm', spawnArgs, {
    cwd: workerDir,
    env: {
      ...process.env,
      MODEL_GATEWAY_TRANSCRIPTION_MODEL: V02_W_MODEL_ID,
      ALLOW_PAID_TRANSCRIPTION_SMOKE: '1',
      ALLOW_EXTERNAL_AUDIO_UPLOAD: '1',
      PATH: process.env.PATH ?? '',
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
  return { exitCode: result.status, json };
}

/** 只允许稳定字段进入证据；出现绝对路径、密钥或堆栈时拒绝落盘。 */
function sanitize(result) {
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
    /(?:\/Users\/|\/home\/|\/tmp\/|[A-Za-z]:\\)|(?:Bearer\s+|\bsk-[A-Za-z0-9_-]{8,}|\bgh[opsu]_[A-Za-z0-9]{8,})|(?:\n\s*at\s+\S)/.test(
      raw,
    )
  ) {
    failGate('unsafe_evidence_value');
  }
}

function fixtureSha256() {
  const bytes = readFileSync(fixture);
  if (bytes.byteLength === 0) {
    failGate('empty_audio');
  }
  return createHash('sha256').update(bytes).digest('hex');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function failGate(errorCode) {
  console.error(`V02-W gate failed: ${errorCode}`);
  process.exit(2);
}
