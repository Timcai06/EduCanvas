/**
 * V02-V evaluation: predeclared dual-path matrix constants and gate rules.
 *
 * 冻结矩阵（V02-V01）与验收指标（V02-V04）集中在此模块，运行前写入：
 * - localDraft：small bilingual INT8 WASM 的实时草稿输出（复用 V02-U 配置，无热词）；
 * - cloudFinal：现有 AudioTranscriptionModelGateway（OpenAI-compatible）高质量终稿；
 * - expected：固定参考文本。
 * 每条路径运行 3 次；normalization / WER / 目标词召回计算规则复用 V02-U 同一套实现。
 */

import {
  normalizeTranscript,
  targetTermRecall,
  wordErrorRate,
} from './v02-u-evaluation.mjs';

export const V02_V_EXPERIMENT = 'V02-V';
export const V02_V_EXPECTED_TEXT =
  'Bagging and boosting are two classic ensemble methods. Bagging reduces variance, while boosting reduces bias.';
export const V02_V_FIXTURE_SHA256 =
  '7c09702fea55705d69643bf87e4673c247c1068462ad68dbd357735f9256c216';
export const V02_V_FIXTURE_RELATIVE_PATH = 'fixtures/generated/v02-s-human.wav';
export const V02_V_REPETITIONS = 3;
export const V02_V_LOCAL_PROFILE = 'small-bilingual-int8';
export const V02_V_MAX_RTF = 0.5;
export const V02_V_MAX_RSS_KIB = 1.5 * 1024 * 1024;
export const V02_V_MAX_WER = 0.35;

export const TARGET_TERMS = Object.freeze(['BAGGING', 'BOOSTING']);

export function containsTargetTerms(text) {
  const words = new Set(normalizeTranscript(text));
  return TARGET_TERMS.every((term) => words.has(term));
}

/** localDraft 门槛：3/3 非空、3/3 稳定执行、RTF/RSS 达标；只作为草稿不要求 WER。 */
export function evaluateLocalDraft(reports) {
  if (reports.length !== V02_V_REPETITIONS) {
    throw new Error('incomplete_repetitions');
  }
  const runs = reports.map((report) => {
    if (!report || !Array.isArray(report.runs) || report.runs.length !== 1) {
      throw new Error('invalid_single_run_report');
    }
    return report.runs[0];
  });
  const allNonEmpty = runs.every(
    (run) => run.error === null && run.nonEmptyText,
  );
  const stable =
    new Set(runs.map((run) => normalizeTranscript(run.text).join(' '))).size ===
    1;
  const resourcesPassed = runs.every(
    (run) => run.rtf <= V02_V_MAX_RTF && run.peakRssKiB <= V02_V_MAX_RSS_KIB,
  );
  return {
    passed: allNonEmpty && stable && resourcesPassed,
    allNonEmpty,
    stable,
    resourcesPassed,
    texts: runs.map((run) => run.text),
    rtfRange: range(runs.map((run) => run.rtf)),
    peakRssKiBRange: range(runs.map((run) => run.peakRssKiB)),
    wers: runs.map((run) => wordErrorRate(V02_V_EXPECTED_TEXT, run.text)),
  };
}

/** cloudFinal 硬门槛：召回 100%、WER ≤ 0.35、3/3 一致或差异不影响门槛、无泄漏。 */
export function evaluateCloudFinal(results) {
  if (results.length !== V02_V_REPETITIONS) {
    throw new Error('incomplete_repetitions');
  }
  const texts = results.map((result) => result.transcript);
  const recalls = texts.map((text) => targetTermRecall(text));
  const wers = texts.map((text) => wordErrorRate(V02_V_EXPECTED_TEXT, text));
  const stable =
    new Set(texts.map((text) => normalizeTranscript(text).join(' '))).size ===
    1;
  const termsComplete = recalls.every((recall) => recall === 1);
  const qualityPassed = wers.every((wer) => wer <= V02_V_MAX_WER);
  const noFailure = results.every((result) => result.errorCode === null);
  return {
    passed: noFailure && termsComplete && qualityPassed,
    noFailure,
    stable,
    termsComplete,
    qualityPassed,
    texts,
    recalls,
    wers,
    latencyMs: range(results.map((result) => result.latencyMs)),
    errors: results.map((result) => result.errorCode),
  };
}

/** 组合路线：cloudFinal 不得比 localDraft 更差；本地失败显示 unavailable。 */
export function evaluateCombined(localDraft, cloudFinal) {
  if (!localDraft || !cloudFinal) {
    return { passed: false, cloudNotWorse: false };
  }
  const localWorst = Math.max(
    ...(localDraft.wers ?? [Number.POSITIVE_INFINITY]),
  );
  const cloudWorst = Math.max(
    ...(cloudFinal.wers ?? [Number.POSITIVE_INFINITY]),
  );
  const cloudNotWorse =
    cloudFinal.passed &&
    (localDraft.passed || localDraft.allNonEmpty) &&
    cloudWorst <= localWorst;
  return { passed: cloudNotWorse, cloudNotWorse };
}

function range(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0
    ? null
    : { min: Math.min(...finite), max: Math.max(...finite) };
}
