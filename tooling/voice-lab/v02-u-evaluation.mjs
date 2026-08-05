/**
 * V02-U evaluation: predeclared matrix constants and strict admission gates.
 *
 * 冻结矩阵（V02-U02）与判定门槛（V02-U05）集中在此模块，运行前写入。
 * Before/After 的唯一差异是 hotwords 文件；所有其它参数共享同一常量。
 */

export const V02_U_EXPERIMENT = 'V02-U';
export const V02_U_PROFILES = Object.freeze([
  'current-bilingual-int8',
  'small-bilingual-int8',
]);
export const V02_U_NODE_VERSIONS = Object.freeze(['v22.23.1', 'v24.18.0']);
export const V02_U_SCORES = Object.freeze([1.5, 2, 3.5]);
export const V02_U_REPETITIONS = 3;
export const V02_U_CHUNK_MS = 100;
export const V02_U_TAIL_SECONDS = 1.5;
export const V02_U_DECODING_METHOD = 'modified_beam_search';
export const V02_U_MAX_ACTIVE_PATHS = 4;
export const V02_U_HOTWORDS_FILE = 'fixtures/hotwords-v02-s.txt';
export const V02_U_MAX_WER = 0.35;
export const V02_U_MAX_RTF = 0.5;
export const V02_U_MAX_MODEL_BYTES = 250 * 1024 * 1024;
export const V02_U_MAX_RSS_KIB = 1.5 * 1024 * 1024;

const TARGET_TERMS = Object.freeze(['BAGGING', 'BOOSTING']);

export function normalizeTranscript(value) {
  return String(value)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function targetTermRecall(text) {
  const words = new Set(normalizeTranscript(text));
  const found = TARGET_TERMS.filter((term) => words.has(term)).length;
  return found / TARGET_TERMS.length;
}

export function wordErrorRate(reference, hypothesis) {
  const expected = normalizeTranscript(reference);
  const actual = normalizeTranscript(hypothesis);
  if (expected.length === 0) throw new Error('empty_reference');
  const previous = Array.from({ length: actual.length + 1 }, (_, i) => i);
  for (let row = 1; row <= expected.length; row++) {
    const current = [row];
    for (let column = 1; column <= actual.length; column++) {
      const substitution =
        previous[column - 1] +
        (expected[row - 1] === actual[column - 1] ? 0 : 1);
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[actual.length] / expected.length;
}

export function evaluateV02UGroup(beforeReports, afterReports, expectedText) {
  if (
    beforeReports.length !== V02_U_REPETITIONS ||
    afterReports.length !== V02_U_REPETITIONS
  ) {
    throw new Error('incomplete_repetitions');
  }
  const beforeRuns = beforeReports.map(singleRun);
  const afterRuns = afterReports.map(singleRun);
  const beforeWer = beforeRuns.map((run) =>
    wordErrorRate(expectedText, run.text),
  );
  const afterWer = afterRuns.map((run) =>
    wordErrorRate(expectedText, run.text),
  );
  const beforeRecall = beforeRuns.map((run) => targetTermRecall(run.text));
  const afterRecall = afterRuns.map((run) => targetTermRecall(run.text));
  const hotwordCapabilityPassed = afterRuns.every((run) => run.error === null);
  const reportResourcesPassed = (report) => {
    const run = singleRun(report);
    return (
      run.error === null &&
      run.rtf <= V02_U_MAX_RTF &&
      run.peakRssKiB <= V02_U_MAX_RSS_KIB &&
      report.modelBytes <= V02_U_MAX_MODEL_BYTES
    );
  };
  const baselineResourcesPassed = beforeReports.every(reportResourcesPassed);
  const afterResourcesPassed = afterReports.every(reportResourcesPassed);
  const resourcesPassed = baselineResourcesPassed && afterResourcesPassed;
  const baselineTermsComplete = beforeRecall.every((value) => value === 1);
  const afterTermsComplete = afterRecall.every((value) => value === 1);
  const baselineQualityPassed = beforeWer.every(
    (value) => value <= V02_U_MAX_WER,
  );
  const afterQualityPassed = afterWer.every((value) => value <= V02_U_MAX_WER);
  const afterNotWorse = afterWer.every(
    (value, index) =>
      value <= beforeWer[index] && afterRecall[index] >= beforeRecall[index],
  );
  // Before 已正确识别目标词时无需增益；漏词时 After 必须在 3/3 不劣化的
  // 前提下至少一次稳定提升召回率，才计为可重复增益（V02-U05）。
  const hotwordGainRequired = !baselineTermsComplete;
  const hotwordGainObserved = afterRecall.some(
    (value, index) => value > beforeRecall[index],
  );
  const stable =
    new Set(beforeRuns.map((run) => normalizeTranscript(run.text).join(' ')))
      .size === 1 &&
    new Set(afterRuns.map((run) => normalizeTranscript(run.text).join(' ')))
      .size === 1;

  return {
    passed:
      resourcesPassed &&
      hotwordCapabilityPassed &&
      stable &&
      // 基础识别质量是独立门槛：无热词的 before 也须满足 WER ≤ 0.35，
      // 否则热词表缺位时系统不可用，不允许用热词掩盖基础质量缺陷（V02-U05）。
      baselineQualityPassed &&
      afterTermsComplete &&
      afterQualityPassed &&
      afterNotWorse &&
      (!hotwordGainRequired || hotwordGainObserved),
    resourcesPassed,
    baselineResourcesPassed,
    afterResourcesPassed,
    hotwordCapabilityPassed,
    stable,
    baselineTermsComplete,
    baselineQualityPassed,
    afterTermsComplete,
    afterQualityPassed,
    afterNotWorse,
    hotwordGainRequired,
    hotwordGainObserved,
    beforeRecall,
    afterRecall,
    beforeWer,
    afterWer,
    beforeTexts: beforeRuns.map((run) => run.text),
    afterTexts: afterRuns.map((run) => run.text),
    errors: {
      before: beforeRuns.map((run) => run.error),
      after: afterRuns.map((run) => run.error),
    },
    rtfRange: range([...beforeRuns, ...afterRuns].map((run) => run.rtf)),
    peakRssKiBRange: range(
      [...beforeRuns, ...afterRuns].map((run) => run.peakRssKiB),
    ),
  };
}

export function decideV02UVerdict(groups) {
  const expectedKeys = new Set();
  for (const node of V02_U_NODE_VERSIONS) {
    for (const profile of V02_U_PROFILES) {
      for (const score of V02_U_SCORES) {
        expectedKeys.add(matrixKey(node, profile, score));
      }
    }
  }
  const groupKeys = new Set(groups.map((group) => matrixKeyFor(group)));
  if (
    groups.length !== expectedKeys.size ||
    groupKeys.size !== expectedKeys.size ||
    [...groupKeys].some((key) => !expectedKeys.has(key))
  ) {
    return blocked('evidence_matrix_invalid');
  }
  for (const profile of V02_U_PROFILES) {
    for (const score of V02_U_SCORES) {
      const crossNode = V02_U_NODE_VERSIONS.map((node) =>
        groups.find(
          (group) =>
            group.node === node &&
            group.profile === profile &&
            group.score === score,
        ),
      );
      if (crossNode.every((group) => group?.evaluation?.passed === true)) {
        return {
          verdict: 'PASS',
          blockerCode: null,
          selectedProfile: profile,
          selectedScore: score,
          v02Passed: true,
          v03Unlocked: true,
        };
      }
    }
  }
  if (groups.some((group) => !group.evaluation.hotwordCapabilityPassed)) {
    return blocked('hotword_mode_unsupported');
  }
  return blocked('candidate_quality_gate_failed');
}

function matrixKey(node, profile, score) {
  return `${node}|${profile}|${score}`;
}

function matrixKeyFor(group) {
  return matrixKey(group.node, group.profile, group.score);
}

function singleRun(report) {
  if (!report || !Array.isArray(report.runs) || report.runs.length !== 1) {
    throw new Error('invalid_single_run_report');
  }
  return report.runs[0];
}

function range(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0
    ? null
    : { min: Math.min(...finite), max: Math.max(...finite) };
}

function blocked(blockerCode) {
  return {
    verdict: 'BLOCKED_MODEL',
    blockerCode,
    selectedProfile: null,
    selectedScore: null,
    v02Passed: false,
    v03Unlocked: false,
  };
}
