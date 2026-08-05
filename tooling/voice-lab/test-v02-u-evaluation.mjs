import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideV02UVerdict,
  evaluateV02UGroup,
  normalizeTranscript,
  targetTermRecall,
  V02_U_NODE_VERSIONS,
  V02_U_PROFILES,
  V02_U_SCORES,
  wordErrorRate,
} from './v02-u-evaluation.mjs';

const expected =
  'Bagging and boosting are two classic ensemble methods. Bagging reduces variance, while boosting reduces bias.';
const here = dirname(fileURLToPath(import.meta.url));

function report(text, overrides = {}) {
  return {
    modelBytes: 100 * 1024 * 1024,
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
  const evaluation = evaluateV02UGroup(
    repeated(expected),
    repeated(expected),
    expected,
  );
  assert.equal(evaluation.hotwordGainRequired, false);
  assert.equal(evaluation.passed, true);
});

test('requires repeatable hotword gain when the baseline misses a term', () => {
  const before = expected.replaceAll('Bagging', 'Begging');
  const evaluation = evaluateV02UGroup(
    repeated(before),
    repeated(expected),
    expected,
  );
  assert.equal(evaluation.hotwordGainRequired, true);
  assert.equal(evaluation.hotwordGainObserved, true);
  assert.equal(evaluation.passed, true);
});

test('requires baseline quality too, not only corrected after quality', () => {
  // before 基础质量极差（WER 0.9），after 靠热词完全纠正：不得因此通过，
  // 否则热词表缺位时系统不可用，可用构造数据绕过基础质量门槛。
  const badBaseline = 'x x x x x x x x x x';
  const evaluation = evaluateV02UGroup(
    repeated(badBaseline),
    repeated(expected),
    expected,
  );
  assert.equal(evaluation.baselineQualityPassed, false);
  assert.equal(evaluation.afterQualityPassed, true);
  assert.equal(evaluation.passed, false);
});

test('fails on quality regression, instability, or a resource excess', () => {
  const degraded = evaluateV02UGroup(
    repeated(expected),
    repeated('Bagging boosting'),
    expected,
  );
  assert.equal(degraded.passed, false);
  const unstable = evaluateV02UGroup(
    repeated(expected),
    [report(expected), report('Bagging boosting'), report(expected)],
    expected,
  );
  assert.equal(unstable.stable, false);
  const oversized = evaluateV02UGroup(
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
  const evaluation = evaluateV02UGroup(repeated(expected), rejected, expected);
  assert.equal(evaluation.baselineResourcesPassed, true);
  assert.equal(evaluation.afterResourcesPassed, false);
  assert.equal(evaluation.hotwordCapabilityPassed, false);
  assert.equal(evaluation.passed, false);
});

test('unlocks V03 only when one profile+score passes on both declared Nodes', () => {
  const groups = completeMatrix(false);
  for (const group of groups) {
    if (group.profile === 'small-bilingual-int8' && group.score === 3.5) {
      group.evaluation = { ...group.evaluation, passed: true };
    }
  }
  const decision = decideV02UVerdict(groups);
  assert.equal(decision.verdict, 'PASS');
  assert.equal(decision.selectedProfile, 'small-bilingual-int8');
  assert.equal(decision.selectedScore, 3.5);
  assert.equal(decision.v02Passed, true);
  assert.equal(decision.v03Unlocked, true);
});

test('does not select a profile+score that passes on only one Node', () => {
  const groups = completeMatrix(false);
  const oneNode = groups.find(
    (group) =>
      group.node === 'v22.23.1' &&
      group.profile === 'small-bilingual-int8' &&
      group.score === 3.5,
  );
  assert.ok(oneNode);
  oneNode.evaluation = { ...oneNode.evaluation, passed: true };
  assert.equal(decideV02UVerdict(groups).verdict, 'BLOCKED_MODEL');
});

test('rejects incomplete or duplicate decision matrices as invalid evidence', () => {
  const groups = completeMatrix(false);
  assert.equal(
    decideV02UVerdict(groups.slice(1)).blockerCode,
    'evidence_matrix_invalid',
  );
  assert.equal(
    decideV02UVerdict([...groups.slice(1), groups[1]]).blockerCode,
    'evidence_matrix_invalid',
  );
  assert.equal(
    decideV02UVerdict([
      ...groups.slice(1),
      { ...groups[0], profile: 'not-declared' },
    ]).blockerCode,
    'evidence_matrix_invalid',
  );
});

test('reports hotword mode failure before a generic quality blocker', () => {
  const groups = completeMatrix(false);
  groups[0].evaluation = {
    ...groups[0].evaluation,
    hotwordCapabilityPassed: false,
  };
  assert.equal(
    decideV02UVerdict(groups).blockerCode,
    'hotword_mode_unsupported',
  );
});

test('reports a generic quality blocker when all gates fail', () => {
  assert.equal(
    decideV02UVerdict(completeMatrix(false)).blockerCode,
    'candidate_quality_gate_failed',
  );
});

function completeMatrix(passed) {
  const groups = [];
  for (const node of V02_U_NODE_VERSIONS) {
    for (const profile of V02_U_PROFILES) {
      for (const score of V02_U_SCORES) {
        groups.push({
          node,
          profile,
          score,
          evaluation: { passed, hotwordCapabilityPassed: true },
        });
      }
    }
  }
  return groups;
}

test('committed V02-U evidence is bounded and keeps V03 locked', () => {
  const raw = readFileSync(join(here, 'evidence/v02-u-summary.json'), 'utf8');
  const summary = JSON.parse(raw);
  assert.equal(summary.experiment, 'V02-U');
  assert.equal(summary.verdict, 'BLOCKED_MODEL');
  assert.equal(summary.blockerCode, 'candidate_quality_gate_failed');
  assert.equal(summary.v02Passed, false);
  assert.equal(summary.v03Unlocked, false);
  for (const model of Object.values(summary.models)) {
    assert.match(model.archiveSha256, /^[a-f0-9]{64}$/);
    assert.equal(model.quantization, 'int8');
  }
  assert.doesNotMatch(raw, /\/Users\/|\/home\/|\/tmp\//);
});
