import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideV02WVerdict,
  evaluateV02WResults,
  V02_W_EXPECTED_TEXT,
  V02_W_FIXTURE_SHA256,
  V02_W_MODEL_ID,
  V02_W_REPETITIONS,
} from './v02-w-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function cloudResult(transcript, overrides = {}) {
  return {
    provider: 'openai-compatible',
    resolvedModelId: V02_W_MODEL_ID,
    transcript,
    latencyMs: 600,
    language: 'english',
    durationSeconds: 10,
    fixtureSha256: V02_W_FIXTURE_SHA256,
    exitCode: 0,
    errorCode: null,
    ...overrides,
  };
}

function repeatedCloud(transcript, overrides) {
  return [1, 2, 3].map(() => cloudResult(transcript, overrides));
}

test('V02-W evaluation requires exactly 3 repetitions (fewer rejected)', () => {
  assert.throws(
    () => evaluateV02WResults(repeatedCloud(V02_W_EXPECTED_TEXT).slice(0, 2)),
    /incomplete_repetitions/,
  );
});

test('V02-W evaluation rejects more than 3 repetitions', () => {
  const four = repeatedCloud(V02_W_EXPECTED_TEXT);
  four.push(cloudResult(V02_W_EXPECTED_TEXT));
  assert.throws(() => evaluateV02WResults(four), /incomplete_repetitions/);
});

test('V02-W passes when every run meets every frozen gate', () => {
  const evaluation = evaluateV02WResults(repeatedCloud(V02_W_EXPECTED_TEXT));
  assert.equal(evaluation.noFailure, true);
  assert.equal(evaluation.allNonEmpty, true);
  assert.equal(evaluation.termsComplete, true);
  assert.equal(evaluation.qualityPassed, true);
  const decision = decideV02WVerdict(evaluation);
  assert.equal(decision.verdict, 'REVIEW_REQUIRED');
  assert.equal(decision.blockerCode, null);
});

test('V02-W permits transcript variation when every run still passes', () => {
  const results = repeatedCloud(V02_W_EXPECTED_TEXT);
  results[1].transcript = `Well, ${V02_W_EXPECTED_TEXT}`;
  const evaluation = evaluateV02WResults(results);
  assert.equal(evaluation.stable, false);
  assert.equal(evaluation.termsComplete, true);
  assert.equal(evaluation.qualityPassed, true);
  assert.equal(decideV02WVerdict(evaluation).verdict, 'REVIEW_REQUIRED');
});

test('missing Bagging in any run fails the term gate', () => {
  const results = repeatedCloud(V02_W_EXPECTED_TEXT);
  results[1].transcript =
    'boosting reduces bias, while boosting is repeated and the other term is missing';
  const evaluation = evaluateV02WResults(results);
  assert.equal(evaluation.perTermRecalls[1].bagging, 0);
  assert.equal(evaluation.perTermRecalls[1].boosting, 1);
  assert.equal(evaluation.termsComplete, false);
  const decision = decideV02WVerdict(evaluation);
  assert.equal(decision.verdict, 'BLOCKED_MODEL_OR_PROVIDER');
  assert.equal(decision.blockerCode, 'telespeech_quality_gate_failed');
});

test('missing Boosting in any run fails the term gate', () => {
  const results = repeatedCloud(V02_W_EXPECTED_TEXT);
  results[2].transcript =
    'bagging reduces variance, while bagging is repeated and the other term is missing';
  const evaluation = evaluateV02WResults(results);
  assert.equal(evaluation.perTermRecalls[2].boosting, 0);
  assert.equal(evaluation.perTermRecalls[2].bagging, 1);
  assert.equal(evaluation.termsComplete, false);
  assert.equal(
    decideV02WVerdict(evaluation).verdict,
    'BLOCKED_MODEL_OR_PROVIDER',
  );
});

test('one occurrence does not satisfy a target repeated twice in the reference', () => {
  const transcript =
    'Bagging and boosting are two classic assemble methodsbegging reduces variance while bursting reduces buyers.';
  const evaluation = evaluateV02WResults(repeatedCloud(transcript));
  assert.deepEqual(evaluation.perTermRecalls[0], {
    bagging: 0.5,
    boosting: 0.5,
  });
  assert.equal(evaluation.termsComplete, false);
  assert.equal(
    decideV02WVerdict(evaluation).verdict,
    'BLOCKED_MODEL_OR_PROVIDER',
  );
});

test('WER above the 0.35 gate in any run fails quality', () => {
  const results = repeatedCloud(V02_W_EXPECTED_TEXT);
  results[0].transcript = 'bagging only';
  const evaluation = evaluateV02WResults(results);
  assert.equal(evaluation.qualityPassed, false);
  assert.equal(
    decideV02WVerdict(evaluation).verdict,
    'BLOCKED_MODEL_OR_PROVIDER',
  );
});

test('a Provider error is never recorded as success', () => {
  const failed = evaluateV02WResults(
    repeatedCloud('', { exitCode: 1, errorCode: 'rate_limit' }),
  );
  assert.equal(failed.noFailure, false);
  assert.equal(decideV02WVerdict(failed).verdict, 'BLOCKED_MODEL_OR_PROVIDER');
});

test('an empty transcript is never recorded as success', () => {
  const empty = evaluateV02WResults(repeatedCloud(''));
  assert.equal(empty.allNonEmpty, false);
  assert.equal(decideV02WVerdict(empty).verdict, 'BLOCKED_MODEL_OR_PROVIDER');
});

test('REVIEW_REQUIRED still keeps v02Passed=false and v03Unlocked=false', () => {
  const summary = readSummary('v02-w-summary.json');
  const decision = decideV02WVerdict(
    evaluateV02WResults(
      [1, 2, 3].map((n) => ({
        provider: 'openai-compatible',
        resolvedModelId: V02_W_MODEL_ID,
        transcript: V02_W_EXPECTED_TEXT,
        latencyMs: 600,
        language: 'english',
        durationSeconds: 10,
        fixtureSha256: V02_W_FIXTURE_SHA256,
        exitCode: 0,
        errorCode: null,
      })),
    ),
  );
  assert.equal(decision.verdict, 'REVIEW_REQUIRED');
  assert.equal(summary.v02Passed, false);
  assert.equal(summary.v03Unlocked, false);
});

test('V03 is never unlocked by the experiment runner', () => {
  // verdict 无论 REVIEW_REQUIRED 还是 BLOCKED，V03 都必须保持锁定。
  const passing = decideV02WVerdict(
    evaluateV02WResults(repeatedCloud(V02_W_EXPECTED_TEXT)),
  );
  assert.equal(passing.verdict, 'REVIEW_REQUIRED');
  const summary = readSummary('v02-w-summary.json');
  assert.equal(summary.v03Unlocked, false);
  assert.equal(summary.v02Passed, false);
});

test('TeleSpeech evidence cannot overwrite the SenseVoice evidence', () => {
  const v02v = readSummary('v02-v-summary.json');
  const v02w = readSummary('v02-w-summary.json');
  assert.equal(v02v.experiment, 'V02-V');
  assert.equal(v02w.experiment, 'V02-W');
  assert.equal(v02v.cloudFinal.resolvedModelId, 'FunAudioLLM/SenseVoiceSmall');
  assert.equal(v02w.resolvedModelId, V02_W_MODEL_ID);
  assert.notEqual(v02v.cloudFinal.resolvedModelId, v02w.resolvedModelId);
});

test('SenseVoice and TeleSpeech summaries coexist on disk', () => {
  for (const name of ['v02-v-summary.json', 'v02-w-summary.json']) {
    const path = join(here, 'evidence', name);
    assert.ok(readFileSync(path, 'utf8').length > 0, `${name} is empty`);
  }
});

test('V02-W evidence contains no API key material', () => {
  const raw = readSummaryRaw('v02-w-summary.json');
  assert.doesNotMatch(raw, /apiKey|Bearer\s+|sk-[A-Za-z0-9]{8,}/i);
});

test('V02-W evidence contains no local absolute paths', () => {
  const raw = readSummaryRaw('v02-w-summary.json');
  assert.doesNotMatch(raw, /\/Users\/|\/home\/|\/tmp\//);
});

test('V02-W evidence contains no raw Provider body or stack trace', () => {
  const raw = readSummaryRaw('v02-w-summary.json');
  assert.doesNotMatch(raw, /\n\s*at\s+\S/);
  assert.doesNotMatch(raw, /"text"\s*:\s*\{/);
  assert.doesNotMatch(raw, /response\s*body/i);
});

test('V02-W summary records the real call runtime rather than the summarizer runtime', () => {
  const summary = readSummary('v02-w-summary.json');
  assert.equal(summary.runtime.node, 'v24.18.0');
});

function readSummary(name) {
  return JSON.parse(readSummaryRaw(name));
}

function readSummaryRaw(name) {
  return readFileSync(join(here, 'evidence', name), 'utf8');
}
