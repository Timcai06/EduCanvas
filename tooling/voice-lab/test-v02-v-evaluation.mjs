import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateCloudFinal,
  evaluateCombined,
  evaluateLocalDraft,
  V02_V_EXPECTED_TEXT,
} from './v02-v-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function localReport(text, overrides = {}) {
  return {
    runs: [
      {
        text,
        error: null,
        nonEmptyText: text.trim().length > 0,
        rtf: 0.2,
        peakRssKiB: 500000,
        ...overrides,
      },
    ],
  };
}

function repeatedLocal(text, overrides) {
  return [1, 2, 3].map(() => localReport(text, overrides));
}

function cloudResult(transcript, overrides = {}) {
  return {
    provider: 'openai-compatible',
    resolvedModelId: 'fixture-transcription-model',
    transcript,
    latencyMs: 22,
    language: 'english',
    durationSeconds: 10,
    fixtureSha256: 'a'.repeat(64),
    exitCode: 0,
    errorCode: null,
    ...overrides,
  };
}

function repeatedCloud(transcript, overrides) {
  return [1, 2, 3].map(() => cloudResult(transcript, overrides));
}

test('localDraft passes when 3/3 non-empty, stable and within limits', () => {
  const evaluation = evaluateLocalDraft(
    repeatedLocal('BAG C BEGGING REDUCES VERAS FIRES'),
  );
  assert.equal(evaluation.allNonEmpty, true);
  assert.equal(evaluation.stable, true);
  assert.equal(evaluation.resourcesPassed, true);
  assert.equal(evaluation.passed, true);
});

test('localDraft fails on an empty run, instability, or resource excess', () => {
  const empty = evaluateLocalDraft(
    repeatedLocal('text', { nonEmptyText: false, text: '' }),
  );
  assert.equal(empty.passed, false);
  const unstable = evaluateLocalDraft([
    localReport('a'),
    localReport('b'),
    localReport('a'),
  ]);
  assert.equal(unstable.stable, false);
  const oversized = evaluateLocalDraft(repeatedLocal('text', { rtf: 0.6 }));
  assert.equal(oversized.resourcesPassed, false);
});

test('cloudFinal passes at 100% recall with WER at the gate', () => {
  const evaluation = evaluateCloudFinal(repeatedCloud(V02_V_EXPECTED_TEXT));
  assert.equal(evaluation.termsComplete, true);
  assert.equal(evaluation.qualityPassed, true);
  assert.equal(evaluation.stable, true);
  assert.equal(evaluation.passed, true);
});

test('cloudFinal permits harmless transcript variation when every run meets the gates', () => {
  const results = repeatedCloud(V02_V_EXPECTED_TEXT);
  results[1].transcript = `Well, ${V02_V_EXPECTED_TEXT}`;
  const evaluation = evaluateCloudFinal(results);
  assert.equal(evaluation.stable, false);
  assert.equal(evaluation.passed, true);
});

test('cloudFinal fails on a missed term or excessive WER', () => {
  const missed = evaluateCloudFinal(
    repeatedCloud('Bagging and boosting are two classic ensemble methods.'),
  );
  // 缺后半句 8 个词：WER = 8/16 = 0.5，超过 0.35 门槛。
  assert.equal(missed.termsComplete, true);
  assert.equal(missed.qualityPassed, false);
  assert.equal(missed.passed, false);
  const lowRecall = evaluateCloudFinal(repeatedCloud('bagging only'));
  assert.equal(lowRecall.termsComplete, false);
  assert.equal(lowRecall.passed, false);
});

test('cloudFinal never records a Provider failure as success', () => {
  const failed = evaluateCloudFinal(
    repeatedCloud('', { errorCode: 'rate_limit', exitCode: 1, transcript: '' }),
  );
  assert.equal(failed.noFailure, false);
  assert.equal(failed.passed, false);
});

test('combined route requires cloudFinal not worse than localDraft', () => {
  const localDraft = evaluateLocalDraft(
    repeatedLocal('BAG C BEGGING REDUCES VERAS FIRES'),
  );
  const cloudFinal = evaluateCloudFinal(repeatedCloud(V02_V_EXPECTED_TEXT));
  const combined = evaluateCombined(localDraft, cloudFinal);
  assert.equal(combined.passed, true);
  const degraded = evaluateCombined(localDraft, {
    passed: false,
    allNonEmpty: false,
  });
  assert.equal(degraded.passed, false);
});

test('committed V02-V evidence is bounded and keeps V03 locked', () => {
  const raw = readFileSync(join(here, 'evidence/v02-v-summary.json'), 'utf8');
  const summary = JSON.parse(raw);
  assert.equal(summary.experiment, 'V02-V');
  assert.match(summary.cloudFinal.scope, /^(fixture-only|real-provider)$/);
  if (summary.cloudFinal.scope === 'fixture-only') {
    assert.equal(summary.verdict, 'BLOCKED');
    assert.equal(summary.blockerCode, 'BLOCKED_REAL_PROVIDER_EVIDENCE_MISSING');
  } else if (summary.combined.passed) {
    assert.equal(summary.verdict, 'REVIEW_REQUIRED');
    assert.equal(summary.blockerCode, null);
  } else {
    assert.equal(summary.verdict, 'BLOCKED_MODEL_OR_PROVIDER');
    assert.equal(summary.blockerCode, 'cloud_final_quality_gate_failed');
  }
  assert.equal(summary.v02Passed, false);
  assert.equal(summary.v03Unlocked, false);
  assert.equal(summary.failuresPassed, true);
  assert.equal(
    summary.unconfigured.blockerCode,
    'transcription_provider_not_configured',
  );
  assert.doesNotMatch(raw, /\/Users\/|\/home\/|\/tmp\//);
  assert.doesNotMatch(
    raw,
    /fixture-local-key-only|fixture-primary-key-only|apiKey/i,
  );
});
