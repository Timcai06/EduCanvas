import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  auditVocabularyClosures,
  CLOSED_VOCABULARY_CONSTRAINTS,
  extractCheckCalls,
  extractSqlCheckConstraints,
  isLiteralVocabularyClosure,
  loadSchemaCheckCalls,
} from './vocabulary-gate.mjs';

/* ---------- 判定器单元 ---------- */

test('成员闭集判定：IN 字面量列表', () => {
  assert.equal(
    isLiteralVocabularyClosure(`\${table.status} in ('active', 'archived')`),
    true,
  );
  assert.equal(
    isLiteralVocabularyClosure(`\${table.kind} in ('a', 'b', 'c')`),
    true,
  );
  assert.equal(isLiteralVocabularyClosure(`\${table.n} in (1, 2, 3)`), true);
  assert.equal(isLiteralVocabularyClosure(`\${table.kind} = 'web'`), true);
});

test('非成员闭集不被误判：格式/表达式/子查询/单值比较', () => {
  assert.equal(
    isLiteralVocabularyClosure(`\${table.kind} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    false,
  );
  assert.equal(
    isLiteralVocabularyClosure(`\${table.id} in (select id from spaces)`),
    false,
  );
  assert.equal(
    isLiteralVocabularyClosure(`\${table.status} in (lower('X'))`),
    false,
  );
  assert.equal(
    isLiteralVocabularyClosure(`char_length(\${table.x}) between 1 and 64`),
    false,
  );
  assert.equal(
    isLiteralVocabularyClosure(`\${table.status} in ('a' || 'b')`),
    false,
  );
});

test('check 调用提取', () => {
  const calls = extractCheckCalls(`
    check('a_check', sql\`\${table.x} in ('x')\`),
    check(
      'b_check',
      // 注释不能让 AST 门禁漏掉该 CHECK。
      sql\`\${table.y} ~ '^[a-z]+\$'\`,
    ),
  `);
  assert.deepEqual(
    calls.map((call) => call.name),
    ['a_check', 'b_check'],
  );
  assert.equal(isLiteralVocabularyClosure(calls[0].body), true);
  assert.equal(isLiteralVocabularyClosure(calls[1].body), false);
});

/* ---------- 门禁正反用例 ---------- */

test('正向：当前 schema 的全部成员闭集都在 closed 白名单内（无违规）', () => {
  // 0060 的研究恢复游标累计后为 258；0062 新增 6 个 Plan/Chapter CHECK，
  // 0063 新增 1 个 Session Notebook-pair CHECK，0064–0066 新增 6 个 Artifact
  // generation/confirmation CHECK，共 271。
  // 其中协议判别联合登记为 closed，坐标/长度/形状仍是开放格式约束。
  assert.equal(loadSchemaCheckCalls().length, 271);
  const violations = auditVocabularyClosures();
  assert.deepEqual(violations, []);
});

test('Plan/Chapter 的 source、status、origin 与 locator 协议保持 closed', () => {
  const names = new Set(loadSchemaCheckCalls().map((call) => call.name));
  for (const name of [
    'notebook_chapters_origin_check',
    'notebook_chapters_locator_check',
    'notebook_plans_source_check',
    'notebook_plans_status_check',
  ]) {
    assert.equal(names.has(name), true, name);
    assert.equal(CLOSED_VOCABULARY_CONSTRAINTS.has(name), true, name);
  }
});

test('反向：白名单外的成员闭集被拒绝（新增开放字段不得写死 IN 闭集）', () => {
  // 模拟一个新开放字段被错误写成 IN 闭集：约束名不在白名单 → 违规。
  const fake = `check('future_capability_check', sql\`\${table.capability} in ('a.b', 'c.d')\`)`;
  const calls = extractCheckCalls(fake);
  assert.equal(calls.length, 1);
  assert.equal(isLiteralVocabularyClosure(calls[0].body), true);
  assert.equal(CLOSED_VOCABULARY_CONSTRAINTS.has(calls[0].name), false);
  // 门禁逻辑等价断言：白名单外的成员闭集必须失败
  const wouldViolate = calls.some(
    (call) =>
      isLiteralVocabularyClosure(call.body) &&
      !CLOSED_VOCABULARY_CONSTRAINTS.has(call.name),
  );
  assert.equal(wouldViolate, true);
});

test('0063 migration 的 Notebook/Session 配对 CHECK 使用 shape 规则', () => {
  const source = readFileSync(
    new URL(
      '../../packages/db/drizzle/0063_notebook_lesson_scope.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const checks = source
    .split('--> statement-breakpoint')
    .flatMap(extractSqlCheckConstraints);
  assert.deepEqual(
    checks.map((check) => check.name),
    ['lesson_sessions_notebook_pair_check'],
  );
  assert.equal(isLiteralVocabularyClosure(checks[0].body), false);
});

test('0066 attempt CHECK 是 numeric range，不是成员闭集', () => {
  const source = readFileSync(
    new URL(
      '../../packages/db/drizzle/0066_artifact_confirmation_attempts.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const checks = source
    .split('--> statement-breakpoint')
    .flatMap(extractSqlCheckConstraints);
  assert.deepEqual(
    checks.map((check) => check.name),
    ['artifact_confirmation_requests_attempt_check'],
  );
  assert.equal(isLiteralVocabularyClosure(checks[0].body), false);
});

test('0061 历史学段 CHECK 仍解析为 closed 闭集', () => {
  const source = readFileSync(
    new URL(
      '../../packages/db/drizzle/0061_four_grade_bands.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const checks = source
    .split('--> statement-breakpoint')
    .flatMap(extractSqlCheckConstraints);
  const gradeChecks = checks.filter((check) =>
    check.name.endsWith('_grade_band_check'),
  );
  assert.deepEqual(
    gradeChecks.map((check) => check.name),
    ['learner_profiles_grade_band_check', 'learning_goals_grade_band_check'],
  );
  for (const check of gradeChecks) {
    assert.equal(isLiteralVocabularyClosure(check.body), true, check.name);
    assert.equal(
      CLOSED_VOCABULARY_CONSTRAINTS.has(check.name),
      true,
      check.name,
    );
  }
});

test('反向：closed 状态机约束即使含 IN 闭集也被允许（白名单命中）', () => {
  assert.equal(CLOSED_VOCABULARY_CONSTRAINTS.has('assets_status_check'), true);
  assert.equal(
    CLOSED_VOCABULARY_CONSTRAINTS.has('gateway_approvals_risk_check'),
    true,
  );
  assert.equal(
    CLOSED_VOCABULARY_CONSTRAINTS.has('tool_calls_effect_check'),
    true,
  );
  assert.equal(
    CLOSED_VOCABULARY_CONSTRAINTS.has('audio_consents_purpose_check'),
    true,
  );
});

test('白名单覆盖封闭类别：lifecycle/security/approval/consent/effect/terminal 均有代表', () => {
  for (const name of [
    'agent_operations_status_check',
    'security_audit_events_outcome_check',
    'gateway_approvals_risk_check',
    'audio_consents_purpose_check',
    'tool_calls_effect_check',
    'web_runtime_runs_terminal_check',
    'turn_safety_decisions_action_check',
    'notebook_memberships_role_check',
    'resource_annotations_author_pen_check',
    'notebook_surface_positions_rest_state_check',
  ]) {
    assert.equal(CLOSED_VOCABULARY_CONSTRAINTS.has(name), true, name);
  }
});
