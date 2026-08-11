#!/usr/bin/env node
/**
 * D03 静态门禁：新增开放 Extension Identifier 时不得默认添加 DB hard enum。
 *
 * 规则：packages/db 的 schema 源码中，使用字面量 IN 或等值比较表达成员闭集的
 * CHECK 必须出现在 CLOSED_VOCABULARY_CONSTRAINTS 白名单内（closed 状态机/
 * 安全/生命周期词汇，见 docs/04-data/07-D03 矩阵）；开放 Vocabulary 字段必须使用
 * 格式 CHECK（~ '^...$'）+ 应用层 Registry，新增未登记的白名单外 IN 闭集即失败。
 *
 * 不使用脆弱的单字符串搜索：解析完整的 check(...) 调用并提取 SQL 主体，
 * 只有当约束体包含 `in (` 且两侧为字面量列表（无表达式/子查询）时才判定为
 * 成员闭集。格式 CHECK（~）、数值/时间/形状/长度约束不触发。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * 保持数据库级闭集的约束白名单（closed_state）。
 * 新增 closed 约束必须同时更新此处与 docs/04-data/07-D03 矩阵，
 * 并给出安全/生命周期理由。
 */
export const CLOSED_VOCABULARY_CONSTRAINTS = new Set([
  // identity / lifecycle status
  'platform_users_kind_check',
  'platform_users_status_check',
  'personal_agents_status_check',
  'spaces_kind_check',
  'spaces_status_check',
  'spaces_archive_shape_check',
  'assets_status_shape_check',
  'asset_processing_jobs_lifecycle_check',
  'gateway_channel_account_status_check',
  'gateway_channel_account_activation_check',
  'gateway_channel_thread_kind_check',
  'gateway_channel_thread_status_check',
  'gateway_node_pairings_status_check',
  'gateway_node_invocations_status_check',
  'conversations_status_check',
  'conversations_archive_shape_check',
  'agent_operations_status_check',
  'gateway_deliveries_status_check',
  'gateway_deliveries_shape_check',
  'lesson_sessions_status_check',
  'lesson_sessions_archive_timestamp_check',
  'assets_scope_check',
  'assets_status_check',
  'asset_versions_status_check',
  'asset_versions_failure_shape_check',
  /* ADR-0026 四态质量（processing/structured/degraded_plain_text/failed）是
     closed 枚举；quality_shape_check 的 ready 分支内联同一闭集字面量，同为
     closed 语义，一并注册（B1 0054 引入时漏注册，全量门禁测试补齐）。 */
  'asset_representations_quality_check',
  'asset_representations_quality_shape_check',
  'asset_representations_status_check',
  'asset_representations_failure_shape_check',
  'asset_video_keyframes_shape_check',
  'asset_processing_jobs_status_check',
  'asset_processing_jobs_failure_shape_check',
  'object_deletion_outbox_status_check',
  'object_deletion_outbox_lifecycle_check',
  'chat_messages_role_check',
  'chat_messages_status_check',
  'chat_messages_terminal_timestamps_check',
  'chat_messages_lease_shape_check',
  'chat_messages_idempotency_fields_check',
  'chat_messages_cancelled_timestamp_check',
  'conversation_messages_role_check',
  'conversation_messages_status_check',
  'conversation_messages_terminal_check',
  'agent_message_parts_shape_check',
  'agent_message_parts_type_check',
  'model_runs_text_check',
  'model_runs_status_check',
  'model_runs_lifecycle_timestamps_check',
  'model_runs_operation_shape_check',
  'tool_calls_status_check',
  'tool_calls_lifecycle_check',
  'tool_calls_result_shape_check',
  'tool_effects_status_check',
  'tool_effects_lifecycle_check',
  'tool_approval_intents_status_check',
  'tool_approval_intents_lifecycle_check',
  'operation_continuations_status_check',
  'operation_continuations_text_check',
  'operation_continuations_terminal_check',
  'operation_continuations_lease_check',
  'knowledge_sources_status_check',
  'knowledge_sources_tombstone_check',
  'knowledge_documents_status_check',
  'knowledge_documents_failure_shape_check',
  'knowledge_embedding_runs_status_check',
  'knowledge_embedding_runs_lifecycle_shape_check',
  'knowledge_embedding_runs_failure_shape_check',
  'artifacts_status_check',
  'artifacts_archive_shape_check',
  'artifacts_trust_tier_check',
  'artifact_generation_jobs_status_check',
  'artifact_generation_jobs_lifecycle_shape_check',
  'artifact_generation_jobs_failure_shape_check',
  'web_runtime_runs_status_check',
  'web_runtime_runs_authority_check',
  'web_runtime_runs_terminal_check',
  'learning_goals_status_check',
  'learning_goals_grade_band_check',
  'learning_goals_lifecycle_check',
  'mcp_tool_intents_status_check',
  'mcp_tool_intents_lifecycle_check',
  // security outcome / approval risk / consent / tool effect
  'security_audit_events_outcome_check',
  'gateway_approvals_risk_check',
  'gateway_approvals_status_check',
  'gateway_approvals_decision_check',
  'turn_safety_decisions_phase_check',
  'turn_safety_decisions_category_check',
  'turn_safety_decisions_action_check',
  'tool_calls_exposure_check',
  'tool_calls_effect_check',
  'audio_consents_authorization_check',
  'audio_consents_purpose_check',
  'audio_consents_status_check',
  'audio_consents_lifecycle_check',
  'audio_retentions_purpose_check',
  'audio_retentions_status_check',
  'audio_retentions_lifecycle_check',
  'tool_effect_reconciliations_resolution_check',
  'tool_effect_reconciliations_shape_check',
  'learner_profiles_age_band_check',
  'learner_profiles_grade_band_check',
  'learner_profiles_shape_check',
  'learner_profiles_source_check',
  'mcp_tool_intents_policy_check',
  'mcp_tool_intents_cipher_check',
  // RBAC 与休眠 authority（新角色/委托类型须权限矩阵设计）
  'notebook_memberships_role_check',
  'delegated_grants_kind_check',
  // 审批适配器与协议版本（安全边界，新适配器须审批产品评审）
  'tool_approval_intents_text_check',
  'mcp_tool_intents_identity_check',
  'web_user_profiles_avatar_check',
  'turn_usage_budget_outcomes_reason_check',
  'operation_continuations_kind_check',
]);

const SCHEMA_SOURCES = [
  join(process.cwd(), 'packages/db/src/schema.ts'),
  ...readdirSync(join(process.cwd(), 'packages/db/src/schema'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(process.cwd(), 'packages/db/src/schema', name)),
];

/** 读取全部 Schema CHECK；由 AST 完整性断言保证注释/换行不能造成漏检。 */
export function loadSchemaCheckCalls() {
  return SCHEMA_SOURCES.flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return extractCheckCalls(source, file).map((call) => ({ ...call, file }));
  });
}

/** 用 TypeScript AST 提取 check(name, sql`...`)；注释与换行不能绕过门禁。 */
export function extractCheckCalls(source, fileName = 'schema.ts') {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'check'
    ) {
      const [nameNode, sqlNode] = node.arguments;
      if (
        nameNode &&
        ts.isStringLiteralLike(nameNode) &&
        sqlNode &&
        ts.isTaggedTemplateExpression(sqlNode) &&
        ts.isIdentifier(sqlNode.tag) &&
        sqlNode.tag.text === 'sql'
      ) {
        const template = sqlNode.template.getText(sourceFile);
        calls.push({ name: nameNode.text, body: template.slice(1, -1) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const syntacticCount = (source.match(/\bcheck\s*\(/g) ?? []).length;
  if (calls.length !== syntacticCount) {
    throw new Error(
      `${fileName}: CHECK 提取不完整（AST=${calls.length}, syntax=${syntacticCount}）`,
    );
  }
  return calls;
}

/**
 * 判定约束体是否为成员闭集：`in (` 且括号内只含字面量
 * （引号字符串、逗号、空格），不含表达式、子查询或函数调用。
 */
function isLiteralList(inner) {
  if (!inner.trim()) return false;
  // 只允许字面量值（标识符字符/数字/引号/空白/逗号）；出现函数调用、
  // 运算符、子查询等即不是字面量闭集
  if (!/^[\s,'"a-zA-Z0-9._:\/-]*$/.test(inner)) return false;
  const values = inner.split(',').map((part) => part.trim());
  if (values.length === 0) return false;
  return values.every(
    (value) => /^'[^']*'$/.test(value) || /^\d+$/.test(value),
  );
}

/** 同时识别 IN 字面量列表与 `column = 'literal'` 单值闭集。 */
export function isLiteralVocabularyClosure(body) {
  const memberships = body.matchAll(/(?:^|[\s(])(?:not\s+)?in\s*\(([^)]*)\)/gi);
  for (const match of memberships) {
    if (isLiteralList(match[1] ?? '')) return true;
  }
  return /\$\{[^}]+\}(?:\s*->>\s*'[^']+')?\s*=\s*'[^']*'/i.test(body);
}

/**
 * 从全部 migration journal 项提取 ADD CHECK，防止手写 SQL 绕过 schema 门禁。
 * 同名约束按 journal 顺序去重、保留最新定义：migration 是演进快照，约束会被
 * 后续 migration 覆盖（如 kind/phase 由闭集演化为开放格式 ~ 正则），只审最新
 * 单条 migration 又会随纯加列 migration 漂移成空集，去重保留最终态最贴门禁本意。
 */
export function extractMigrationChecks() {
  const journal = JSON.parse(
    readFileSync(
      join(process.cwd(), 'packages/db/drizzle/meta/_journal.json'),
      'utf8',
    ),
  );
  const byName = new Map();
  for (const entry of journal.entries) {
    if (!entry.tag) continue;
    const migrationPath = join(
      process.cwd(),
      'packages/db/drizzle',
      `${entry.tag}.sql`,
    );
    const source = readFileSync(migrationPath, 'utf8');
    for (const statement of source.split('--> statement-breakpoint')) {
      const match =
        /ADD CONSTRAINT "([^"]+)" CHECK \(([\s\S]*)\)\s*;?\s*$/.exec(
          statement.trim(),
        );
      if (match) byName.set(match[1], { name: match[1], body: match[2] });
    }
  }
  return [...byName.values()];
}

/** 审计 schema 源码：返回违规的约束名列表（白名单外的成员闭集）。 */
export function auditVocabularyClosures() {
  const violations = [];
  for (const call of loadSchemaCheckCalls()) {
    if (
      isLiteralVocabularyClosure(call.body) &&
      !CLOSED_VOCABULARY_CONSTRAINTS.has(call.name)
    ) {
      violations.push(`${call.file}: ${call.name} 是白名单外的成员闭集约束`);
    }
  }
  for (const call of extractMigrationChecks()) {
    if (
      isLiteralVocabularyClosure(call.body) &&
      !CLOSED_VOCABULARY_CONSTRAINTS.has(call.name)
    ) {
      violations.push(`migration: ${call.name} 是白名单外的成员闭集约束`);
    }
  }
  return violations;
}

function main() {
  const violations = auditVocabularyClosures();
  for (const violation of violations) {
    console.error(`[vocabulary-gate] ${violation}`);
  }
  if (violations.length > 0) {
    console.error(
      '[vocabulary-gate] 开放 Extension Identifier 不得默认添加 DB hard enum；' +
        '改用格式 CHECK + 应用层 Registry，或提供安全/生命周期理由并登记白名单。',
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
