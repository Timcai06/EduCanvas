/**
 * V02-V summary builder: 计算双路径指标并生成有界 evidence/v02-v-summary.json。
 * 结论由判定规则（V02-V07）驱动：未授权真实 Provider 时为 BLOCKED +
 * BLOCKED_REAL_PROVIDER_EVIDENCE_MISSING，fixture server 链路结果只作为
 * smoke 证据，不冒充真实 Provider 通过。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  evaluateCloudFinal,
  evaluateCombined,
  evaluateLocalDraft,
  V02_V_EXPECTED_TEXT,
  V02_V_EXPERIMENT,
  V02_V_FIXTURE_SHA256,
  V02_V_LOCAL_PROFILE,
  V02_V_REPETITIONS,
} from './v02-v-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, 'results/v02-v');

const localDraftReports = [1, 2, 3].map((n) =>
  readJson(join(resultsDir, `local-draft-${n}.json`)),
);
const cloudFinalRaw = [1, 2, 3].map((n) =>
  normalizeCloudResult(readJson(join(resultsDir, `cloud-final-${n}.json`))),
);
const unconfigured = readJson(join(resultsDir, 'cloud-unconfigured.json'));
const failures = readFailures(join(resultsDir, 'failures'));
const cloudScope = readJson(join(resultsDir, 'cloud-scope.json'));

validateLocalDraftReports(localDraftReports);
validateCloudResults(cloudFinalRaw);

const localDraft = evaluateLocalDraft(localDraftReports);
const cloudFinal = evaluateCloudFinal(cloudFinalRaw);
const combined = evaluateCombined(localDraft, cloudFinal);
const failureTable = summarizeFailures(failures);

const expectedCodes = {
  provider_not_configured: 'transcription_provider_not_configured',
  audio_file_missing: 'audio_file_missing',
  fixture_sha256_mismatch: 'fixture_sha256_mismatch',
  expected_sha256_required: 'expected_sha256_required',
  invalid_expected_sha256: 'invalid_expected_sha256',
  audio_path_outside_fixture_root: 'audio_path_outside_fixture_root',
  empty_audio: 'empty_audio',
  unsupported_mime: 'unsupported_mime',
  audio_too_large: 'output_limit',
  provider_unauthorized_401: 'invalid_response',
  provider_forbidden_403: 'invalid_response',
  provider_rate_limit_429: 'rate_limit',
  provider_server_error_500: 'unavailable',
  timeout: 'timeout',
  invalid_json: 'invalid_response',
  empty_transcript: 'invalid_response',
  abort_signal: 'aborted',
};
const failuresPassed = Object.entries(expectedCodes).every(
  ([name, code]) => failureTable[name]?.errorCode === code,
);
const realProviderEvidence = cloudScope.scope === 'real-provider';
if (
  !['fixture-only', 'real-provider'].includes(cloudScope.scope) ||
  (realProviderEvidence &&
    (!cloudScope.paidAuthorized || !cloudScope.externalAudioUploadAuthorized))
) {
  fail('V02-V cloud scope evidence is invalid.');
}
const routePassed =
  realProviderEvidence &&
  localDraft.passed &&
  cloudFinal.passed &&
  combined.passed &&
  failuresPassed;
const verdict = realProviderEvidence
  ? routePassed
    ? 'REVIEW_REQUIRED'
    : 'BLOCKED_MODEL_OR_PROVIDER'
  : 'BLOCKED';
const blockerCode = realProviderEvidence
  ? routePassed
    ? null
    : 'cloud_final_quality_gate_failed'
  : 'BLOCKED_REAL_PROVIDER_EVIDENCE_MISSING';

const summary = {
  schemaVersion: 1,
  experiment: V02_V_EXPERIMENT,
  generatedAt: new Date().toISOString(),
  runtime: {
    generatorNode: process.version,
    localDraftNodes: [
      ...new Set(localDraftReports.map((report) => report.environment?.node)),
    ],
    cloudFinalNodes: [...new Set(cloudFinalRaw.map((result) => result.node))],
  },
  fixture: {
    expectedText: V02_V_EXPECTED_TEXT,
    sha256: V02_V_FIXTURE_SHA256,
    repetitions: V02_V_REPETITIONS,
  },
  hashes: {
    localProfile: V02_V_LOCAL_PROFILE,
    localModelBytes: localDraftReports[0].modelBytes,
    localModelHashes: withoutFixture(localDraftReports[0].hashes),
  },
  localDraft: {
    profile: V02_V_LOCAL_PROFILE,
    evaluation: localDraft,
  },
  cloudFinal: {
    scope: cloudScope.scope,
    provider: cloudFinalRaw[0].provider,
    resolvedModelId: cloudFinalRaw[0].resolvedModelId,
    evaluation: cloudFinal,
  },
  combined: combined,
  authorization: {
    paid: cloudScope.paidAuthorized === true,
    externalAudioUpload: cloudScope.externalAudioUploadAuthorized === true,
  },
  unconfigured: {
    verdict: unconfigured.verdict,
    blockerCode: unconfigured.blockerCode,
  },
  failures: failureTable,
  failuresPassed,
  verdict,
  blockerCode,
  v02Passed: false,
  v03Unlocked: false,
};

if (
  realProviderEvidence &&
  summary.cloudFinal.resolvedModelId === 'fixture-transcription-model'
) {
  fail('V02-V real Provider evidence cannot use the fixture model.');
}

const output = join(here, 'evidence/v02-v-summary.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

function validateLocalDraftReports(reports) {
  for (const report of reports) {
    if (report.hashes?.fixture !== V02_V_FIXTURE_SHA256) {
      fail('V02-V local draft fixture hash mismatch.');
    }
    if (report.modelProfile !== V02_V_LOCAL_PROFILE) {
      fail('V02-V local draft profile mismatch.');
    }
    if (!['v22.23.1', 'v24.18.0'].includes(report.environment?.node)) {
      fail('V02-V local draft used an unsupported Node version.');
    }
  }
}

function validateCloudResults(results) {
  for (const result of results) {
    if (result.fixtureSha256 !== V02_V_FIXTURE_SHA256) {
      fail('V02-V cloud final fixture hash mismatch.');
    }
    if (result.exitCode !== 0 || result.errorCode !== null) {
      fail('V02-V cloud final recorded a Provider failure as success.');
    }
    if (!['v22.23.1', 'v24.18.0'].includes(result.node)) {
      fail('V02-V cloud final used an unsupported Node version.');
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
    node: json.node ?? null,
    fixtureSha256: json.fixtureSha256 ?? null,
    exitCode: json.exitCode ?? null,
    errorCode: json.errorCode ?? null,
  };
}

function readFailures(dir) {
  const names = [
    'provider_not_configured',
    'audio_file_missing',
    'fixture_sha256_mismatch',
    'expected_sha256_required',
    'invalid_expected_sha256',
    'audio_path_outside_fixture_root',
    'empty_audio',
    'unsupported_mime',
    'audio_too_large',
    'provider_unauthorized_401',
    'provider_forbidden_403',
    'provider_rate_limit_429',
    'provider_server_error_500',
    'timeout',
    'invalid_json',
    'empty_transcript',
    'abort_signal',
  ];
  const table = {};
  for (const name of names) {
    table[name] = {
      exitCode: null,
      errorCode: null,
    };
    try {
      const json = readJson(join(dir, `${name}.json`));
      table[name] = {
        exitCode: json.exitCode ?? null,
        errorCode: json.errorCode ?? json.blockerCode ?? json.verdict ?? null,
      };
    } catch {
      table[name].errorCode = 'evidence_missing';
    }
  }
  return table;
}

function summarizeFailures(failureTable) {
  const rows = {};
  for (const [name, value] of Object.entries(failureTable)) {
    rows[name] = { exitCode: value.exitCode, errorCode: value.errorCode };
  }
  return rows;
}

function withoutFixture(hashes) {
  const copy = { ...hashes };
  delete copy.fixture;
  delete copy.hotwords;
  return copy;
}

function readJson(path) {
  if (!existsSync(path)) fail(`V02-V evidence is incomplete: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`V02-V evidence is invalid JSON: ${path}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
