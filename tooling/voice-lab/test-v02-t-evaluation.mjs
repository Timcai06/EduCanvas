import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideV02TVerdict,
  evaluateNodeGroup,
  normalizeTranscript,
  targetTermRecall,
  wordErrorRate,
} from './v02-t-evaluation.mjs';

const expected =
  'Bagging and boosting are two classic ensemble methods. Bagging reduces variance, while boosting reduces bias.';
const here = dirname(fileURLToPath(import.meta.url));

function report(text, overrides = {}) {
  return {
    modelBytes: 200 * 1024 * 1024,
    runs: [{ text, error: null, rtf: 0.2, peakRssKiB: 500000, ...overrides }],
  };
}

function repeated(text, overrides) {
  return [
    report(text, overrides),
    report(text, overrides),
    report(text, overrides),
  ];
}

test('normalizes punctuation and matches target terms as whole words', () => {
  assert.deepEqual(normalizeTranscript('Bagging, BOOSTING!'), [
    'BAGGING',
    'BOOSTING',
  ]);
  assert.equal(targetTermRecall('bagging and boosting'), 1);
  assert.equal(targetTermRecall('begging and boosting'), 0.5);
});

test('computes normalized word error rate', () => {
  assert.equal(wordErrorRate('one two three', 'one two three'), 0);
  assert.equal(wordErrorRate('one two three', 'one four three'), 1 / 3);
});

test('passes an already-correct baseline when hotwords do not regress it', () => {
  const evaluation = evaluateNodeGroup(
    repeated(expected),
    repeated(expected),
    expected,
  );
  assert.equal(evaluation.hotwordGainRequired, false);
  assert.equal(evaluation.passed, true);
});

test('requires repeatable hotword gain when the baseline misses a term', () => {
  const before = expected.replaceAll('Bagging', 'Begging');
  const evaluation = evaluateNodeGroup(
    repeated(before),
    repeated(expected),
    expected,
  );
  assert.equal(evaluation.hotwordGainRequired, true);
  assert.equal(evaluation.hotwordGainObserved, true);
  assert.equal(evaluation.passed, true);
});

test('fails on quality regression, instability, or a resource excess', () => {
  const degraded = evaluateNodeGroup(
    repeated(expected),
    repeated('Bagging boosting'),
    expected,
  );
  assert.equal(degraded.passed, false);
  const unstable = evaluateNodeGroup(
    repeated(expected),
    [report(expected), report('Bagging boosting'), report(expected)],
    expected,
  );
  assert.equal(unstable.stable, false);
  const oversized = evaluateNodeGroup(
    repeated(expected),
    repeated(expected, { rtf: 0.6 }),
    expected,
  );
  assert.equal(oversized.resourcesPassed, false);
});

test('fails closed when the candidate cannot execute hotword mode', () => {
  const rejected = repeated('', {
    error: 'hotwords_not_supported_by_profile',
    rtf: undefined,
    peakRssKiB: undefined,
  });
  const evaluation = evaluateNodeGroup(repeated(expected), rejected, expected);
  assert.equal(evaluation.baselineResourcesPassed, true);
  assert.equal(evaluation.afterResourcesPassed, false);
  assert.equal(evaluation.hotwordCapabilityPassed, false);
  assert.equal(evaluation.passed, false);
  assert.equal(
    decideV02TVerdict([
      { node: 'v22.23.1', evaluation },
      { node: 'v24.18.0', evaluation },
    ]).blockerCode,
    'hotword_mode_unsupported',
  );
});

test('unlocks V03 only when both declared Node groups pass', () => {
  const passing = { passed: true };
  assert.equal(
    decideV02TVerdict([
      { node: 'v22.23.1', evaluation: passing },
      { node: 'v24.18.0', evaluation: passing },
    ]).v03Unlocked,
    true,
  );
  assert.equal(
    decideV02TVerdict([
      { node: 'v22.23.1', evaluation: passing },
      { node: 'v24.18.0', evaluation: { passed: false } },
    ]).v03Unlocked,
    false,
  );
});

test('committed V02-T evidence is bounded and keeps V03 locked', () => {
  const raw = readFileSync(join(here, 'evidence/v02-t-summary.json'), 'utf8');
  const summary = JSON.parse(raw);
  assert.equal(summary.experiment, 'V02-T');
  assert.equal(summary.verdict, 'BLOCKED_MODEL');
  assert.equal(summary.blockerCode, 'hotword_mode_unsupported');
  assert.equal(summary.v02Passed, false);
  assert.equal(summary.v03Unlocked, false);
  assert.match(summary.model.archiveSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(raw, /\/Users\/|\/home\/|\/tmp\//);
});
