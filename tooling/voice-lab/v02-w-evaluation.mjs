/**
 * V02-W evaluation: TeleSpeechASR cloudFinal 真实对照实验的冻结常量与判定规则。
 *
 * 本实验只回答一个问题：用与 V02-V 完全相同的授权真人录音、参考文本、次数和
 * 质量门槛，TeleAI/TeleSpeechASR 能否作为「本地 WASM 草稿 + 云端高质量终稿」
 * 路线的 cloudFinal。normalization / WER / 目标词召回复用 V02-U 同一套实现，
 * 不重新发明公共算法；本模块只声明 V02-W 专属常量与判定（V02-W04）。
 */

import {
  normalizeTranscript,
  targetTermRecall,
  wordErrorRate,
} from './v02-u-evaluation.mjs';

export const V02_W_EXPERIMENT = 'V02-W';
export const V02_W_EXPECTED_TEXT =
  'Bagging and boosting are two classic ensemble methods. Bagging reduces variance, while boosting reduces bias.';
export const V02_W_FIXTURE_SHA256 =
  '7c09702fea55705d69643bf87e4673c247c1068462ad68dbd357735f9256c216';
export const V02_W_FIXTURE_RELATIVE_PATH = 'fixtures/generated/v02-s-human.wav';
export const V02_W_REPETITIONS = 3;
export const V02_W_MODEL_ID = 'TeleAI/TeleSpeechASR';
export const V02_W_BASE_URL_HOST = 'api.siliconflow.cn';
export const V02_W_MAX_WER = 0.35;

export const V02_W_TARGET_TERMS = Object.freeze(['BAGGING', 'BOOSTING']);

/**
 * 三次 cloudFinal 结果的质量判定。长度不是 3（少于或多于）都直接抛错，
 * 判定前先保证实验恰好发生 3 次调用；transcript 文字差异不构成自动失败
 * （与 V02-V 一致，stable 只作报告值，不进门槛）。
 */
export function evaluateV02WResults(results) {
  if (!Array.isArray(results) || results.length !== V02_W_REPETITIONS) {
    throw new Error('incomplete_repetitions');
  }
  const texts = results.map((result) => result.transcript ?? '');
  const wers = texts.map((text) => wordErrorRate(V02_W_EXPECTED_TEXT, text));
  const expectedWords = normalizeTranscript(V02_W_EXPECTED_TEXT);
  const perTermRecalls = texts.map((text) => {
    const words = normalizeTranscript(text);
    return {
      bagging: occurrenceRecall(expectedWords, words, 'BAGGING'),
      boosting: occurrenceRecall(expectedWords, words, 'BOOSTING'),
    };
  });
  const recalls = perTermRecalls.map(
    ({ bagging, boosting }) => (bagging + boosting) / V02_W_TARGET_TERMS.length,
  );
  const noFailure = results.every(
    (result) => result.exitCode === 0 && (result.errorCode ?? null) === null,
  );
  const allNonEmpty = texts.every(
    (text) => normalizeTranscript(text).length > 0,
  );
  const termsComplete = perTermRecalls.every(
    ({ bagging, boosting }) => bagging === 1 && boosting === 1,
  );
  const qualityPassed = wers.every((wer) => wer <= V02_W_MAX_WER);
  const stable =
    new Set(texts.map((text) => normalizeTranscript(text).join(' '))).size ===
    1;
  return {
    noFailure,
    allNonEmpty,
    termsComplete,
    qualityPassed,
    stable,
    texts,
    wers,
    recalls,
    perTermRecalls,
    latencyMs: range(results.map((result) => result.latencyMs)),
    errors: results.map((result) => result.errorCode ?? null),
  };
}

/**
 * V02-W04 判定规则：
 * A. 三次均满足全部门槛（成功、非空、术语 100%、WER ≤ 0.35）
 *    → REVIEW_REQUIRED / blockerCode=null，等待 Codex 决定是否接受路线；
 * B. 任一次术语、WER、空文本、错误或稳定执行门槛失败
 *    → BLOCKED_MODEL_OR_PROVIDER / blockerCode=telespeech_quality_gate_failed。
 * 两种结论都保持 v02Passed=false、v03Unlocked=false：实验 runner 永远无权
 * 自行宣布 V02 PASS，也永远不能自动解锁 V03。
 */
export function decideV02WVerdict(evaluation) {
  const gatePassed =
    evaluation.noFailure &&
    evaluation.allNonEmpty &&
    evaluation.termsComplete &&
    evaluation.qualityPassed;
  return gatePassed
    ? { verdict: 'REVIEW_REQUIRED', blockerCode: null }
    : {
        verdict: 'BLOCKED_MODEL_OR_PROVIDER',
        blockerCode: 'telespeech_quality_gate_failed',
      };
}

function range(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0
    ? null
    : { min: Math.min(...finite), max: Math.max(...finite) };
}

/**
 * 参考句中目标术语可能出现多次。只检查“全文是否出现过一次”会把后续同一术语的
 * 错译隐藏掉；终稿门槛因此按参考文本中的出现次数计算召回，并把多余重复封顶为 1。
 */
function occurrenceRecall(referenceWords, hypothesisWords, term) {
  const expected = referenceWords.filter((word) => word === term).length;
  if (expected === 0) throw new Error('target_term_missing_from_reference');
  const actual = hypothesisWords.filter((word) => word === term).length;
  return Math.min(actual, expected) / expected;
}
