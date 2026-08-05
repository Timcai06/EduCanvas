/**
 * V02-W summary builder: 从 results/v02-w/ 的三次真实结果计算指标并生成
 * 有界 evidence/v02-w-summary.json。结论只由 v02-w-evaluation.mjs 的判定规则
 * 驱动（REVIEW_REQUIRED 或 BLOCKED_MODEL_OR_PROVIDER），本脚本不修改任何
 * 阈值、参考文本或 normalization，也不挑选有利结果。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideV02WVerdict,
  evaluateV02WResults,
  V02_W_EXPERIMENT,
  V02_W_EXPECTED_TEXT,
  V02_W_FIXTURE_SHA256,
  V02_W_MODEL_ID,
  V02_W_REPETITIONS,
} from './v02-w-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, 'results/v02-w');

const rawResults = [1, 2, 3].map((n) =>
  readJson(join(resultsDir, `cloud-final-${n}.json`)),
);
const results = rawResults.map(normalizeCloudResult);
validateCloudResults(results);

const evaluation = evaluateV02WResults(results);
const decision = decideV02WVerdict(evaluation);

const summary = {
  schemaVersion: 1,
  experiment: V02_W_EXPERIMENT,
  generatedAt: new Date().toISOString(),
  runtime: {
    // 摘要可能由另一 Node 版本生成；运行时证据必须来自三次真实调用结果。
    node: results[0].node,
  },
  provider: 'openai-compatible',
  providerName: 'SiliconFlow',
  resolvedModelId: V02_W_MODEL_ID,
  fixture: {
    expectedText: V02_W_EXPECTED_TEXT,
    sha256: V02_W_FIXTURE_SHA256,
    repetitions: V02_W_REPETITIONS,
  },
  runs: results.map((result, index) => ({
    repetition: index + 1,
    provider: result.provider,
    resolvedModelId: result.resolvedModelId,
    transcript: result.transcript,
    wer: evaluation.wers[index],
    baggingRecall: evaluation.perTermRecalls[index].bagging,
    boostingRecall: evaluation.perTermRecalls[index].boosting,
    latencyMs: result.latencyMs,
    language: result.language,
    durationSeconds: result.durationSeconds,
    fixtureSha256: result.fixtureSha256,
    exitCode: result.exitCode,
    errorCode: result.errorCode,
  })),
  latencyRange: evaluation.latencyMs,
  noFailure: evaluation.noFailure,
  allNonEmpty: evaluation.allNonEmpty,
  qualityPassed: evaluation.qualityPassed,
  termsComplete: evaluation.termsComplete,
  stable: evaluation.stable,
  authorization: {
    paid: true,
    externalAudioUpload: true,
  },
  verdict: decision.verdict,
  blockerCode: decision.blockerCode,
  v02Passed: false,
  v03Unlocked: false,
};

// 证据必须不含 Key、绝对路径、原始 Provider body 或 stack。
assertSafeEvidence(summary);

if (summary.resolvedModelId !== V02_W_MODEL_ID) {
  fail('V02-W summary model does not match TeleAI/TeleSpeechASR.');
}

const output = join(here, 'evidence/v02-w-summary.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

function validateCloudResults(results) {
  const runNodes = new Set(results.map((result) => result.node));
  if (runNodes.size !== 1 || !results[0].node) {
    fail('V02-W cloud final Node runtime evidence is inconsistent.');
  }
  for (const result of results) {
    if (result.fixtureSha256 !== V02_W_FIXTURE_SHA256) {
      fail('V02-W cloud final fixture hash mismatch.');
    }
    if (result.exitCode !== 0 || result.errorCode !== null) {
      fail('V02-W recorded a Provider failure as success.');
    }
    if (result.resolvedModelId !== V02_W_MODEL_ID) {
      fail('V02-W resolved model is not TeleAI/TeleSpeechASR.');
    }
  }
}

function normalizeCloudResult(json) {
  return {
    provider: json.provider ?? null,
    resolvedModelId: json.resolvedModelId ?? null,
    transcript: json.transcript ?? '',
    latencyMs: json.latencyMs ?? null,
    language: json.language ?? null,
    durationSeconds: json.durationSeconds ?? null,
    fixtureSha256: json.fixtureSha256 ?? null,
    exitCode: json.exitCode ?? null,
    errorCode: json.errorCode ?? null,
    node: json.node ?? null,
  };
}

function assertSafeEvidence(value) {
  const raw = JSON.stringify(value);
  if (
    /(?:\/Users\/|\/home\/|\/tmp\/|[A-Za-z]:\\)|(?:Bearer\s+|\bsk-[A-Za-z0-9_-]{8,}|\bgh[opsu]_[A-Za-z0-9]{8,})|(?:\n\s*at\s+\S)/.test(
      raw,
    )
  ) {
    fail('unsafe evidence value rejected');
  }
}

function readJson(path) {
  if (!existsSync(path)) {
    fail(`V02-W evidence is incomplete: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`V02-W evidence is invalid JSON: ${path}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
