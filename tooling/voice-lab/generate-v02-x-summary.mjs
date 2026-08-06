/**
 * V02-X summary builder: 从 evidence/v02-w-summary.json 的三次冻结终稿复算
 * 纠错层指标，生成有界 evidence/v02-x-summary.json。
 *
 * 结论只由 v02-x-evaluation.mjs 的判定规则驱动（REVIEW_REQUIRED 或
 * BLOCKED），本脚本不修改任何阈值、参考文本或 normalization，也不挑选
 * 有利结果；不调用 Provider，不重新下载模型/音频。摘要不含 Key、绝对路径、
 * Provider body 或 stack。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_EDIT_DISTANCE,
  MAX_TRANSCRIPT_LENGTH,
} from '../../packages/agent-core/src/transcript-term-correction.ts';
import {
  V02_X_EXPERIMENT,
  V02_X_FROZEN_TERMS,
  V02_X_MAX_WER,
  V02_X_SOURCE_EVIDENCE,
  decideV02XVerdict,
  evaluateV02XFrozenRuns,
} from './v02-x-evaluation.mjs';
import { V02_W_EXPECTED_TEXT } from './v02-w-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const source = readJson(join(here, V02_X_SOURCE_EVIDENCE));
if (source.experiment !== 'V02-W') {
  fail('V02-X source must be the V02-W summary.');
}
const transcripts = source.runs.map((run) => run.transcript);
validateFrozenSource(source, transcripts);

const evaluation = evaluateV02XFrozenRuns(transcripts, V02_W_EXPECTED_TEXT);
const decision = decideV02XVerdict(evaluation);

const summary = {
  schemaVersion: 1,
  experiment: V02_X_EXPERIMENT,
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
  },
  provider: 'none', // 复算纯本地，不发起任何 Provider 请求
  source: {
    evidence: V02_X_SOURCE_EVIDENCE,
    experiment: 'V02-W',
    resolvedModelId: source.resolvedModelId,
    repetitions: transcripts.length,
  },
  frozenTerms: V02_X_FROZEN_TERMS.map((entry) => ({
    term: entry.term,
    context: entry.context,
  })),
  expectedText: V02_W_EXPECTED_TEXT,
  rules: {
    ruleVersion: evaluation.runs[0].replacements[0]?.ruleVersion ?? null,
    // 常量从生产模块导入，避免模块改阈值后摘要静默失真。
    maxEditDistance: MAX_EDIT_DISTANCE,
    maxTranscriptLength: MAX_TRANSCRIPT_LENGTH,
    casePolicy: 'preserve-original',
    failClosed: [
      'only_full_tokens_replaced',
      'no_substring_replace',
      'no_global_term_hardcode',
      'same_distance_keeps_original',
      'bilateral_context_required',
    ],
  },
  runs: evaluation.runs.map((run, index) => ({
    repetition: index + 1,
    originalTranscript: run.originalTranscript,
    correctedTranscript: run.correctedTranscript,
    replacements: run.replacements.map((replacement) => ({
      originalToken: replacement.originalToken,
      correctedTerm: replacement.correctedTerm,
      tokenIndex: replacement.tokenIndex,
      charStart: replacement.charStart,
      charEnd: replacement.charEnd,
      ruleVersion: replacement.ruleVersion,
      confidenceClass: replacement.confidenceClass,
      reversible: replacement.reversible,
    })),
    unchangedReason: run.unchangedReason,
    totalTokenCount: run.totalTokenCount,
    unchangedTokenCount: run.unchangedTokenCount,
    werBefore: run.werBefore,
    werAfter: run.werAfter,
    recallBefore: run.recallBefore,
    recallAfter: run.recallAfter,
    reversible: run.reversible,
  })),
  metrics: {
    qualityPassed: evaluation.qualityPassed,
    stable: evaluation.stable,
    allReversible: evaluation.allReversible,
    everyReplacementReversible: evaluation.everyReplacementReversible,
    neverOverwroteOriginal: evaluation.neverOverwroteOriginal,
    maxWerAfter: Math.max(...evaluation.runs.map((run) => run.werAfter)),
    termsComplete: evaluation.runs.every(
      (run) => run.recallAfter.bagging === 1 && run.recallAfter.boosting === 1,
    ),
    werGate: V02_X_MAX_WER,
  },
  decisions: {
    // 2026 项目负责人确认：粘连 token（methodsbegging）按 fail-closed 保持
    // 原文，不得做任意 substring replace；因此 Bagging 第二次出现无法恢复，
    // 术语召回按每术语如实报告，由负责人裁定口径。
    concatenatedTokenFailClosed: true,
    acceptedRisk:
      'V02 模型质量风险已由负责人接受（2026-08-05），本任务非 V03 前置门槛',
  },
  // V02/V03 已由负责人接受质量风险并标记 PASS；V02-X 是非阻塞增强，不改变
  // 该状态，也不写 v02Passed=false / v03Unlocked=false（REVISE 修正）。
  v02V03Status: {
    status: 'PASS',
    nonBlocking: true,
    note: 'V02/V03 PASS 由负责人于 2026-08-05 接受质量风险后标记；V02-X 为非阻塞增强，不阻塞 V03-V17，不改变 V02/V03 状态',
  },
  verdict: decision.verdict,
  blockerCode: decision.blockerCode,
};

assertSafeEvidence(summary);

const output = join(here, 'evidence/v02-x-summary.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

function validateFrozenSource(source, transcripts) {
  if (transcripts.length !== 3) {
    fail('V02-X source must contain exactly three runs.');
  }
  for (const transcript of transcripts) {
    if (typeof transcript !== 'string' || transcript.length === 0) {
      fail('V02-X frozen transcript is empty.');
    }
  }
  // 三次冻结终稿必须完全相同：纠错复算的输入是 V02-W 已保存的同一文本。
  if (new Set(transcripts).size !== 1) {
    fail('V02-X frozen transcripts must be identical.');
  }
}

function assertSafeEvidence(value) {
  const raw = JSON.stringify(value);
  if (
    /(?:\/Users\/|\/home\/|\/tmp\/|[A-Za-z]:\\)|(?:Bearer\s+|\bsk-[A-Za-z0-9_-]{8,}|\bgh[opsu]_[A-Za-z0-9]{8,})|(?:\n\s*at\s+\S)/.test(
      raw,
    )
  ) {
    fail('unsafe evidence value rejected');
  }
}

function readJson(path) {
  if (!existsSync(path)) {
    fail(`V02-X source evidence is missing: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`V02-X source evidence is invalid JSON: ${path}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
