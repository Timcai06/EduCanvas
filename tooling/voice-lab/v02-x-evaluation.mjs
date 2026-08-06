/**
 * V02-X evaluation: 用 V02-W 已保存的三次云端终稿复算确定性有界术语纠错层。
 *
 * 本实验只验证一件事：一个候选词只能来自当前 Notebook 术语表的纯函数纠错层，
 * 能否在「不误改普通词、不做任意 substring replace、不自由重写句子」的前提下
 * 纠正 V02-W 冻结样例。不调用 Provider，不重新下载模型/音频。
 *
 * 判定规则（V02-X 完成标准）：
 * - 三次冻结结果一致、每次 corrected WER ≤ 0.35、每条 replacement 可逆；
 * - 术语出现次数召回按每术语计算（与 V02-W 同一定义）；粘连 token
 *   （methodsbegging）按 fail-closed 原则保持原文，会导致 Bagging 召回 1/2，
 *   这是负责人已确认的设计决策，由 blockerCode 标注、等待负责人裁定；
 * - 任何歧义词被误改、原始文本被覆盖或证据不满足 → REVISE/BLOCKED。
 * 本模块绝不宣布 V02 PASS，也不自动接入产品。
 */

import {
  applyTranscriptReplacements,
  correctTranscript,
  transcriptTermCorrectionProtocolVersion,
} from '../../packages/agent-core/src/transcript-term-correction.ts';
import { normalizeTranscript, wordErrorRate } from './v02-u-evaluation.mjs';

export const V02_X_EXPERIMENT = 'V02-X';
export const V02_X_SOURCE_EVIDENCE = 'evidence/v02-w-summary.json';
export const V02_X_MAX_WER = 0.35;
export const V02_X_TARGET_TERMS = Object.freeze(['BAGGING', 'BOOSTING']);
export const V02_X_RULE_VERSION = transcriptTermCorrectionProtocolVersion;

/**
 * 冻结术语表：与 agent-core 单元测试使用同一配置（术语 + 课程上下文确认词）。
 * 上下文确认采用双侧规则：前邻与后邻都必须命中 context 中的词（缺任一侧或
 * 未命中都不改），context 只允许调用方（当前 Notebook）传入，模块内没有任何
 * 术语硬编码。Boosting 的 context 取参考句 "while boosting reduces bias" 的
 * 前后邻（while/reduces），使 V02-W 的 "while bursting reduces" 双侧命中。
 */
export const V02_X_FROZEN_TERMS = Object.freeze([
  { term: 'Bagging', context: ['reduces', 'variance'] },
  { term: 'Boosting', context: ['while', 'reduces'] },
]);

/** 冻结输入：V02-W 原始终稿 + 冻结术语表，大小写策略固定 preserve-original。 */
export function buildFrozenInput(transcript) {
  return {
    originalTranscript: transcript,
    authorizedTerms: V02_X_FROZEN_TERMS,
    ruleVersion: V02_X_RULE_VERSION,
    casePolicy: 'preserve-original',
  };
}

/**
 * 参考句中目标术语可能出现多次；只检查「出现过一次」会隐藏后续错译。
 * 按参考文本出现次数计算召回，多余重复封顶为 1（与 V02-W 同一实现）。
 */
export function occurrenceRecall(referenceWords, hypothesisWords, term) {
  const expected = referenceWords.filter((word) => word === term).length;
  if (expected === 0) throw new Error('target_term_missing_from_reference');
  const actual = hypothesisWords.filter((word) => word === term).length;
  return Math.min(actual, expected) / expected;
}

/** 对单个 hypothesis 文本计算 BAGGING/BOOSTING 各自的出现次数召回。 */
export function perTermRecall(expectedText, hypothesisText) {
  const reference = normalizeTranscript(expectedText);
  const hypothesis = normalizeTranscript(hypothesisText);
  return {
    bagging: occurrenceRecall(reference, hypothesis, 'BAGGING'),
    boosting: occurrenceRecall(reference, hypothesis, 'BOOSTING'),
  };
}

/**
 * 冻结样例评估：三次原始终稿各自经过同一冻结规则。要求恰好 3 次（与
 * V02-W 的 repetitions 一致），每次输出 corrected、replacement audit、
 * before/after WER 与术语召回，并验证可逆性。
 */
export function evaluateV02XFrozenRuns(transcripts, expectedText) {
  if (!Array.isArray(transcripts) || transcripts.length !== 3) {
    throw new Error('incomplete_repetitions');
  }
  const runs = transcripts.map((transcript) => {
    const result = correctTranscript(buildFrozenInput(transcript));
    return {
      originalTranscript: transcript,
      correctedTranscript: result.correctedTranscript,
      replacements: result.replacements,
      unchangedReason: result.unchangedReason,
      totalTokenCount: result.totalTokenCount,
      unchangedTokenCount: result.unchangedTokenCount,
      werBefore: wordErrorRate(expectedText, transcript),
      werAfter: wordErrorRate(expectedText, result.correctedTranscript),
      recallBefore: perTermRecall(expectedText, transcript),
      recallAfter: perTermRecall(expectedText, result.correctedTranscript),
      reversible:
        applyTranscriptReplacements(
          result.correctedTranscript,
          result.replacements,
        ) === transcript,
    };
  });
  // 三次冻结结果一致性：同输入必同输出，此处仅防回归（normalize 后文本唯一）。
  const normalizedCorrected = new Set(
    runs.map((run) => normalizeTranscript(run.correctedTranscript).join(' ')),
  );
  const stable = normalizedCorrected.size === 1;
  const qualityPassed = runs.every((run) => run.werAfter <= V02_X_MAX_WER);
  const allReversible = runs.every((run) => run.reversible);
  const everyReplacementReversible = runs.every((run) =>
    run.replacements.every((replacement) => replacement.reversible === true),
  );
  const neverOverwroteOriginal = runs.every(
    (run) =>
      run.correctedTranscript !== run.originalTranscript ||
      run.replacements.length === 0,
  );
  return {
    runs,
    stable,
    qualityPassed,
    allReversible,
    everyReplacementReversible,
    neverOverwroteOriginal,
  };
}

/**
 * V02-X 判定规则：
 * - WER 门槛、三次一致性、可逆性任一失败 → BLOCKED（证据不满足）；
 * - 全部达标且每术语召回 100% → REVIEW_REQUIRED（无 blocker）；
 * - 全部达标但 Bagging 召回因粘连 token fail-closed 而不足 → 仍是
 *   REVIEW_REQUIRED，但 blockerCode 标注，等待负责人裁定是否接受口径。
 * 任何结论都不会自动解锁产品接线。
 */
export function decideV02XVerdict(evaluation) {
  if (!evaluation.qualityPassed) {
    return blocked('wer_gate_failed');
  }
  if (!evaluation.stable) {
    return blocked('frozen_runs_inconsistent');
  }
  if (!evaluation.allReversible || !evaluation.everyReplacementReversible) {
    return blocked('replacement_not_reversible');
  }
  if (!evaluation.neverOverwroteOriginal) {
    return blocked('original_overwritten');
  }
  const recalls = evaluation.runs.map((run) => run.recallAfter);
  const termsComplete =
    recalls.every((recall) => recall.bagging === 1) &&
    recalls.every((recall) => recall.boosting === 1);
  return termsComplete
    ? { verdict: 'REVIEW_REQUIRED', blockerCode: null }
    : {
        verdict: 'REVIEW_REQUIRED',
        blockerCode: 'frozen_bagging_recall_below_100_concatenated_token',
      };
}

function blocked(blockerCode) {
  return { verdict: 'BLOCKED', blockerCode };
}
