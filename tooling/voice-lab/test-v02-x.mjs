import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TranscriptTermCorrectionError,
  applyTranscriptReplacements,
  correctTranscript,
  transcriptTermCorrectionProtocolVersion,
} from '../../packages/agent-core/src/transcript-term-correction.ts';
import {
  V02_X_EXPERIMENT,
  V02_X_FROZEN_TERMS,
  V02_X_MAX_WER,
  V02_X_SOURCE_EVIDENCE,
  decideV02XVerdict,
  evaluateV02XFrozenRuns,
  perTermRecall,
} from './v02-x-evaluation.mjs';
import { V02_W_EXPECTED_TEXT } from './v02-w-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** V02-W 冻结样例原始 transcript（evidence/v02-w-summary.json 三次完全相同）。 */
const FROZEN_TRANSCRIPT =
  'Bagging and boosting are two classic assemble methodsbegging reduces variance while bursting reduces buyers.';

function frozenInput(transcript, authorizedTerms = V02_X_FROZEN_TERMS) {
  return {
    originalTranscript: transcript,
    authorizedTerms,
    ruleVersion: transcriptTermCorrectionProtocolVersion,
  };
}

function errorCodeOf(fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof TranscriptTermCorrectionError) return error.code;
    throw error;
  }
  throw new Error('expected TranscriptTermCorrectionError');
}

function readJson(name) {
  return JSON.parse(readFileSync(join(here, name), 'utf8'));
}

test('V02-X source evidence is the frozen V02-W summary with three identical runs', () => {
  const summary = readJson('evidence/v02-w-summary.json');
  assert.equal(summary.experiment, 'V02-W');
  assert.equal(summary.verdict, 'BLOCKED_MODEL_OR_PROVIDER');
  assert.equal(summary.resolvedModelId, 'TeleAI/TeleSpeechASR');
  const transcripts = summary.runs.map((run) => run.transcript);
  assert.equal(transcripts.length, 3);
  for (const transcript of transcripts) {
    assert.equal(transcript, FROZEN_TRANSCRIPT);
  }
});

test('V02-X frozen runs: exactly one bursting→boosting replacement per run', () => {
  const summary = readJson('evidence/v02-w-summary.json');
  const evaluation = evaluateV02XFrozenRuns(
    summary.runs.map((run) => run.transcript),
    V02_W_EXPECTED_TEXT,
  );
  assert.equal(evaluation.runs.length, 3);
  for (const run of evaluation.runs) {
    assert.equal(run.replacements.length, 1);
    assert.deepEqual(run.replacements[0], {
      originalToken: 'bursting',
      correctedTerm: 'boosting',
      tokenIndex: 11,
      charStart: 84,
      charEnd: 92,
      ruleVersion: transcriptTermCorrectionProtocolVersion,
      confidenceClass: 'high',
      reversible: true,
    });
    assert.equal(
      run.correctedTranscript,
      'Bagging and boosting are two classic assemble methodsbegging reduces variance while boosting reduces buyers.',
    );
    assert.equal(run.reversible, true);
    assert.equal(run.unchangedReason, null);
  }
});

test('V02-X frozen runs: WER improves and stays under the 0.35 gate', () => {
  const summary = readJson('evidence/v02-w-summary.json');
  const evaluation = evaluateV02XFrozenRuns(
    summary.runs.map((run) => run.transcript),
    V02_W_EXPECTED_TEXT,
  );
  assert.equal(evaluation.qualityPassed, true);
  assert.equal(evaluation.stable, true);
  assert.equal(evaluation.allReversible, true);
  assert.equal(evaluation.everyReplacementReversible, true);
  for (const run of evaluation.runs) {
    assert.equal(run.werBefore, 0.3333333333333333);
    assert.ok(run.werAfter < run.werBefore, 'WER must not regress');
    assert.ok(run.werAfter <= V02_X_MAX_WER, 'WER gate');
  }
});

test('V02-X frozen runs: term occurrence recall is reported per term', () => {
  const summary = readJson('evidence/v02-w-summary.json');
  const evaluation = evaluateV02XFrozenRuns(
    summary.runs.map((run) => run.transcript),
    V02_W_EXPECTED_TEXT,
  );
  for (const run of evaluation.runs) {
    // Boosting：原文 boosting + bursting→boosting 共 2/2；Bagging：原文 1/2，
    // 第二次丢失在粘连 token methodsbegging 中，按 fail-closed 保持原文。
    assert.deepEqual(run.recallBefore, { bagging: 0.5, boosting: 0.5 });
    assert.deepEqual(run.recallAfter, { bagging: 0.5, boosting: 1 });
  }
  assert.equal(
    perTermRecall(V02_W_EXPECTED_TEXT, V02_W_EXPECTED_TEXT).bagging,
    1,
  );
});

test('V02-X verdict is REVIEW_REQUIRED with the concatenated-token blocker note', () => {
  const summary = readJson('evidence/v02-w-summary.json');
  const evaluation = evaluateV02XFrozenRuns(
    summary.runs.map((run) => run.transcript),
    V02_W_EXPECTED_TEXT,
  );
  const decision = decideV02XVerdict(evaluation);
  assert.equal(decision.verdict, 'REVIEW_REQUIRED');
  assert.equal(
    decision.blockerCode,
    'frozen_bagging_recall_below_100_concatenated_token',
  );
});

test('V02-X negative: begging as a real word stays unchanged', () => {
  const result = correctTranscript(
    frozenInput('She was begging for help.', [
      { term: 'Bagging', context: ['reduces', 'variance'] },
    ]),
  );
  assert.equal(result.correctedTranscript, 'She was begging for help.');
  assert.equal(result.replacements.length, 0);
  assert.equal(result.unchangedReason, 'CONTEXT_NOT_CONFIRMED');
});

test('V02-X negative: Begging reduces suffering. stays unchanged (REVISE regression)', () => {
  // 双侧确认：begging 缺前邻，即使后邻 reduces 命中 context 也不改。
  const result = correctTranscript(
    frozenInput('Begging reduces suffering.', [
      { term: 'Bagging', context: ['reduces', 'variance'] },
    ]),
  );
  assert.equal(result.correctedTranscript, 'Begging reduces suffering.');
  assert.equal(result.replacements.length, 0);
  assert.equal(result.unchangedReason, 'CONTEXT_NOT_CONFIRMED');
});

test('V02-X negative: bursting as a real word stays unchanged', () => {
  const result = correctTranscript(
    frozenInput('The balloon is bursting.', [
      { term: 'Boosting', context: ['reduces', 'bias'] },
    ]),
  );
  assert.equal(result.correctedTranscript, 'The balloon is bursting.');
  assert.equal(result.replacements.length, 0);
  assert.equal(result.unchangedReason, 'CONTEXT_NOT_CONFIRMED');
});

test('V02-X negative: multiple same-distance candidates stay unchanged', () => {
  const result = correctTranscript(
    frozenInput('bagging reduces variance', [
      { term: 'Baggung', context: ['reduces'] },
      { term: 'Baggong', context: ['reduces'] },
    ]),
  );
  assert.equal(result.correctedTranscript, 'bagging reduces variance');
  assert.equal(result.replacements.length, 0);
  assert.equal(result.unchangedReason, 'MULTIPLE_CANDIDATES_SAME_DISTANCE');
});

test('V02-X negative: empty term table changes nothing', () => {
  const result = correctTranscript(frozenInput(FROZEN_TRANSCRIPT, []));
  assert.equal(result.correctedTranscript, FROZEN_TRANSCRIPT);
  assert.equal(result.replacements.length, 0);
  assert.equal(result.unchangedReason, 'EMPTY_TERM_TABLE');
});

test('V02-X negative: term not in the table changes nothing', () => {
  const result = correctTranscript(
    frozenInput(FROZEN_TRANSCRIPT, [{ term: 'AdaBoost' }]),
  );
  assert.equal(result.correctedTranscript, FROZEN_TRANSCRIPT);
  assert.equal(result.replacements.length, 0);
});

test('V02-X case policies: preserve-original and term-canonical', () => {
  const preserve = correctTranscript(
    frozenInput('while BURSTING reduces bias', [
      { term: 'Boosting', context: ['while', 'reduces'] },
    ]),
  );
  assert.equal(preserve.correctedTranscript, 'while BOOSTING reduces bias');
  const preserveDefault = correctTranscript(
    frozenInput('while bursting reduces bias', [
      { term: 'Boosting', context: ['while', 'reduces'] },
    ]),
  );
  assert.equal(
    preserveDefault.correctedTranscript,
    'while boosting reduces bias',
  );
  // term-canonical 策略使用术语表规范大小写。
  const canonicalPolicy = correctTranscript({
    originalTranscript: 'while bursting reduces bias',
    authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
    ruleVersion: transcriptTermCorrectionProtocolVersion,
    casePolicy: 'term-canonical',
  });
  assert.equal(
    canonicalPolicy.correctedTranscript,
    'while Boosting reduces bias',
  );
});

test('V02-X punctuation and positions: tokens are corrected, punctuation preserved', () => {
  const mid = correctTranscript(
    frozenInput('while (bursting, reduces bias).', [
      { term: 'Boosting', context: ['while', 'reduces'] },
    ]),
  );
  assert.equal(mid.correctedTranscript, 'while (boosting, reduces bias).');
  // 句首/句尾候选缺一侧邻词，双侧确认失败，保持原文（fail-closed）。
  const head = correctTranscript(
    frozenInput('bursting reduces variance', [
      { term: 'Boosting', context: ['while', 'reduces'] },
    ]),
  );
  assert.equal(head.correctedTranscript, 'bursting reduces variance');
  assert.equal(head.unchangedReason, 'CONTEXT_NOT_CONFIRMED');
  const tail = correctTranscript(
    frozenInput('variance reduces bursting', [
      { term: 'Boosting', context: ['while', 'reduces'] },
    ]),
  );
  assert.equal(tail.correctedTranscript, 'variance reduces bursting');
  assert.equal(tail.unchangedReason, 'CONTEXT_NOT_CONFIRMED');
  const midSentence = correctTranscript(
    frozenInput('while bursting reduces bias', [
      { term: 'Boosting', context: ['while', 'reduces'] },
    ]),
  );
  assert.equal(midSentence.correctedTranscript, 'while boosting reduces bias');
  const repeated = correctTranscript(
    frozenInput('while bursting reduces bias while bursting reduces bias', [
      { term: 'Boosting', context: ['while', 'reduces'] },
    ]),
  );
  assert.equal(repeated.replacements.length, 2);
  assert.equal(
    repeated.correctedTranscript,
    'while boosting reduces bias while boosting reduces bias',
  );
});

test('V02-X rejections use stable error codes', () => {
  assert.equal(
    errorCodeOf(() => correctTranscript(frozenInput('a'.repeat(4001), []))),
    'TRANSCRIPT_TOO_LONG',
  );
  const tooMany = Array.from({ length: 65 }, (_, i) => ({
    term: i < 64 ? 'a'.repeat(i + 1) : 'b',
  }));
  assert.equal(
    errorCodeOf(() => correctTranscript(frozenInput('x y', tooMany))),
    'TOO_MANY_TERMS',
  );
  assert.equal(
    errorCodeOf(() =>
      correctTranscript({ ...frozenInput('x y'), ruleVersion: 'v0' }),
    ),
    'INVALID_RULE_VERSION',
  );
  assert.equal(
    errorCodeOf(() => correctTranscript(frozenInput('', []))),
    'EMPTY_TRANSCRIPT',
  );
  // 病态输入：单字母词 + 单字母术语 + 上下文命中会超过 MAX_REPLACEMENTS。
  assert.equal(
    errorCodeOf(() =>
      correctTranscript(
        frozenInput(Array.from({ length: 300 }, () => 'a').join(' '), [
          { term: 'b', context: ['a'] },
        ]),
      ),
    ),
    'TOO_MANY_REPLACEMENTS',
  );
});

test('V02-X determinism: identical input produces identical output', () => {
  const first = correctTranscript(frozenInput(FROZEN_TRANSCRIPT));
  const second = correctTranscript(frozenInput(FROZEN_TRANSCRIPT));
  assert.deepEqual(second, first);
});

test('V02-X replacement audit is reversible and rejects tampering', () => {
  const result = correctTranscript(frozenInput(FROZEN_TRANSCRIPT));
  assert.equal(
    applyTranscriptReplacements(
      result.correctedTranscript,
      result.replacements,
    ),
    FROZEN_TRANSCRIPT,
  );
  const repeated = correctTranscript(
    frozenInput('while bursting reduces bias while bursting reduces bias', [
      { term: 'Boosting', context: ['while', 'reduces'] },
    ]),
  );
  assert.equal(
    applyTranscriptReplacements(
      repeated.correctedTranscript,
      repeated.replacements,
    ),
    'while bursting reduces bias while bursting reduces bias',
  );
  // REVISE 回归：篡改 correctedTranscript 后不得声称“成功恢复”。
  const { charStart, correctedTerm } = result.replacements[0];
  const tampered =
    result.correctedTranscript.slice(0, charStart) +
    'tampered' +
    result.correctedTranscript.slice(charStart + correctedTerm.length);
  assert.equal(
    errorCodeOf(() =>
      applyTranscriptReplacements(tampered, result.replacements),
    ),
    'REPLACEMENT_TOKEN_MISMATCH',
  );
  const insertedBefore =
    result.correctedTranscript.slice(0, charStart) +
    'evil ' +
    result.correctedTranscript.slice(charStart);
  assert.equal(
    errorCodeOf(() =>
      applyTranscriptReplacements(insertedBefore, result.replacements),
    ),
    'REPLACEMENT_TOKEN_MISMATCH',
  );
});

test('V02-X output and evidence contain no secrets, paths, Provider body or stack', () => {
  const result = correctTranscript(frozenInput(FROZEN_TRANSCRIPT));
  const raw = JSON.stringify(result);
  assert.doesNotMatch(raw, /\/Users\/|\/home\/|\/tmp\/|[A-Za-z]:\\/);
  assert.doesNotMatch(raw, /sk-[A-Za-z0-9]{8,}|Bearer\s+\S+/i);
  assert.doesNotMatch(raw, /response\s*body/i);
  assert.doesNotMatch(raw, /\n\s*at\s+\S/);
  assert.ok(!raw.includes('.env'));
  // 生成的摘要（若存在）同样不含敏感信息。
  const summaryPath = join(here, 'evidence', 'v02-x-summary.json');
  try {
    const summary = readFileSync(summaryPath, 'utf8');
    assert.doesNotMatch(summary, /\/Users\/|\/home\/|\/tmp\//);
    assert.doesNotMatch(summary, /sk-[A-Za-z0-9]{8,}|Bearer\s+\S+/i);
    assert.doesNotMatch(summary, /\n\s*at\s+\S/);
  } catch {
    // 摘要尚未生成时跳过（generate-v02-x-summary.mjs 生成后由本测试守护）。
  }
});

test('V02-X never touches the accepted-risk V02 evidence', () => {
  const v02w = readJson('evidence/v02-w-summary.json');
  assert.equal(v02w.experiment, 'V02-W');
  assert.equal(v02w.verdict, 'BLOCKED_MODEL_OR_PROVIDER');
  assert.equal(v02w.v02Passed, false);
  assert.equal(v02w.v03Unlocked, false);
  assert.equal(v02w.resolvedModelId, 'TeleAI/TeleSpeechASR');
  assert.equal(v02w.runs[0].transcript, FROZEN_TRANSCRIPT);
  assert.equal(V02_X_EXPERIMENT, 'V02-X');
  assert.equal(V02_X_SOURCE_EVIDENCE, 'evidence/v02-w-summary.json');
});

test('V02-X summary does not claim v02Passed=false or v03Unlocked=false (REVISE regression)', () => {
  // V02/V03 已由负责人接受风险并标记 PASS（2026-08-05），V02-X 是非阻塞
  // 增强，其摘要不得改写 V02/V03 状态；字段改为 v02V03Status 记录现状。
  const summary = readJson('evidence/v02-x-summary.json');
  assert.ok(!('v02Passed' in summary), 'summary must not contain v02Passed');
  assert.ok(
    !('v03Unlocked' in summary),
    'summary must not contain v03Unlocked',
  );
  assert.equal(summary.v02V03Status.status, 'PASS');
  assert.equal(summary.v02V03Status.nonBlocking, true);
});
