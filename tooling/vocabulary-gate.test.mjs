import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditVocabularyClosures,
  CLOSED_VOCABULARY_CONSTRAINTS,
  extractCheckCalls,
  extractLatestMigrationChecks,
  isLiteralVocabularyClosure,
  loadSchemaCheckCalls,
} from './quality/vocabulary-gate.mjs';

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
  assert.equal(loadSchemaCheckCalls().length, 231);
  const violations = auditVocabularyClosures();
  assert.deepEqual(violations, []);
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

test('最新 migration 的 ADD CHECK 与 schema 使用同一分类规则', () => {
  const checks = extractLatestMigrationChecks();
  assert.equal(checks.length, 13);
  assert.equal(
    checks.some((check) => check.name === 'assets_kind_check'),
    true,
  );
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
  ]) {
    assert.equal(CLOSED_VOCABULARY_CONSTRAINTS.has(name), true, name);
  }
});
