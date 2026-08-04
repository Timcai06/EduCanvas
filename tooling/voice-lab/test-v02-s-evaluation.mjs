import assert from 'node:assert/strict';
import test from 'node:test';
import {
  containsTargetTerms,
  decideVerdict,
  evaluateGroup,
} from './v02-s-evaluation.mjs';

function report(text, overrides = {}) {
  return {
    modelBytes: 100 * 1024 * 1024,
    runs: [
      {
        text,
        error: null,
        rtf: 0.1,
        peakRssKiB: 512 * 1024,
        ...overrides,
      },
    ],
  };
}

test('matches target terms case-insensitively as whole words', () => {
  assert.equal(containsTargetTerms('bagging and BOOSTING'), true);
  assert.equal(containsTargetTerms('bag and boosted'), false);
  assert.equal(containsTargetTerms('BAGGINGBOOSTING'), false);
});

test('accepts a stable hotword correction within resource limits', () => {
  const group = evaluateGroup(
    [report('BEGGING'), report('BEGGING'), report('BEGGING')],
    [
      report('BAGGING BOOSTING'),
      report('BAGGING BOOSTING'),
      report('BAGGING BOOSTING'),
    ],
  );
  assert.equal(group.hotwordCorrected, true);
  assert.equal(group.baselineCapable, false);
  assert.equal(group.hotwordCorrected, true);
});

test('accepts only one profile and score that pass on both Node versions', () => {
  const groups = completeMatrix(false);
  for (const group of groups) {
    if (group.profile === 'small-bilingual-fp32' && group.score === 3.5) {
      group.hotwordCorrected = true;
    }
  }
  assert.deepEqual(decideVerdict(groups), {
    verdict: 'PASS_CANDIDATE',
    blockerCode: null,
    selectedProfile: 'small-bilingual-fp32',
    selectedScore: 3.5,
    v03Unlocked: false,
  });
});

test('does not select a candidate that passes on only one Node version', () => {
  const groups = completeMatrix(false);
  const oneNode = groups.find(
    (group) =>
      group.node === 'v22.23.1' &&
      group.profile === 'small-bilingual-fp32' &&
      group.score === 3.5,
  );
  assert.ok(oneNode);
  oneNode.hotwordCorrected = true;
  assert.equal(decideVerdict(groups).verdict, 'BLOCKED_MODEL');
});

test('rejects incomplete or duplicate decision matrices', () => {
  const groups = completeMatrix(false);
  assert.equal(decideVerdict(groups.slice(1)).verdict, 'REVISE_STRATEGY');
  assert.equal(
    decideVerdict([...groups.slice(1), groups[1]]).verdict,
    'REVISE_STRATEGY',
  );
  assert.equal(
    decideVerdict([
      ...groups.slice(1),
      { ...groups[0], profile: 'not-declared' },
    ]).verdict,
    'REVISE_STRATEGY',
  );
});

test('does not call an already-correct baseline a hotword correction', () => {
  const reports = [
    report('BAGGING BOOSTING'),
    report('BAGGING BOOSTING'),
    report('BAGGING BOOSTING'),
  ];
  const group = evaluateGroup(reports, reports);
  assert.equal(group.baselineCapable, true);
  assert.equal(group.hotwordCorrected, false);
});

test('fails the gate when one after run misses a target term', () => {
  const group = evaluateGroup(
    [report('BEGGING'), report('BEGGING'), report('BEGGING')],
    [report('BAGGING BOOSTING'), report('BAGGING'), report('BAGGING BOOSTING')],
  );
  assert.equal(group.hotwordCorrected, false);
  assert.equal(group.hotwordCorrected, false);
});

function completeMatrix(hotwordCorrected) {
  const groups = [];
  for (const node of ['v22.23.1', 'v24.18.0']) {
    for (const profile of ['current', 'small-bilingual-fp32']) {
      for (const score of [1.5, 2, 3.5]) {
        groups.push({ node, profile, score, hotwordCorrected });
      }
    }
  }
  return groups;
}

test('fails the gate when RTF or memory exceeds the predeclared limit', () => {
  const group = evaluateGroup(
    [report('BEGGING'), report('BEGGING'), report('BEGGING')],
    [
      report('BAGGING BOOSTING'),
      report('BAGGING BOOSTING', { rtf: 0.6 }),
      report('BAGGING BOOSTING'),
    ],
  );
  assert.equal(group.limitsPassed, false);
  assert.equal(group.hotwordCorrected, false);
});

test('rejects incomplete repetition evidence', () => {
  assert.throws(
    () => evaluateGroup([report('BEGGING')], [report('BAGGING BOOSTING')]),
    /incomplete_repetitions/,
  );
});
