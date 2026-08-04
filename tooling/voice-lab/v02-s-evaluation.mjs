export const V02_S_PROFILES = Object.freeze([
  'current',
  'small-bilingual-fp32',
]);
export const V02_S_NODE_VERSIONS = Object.freeze(['v22.23.1', 'v24.18.0']);
export const V02_S_SCORES = Object.freeze([1.5, 2, 3.5]);
export const V02_S_REPETITIONS = 3;
export const V02_S_MAX_RTF = 0.5;
export const V02_S_MAX_MODEL_BYTES = 250 * 1024 * 1024;
export const V02_S_MAX_RSS_KIB = 1.5 * 1024 * 1024;

const TARGET_TERMS = Object.freeze(['BAGGING', 'BOOSTING']);

export function containsTargetTerms(text) {
  const words = String(text)
    .toUpperCase()
    .match(/[A-Z]+/g);
  const vocabulary = new Set(words ?? []);
  return TARGET_TERMS.every((term) => vocabulary.has(term));
}

export function evaluateGroup(beforeReports, afterReports) {
  if (
    beforeReports.length !== V02_S_REPETITIONS ||
    afterReports.length !== V02_S_REPETITIONS
  ) {
    throw new Error('incomplete_repetitions');
  }

  const reports = [...beforeReports, ...afterReports];
  const runs = reports.map(singleRun);
  const beforeCorrect = beforeReports.map((report) =>
    containsTargetTerms(singleRun(report).text),
  );
  const afterCorrect = afterReports.map((report) =>
    containsTargetTerms(singleRun(report).text),
  );
  const limitsPassed = reports.every((report) => {
    const run = singleRun(report);
    return (
      run.error === null &&
      run.rtf <= V02_S_MAX_RTF &&
      run.peakRssKiB <= V02_S_MAX_RSS_KIB &&
      report.modelBytes <= V02_S_MAX_MODEL_BYTES
    );
  });

  return {
    beforeCorrect,
    afterCorrect,
    baselineCapable: beforeCorrect.every(Boolean),
    hotwordCorrected:
      beforeCorrect.some((correct) => !correct) &&
      afterCorrect.every(Boolean) &&
      limitsPassed,
    limitsPassed,
    beforeTexts: beforeReports.map((report) => singleRun(report).text),
    afterTexts: afterReports.map((report) => singleRun(report).text),
    rtfRange: range(runs.map((run) => run.rtf)),
    peakRssKiBRange: range(runs.map((run) => run.peakRssKiB)),
  };
}

export function decideVerdict(groups) {
  const keys = new Set(
    groups.map((group) => `${group.node}|${group.profile}|${group.score}`),
  );
  const expectedKeys = new Set();
  for (const node of V02_S_NODE_VERSIONS) {
    for (const profile of V02_S_PROFILES) {
      for (const score of V02_S_SCORES) {
        expectedKeys.add(`${node}|${profile}|${score}`);
      }
    }
  }
  if (
    groups.length !== expectedKeys.size ||
    keys.size !== expectedKeys.size ||
    [...keys].some((key) => !expectedKeys.has(key))
  ) {
    return {
      verdict: 'REVISE_STRATEGY',
      blockerCode: 'evidence_matrix_invalid',
      selectedProfile: null,
      selectedScore: null,
      v03Unlocked: false,
    };
  }

  for (const profile of V02_S_PROFILES) {
    for (const score of V02_S_SCORES) {
      const crossNode = V02_S_NODE_VERSIONS.map((node) =>
        groups.find(
          (group) =>
            group.node === node &&
            group.profile === profile &&
            group.score === score,
        ),
      );
      if (crossNode.every((group) => group?.hotwordCorrected === true)) {
        return {
          verdict: 'PASS_CANDIDATE',
          blockerCode: null,
          selectedProfile: profile,
          selectedScore: score,
          v03Unlocked: false,
        };
      }
    }
  }
  return {
    verdict: 'BLOCKED_MODEL',
    blockerCode: 'target_terms_not_corrected',
    selectedProfile: null,
    selectedScore: null,
    v03Unlocked: false,
  };
}

function singleRun(report) {
  if (!report || !Array.isArray(report.runs) || report.runs.length !== 1) {
    throw new Error('invalid_single_run_report');
  }
  return report.runs[0];
}

function range(values) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
