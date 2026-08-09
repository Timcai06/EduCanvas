import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { platformUsers } from './identity';
import { agentOperations, conversationMessages } from './conversation';
import { chatMessages, lessonSessions } from './agent-runtime';

/** 模型运行是与可见消息分层的审计记录；兼容旧教学账本并接入统一 Agent Operation。 */
export const modelRuns = pgTable(
  'model_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => lessonSessions.id, {
      onDelete: 'cascade',
    }),
    operationId: uuid('operation_id').notNull(),
    operationKind: text('operation_kind').notNull(),
    agentOperationId: uuid('agent_operation_id').references(
      () => agentOperations.id,
      { onDelete: 'cascade' },
    ),
    assistantMessageId: uuid('assistant_message_id').references(
      () => chatMessages.id,
      { onDelete: 'cascade' },
    ),
    conversationMessageId: uuid('conversation_message_id').references(
      () => conversationMessages.id,
      { onDelete: 'cascade' },
    ),
    turnId: uuid('turn_id'),
    phase: text('phase').notNull(),
    attempt: integer('attempt').notNull().default(1),
    traceId: text('trace_id').notNull(),
    taskAlias: text('task_alias').notNull(),
    modelAlias: text('model_alias').notNull(),
    promptVersion: text('prompt_version').notNull(),
    promptHash: text('prompt_hash').notNull(),
    provider: text('provider'),
    providerModelId: text('provider_model_id'),
    modelRevision: text('model_revision'),
    providerResponseId: text('provider_response_id'),
    systemFingerprint: text('system_fingerprint'),
    finishReason: text('finish_reason'),
    status: text('status').notNull().default('pending'),
    errorCode: text('error_code'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheHitTokens: integer('cache_hit_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    latencyMs: integer('latency_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('model_runs_assistant_message_fk_idx').on(table.assistantMessageId),
    index('model_runs_conversation_message_fk_idx').on(
      table.conversationMessageId,
    ),
    uniqueIndex('model_runs_operation_phase_attempt_unique').on(
      table.operationKind,
      table.operationId,
      table.phase,
      table.attempt,
    ),
    index('model_runs_session_turn_idx').on(table.sessionId, table.turnId),
    index('model_runs_agent_operation_idx').on(
      table.agentOperationId,
      table.createdAt,
      table.id,
    ),
    check(
      'model_runs_operation_shape_check',
      sql`(${table.operationKind} = 'teaching_turn' and ${table.sessionId} is not null and ${table.agentOperationId} is null and ${table.assistantMessageId} is not null and ${table.conversationMessageId} is null and ${table.turnId} is not null and ${table.operationId} = ${table.turnId}) or (${table.operationKind} = 'agent_turn' and ${table.agentOperationId} is not null and ${table.operationId} = ${table.agentOperationId} and ((${table.sessionId} is null and ${table.assistantMessageId} is null and ${table.conversationMessageId} is not null and ${table.turnId} is null) or (${table.sessionId} is not null and ${table.assistantMessageId} is not null and ${table.conversationMessageId} is null and ${table.turnId} = ${table.agentOperationId})))`,
    ),
    check(
      'model_runs_phase_check',
      sql`${table.phase} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'model_runs_status_check',
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')`,
    ),
    check('model_runs_attempt_check', sql`${table.attempt} between 1 and 100`),
    check(
      'model_runs_text_check',
      // finishReason 是 Provider 原始值归一化后的平台终态语义；原始词汇可以
      // 扩展，但进入账本前必须映射到稳定闭集。
      sql`char_length(${table.traceId}) between 1 and 128 and ${table.taskAlias} ~ '^[a-z][a-z0-9._-]{0,63}$' and ${table.modelAlias} ~ '^[a-z][a-z0-9._-]{0,63}$' and char_length(${table.promptVersion}) between 1 and 128 and ${table.promptHash} ~ '^[a-f0-9]{64}$' and (${table.provider} is null or char_length(${table.provider}) between 1 and 128) and (${table.providerModelId} is null or char_length(${table.providerModelId}) between 1 and 256) and (${table.modelRevision} is null or char_length(${table.modelRevision}) between 1 and 256) and (${table.providerResponseId} is null or char_length(${table.providerResponseId}) between 1 and 512) and (${table.systemFingerprint} is null or char_length(${table.systemFingerprint}) between 1 and 512) and (${table.finishReason} is null or ${table.finishReason} in ('stop', 'tool_calls', 'length', 'content_filter', 'cancelled', 'error', 'other')) and (${table.errorCode} is null or ${table.errorCode} ~ '^[a-z][a-z0-9._:-]{0,127}$')`,
    ),
    check(
      'model_runs_usage_check',
      sql`coalesce(${table.inputTokens}, 0) >= 0 and coalesce(${table.outputTokens}, 0) >= 0 and coalesce(${table.cacheHitTokens}, 0) >= 0 and coalesce(${table.reasoningTokens}, 0) >= 0 and coalesce(${table.latencyMs}, 0) >= 0`,
    ),
    check(
      'model_runs_lifecycle_timestamps_check',
      sql`(${table.status} = 'pending' and ${table.startedAt} is null and ${table.completedAt} is null) or (${table.status} = 'running' and ${table.startedAt} is not null and ${table.completedAt} is null) or (${table.status} in ('succeeded', 'failed', 'cancelled', 'interrupted') and ${table.completedAt} is not null)`,
    ),
  ],
);

/**
 * Turn 使用预算账本（Q03）— 每次 Turn 一行。
 *
 * 只保存预算维度数值（token/次数/毫秒/美分）与低基数 breachReason，
 * 绝不保存用户正文、Prompt、供应商响应、价格密钥或 operationId 之外的标识。
 * operation_id 主键即 FK（D02 起）：账本无独立生命周期，随 agent_operations
 * cascade 删除（D-RISK-02 收口见 docs/04-data/06-D02）。
 */
export const turnUsageBudgetOutcomes = pgTable(
  'turn_usage_budget_outcomes',
  {
    operationId: uuid('operation_id')
      .primaryKey()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    profileId: text('profile_id').notNull(),
    /** null 表示预算内正常完成。 */
    breachReason: text('breach_reason'),
    estimated: boolean('estimated').notNull().default(false),
    estimatedCostCents: integer('estimated_cost_cents').notNull(),
    modelCalls: integer('model_calls').notNull(),
    toolCalls: integer('tool_calls').notNull(),
    toolResultsTruncated: integer('tool_results_truncated').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    wallClockMs: integer('wall_clock_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('turn_usage_budget_outcomes_created_idx').on(table.createdAt),
    check(
      'turn_usage_budget_outcomes_reason_check',
      // 低基数账本标签必须与 agent-core budgetBreachReasons 同步，避免
      // 未登记原因污染指标维度或伪造预算终态。
      sql`${table.breachReason} is null or ${table.breachReason} in ('max_input_tokens', 'max_output_tokens', 'max_model_calls', 'max_tool_calls', 'max_tool_result_tokens', 'max_wall_clock', 'max_estimated_cost')`,
    ),
    check(
      'turn_usage_budget_outcomes_profile_check',
      sql`char_length(${table.profileId}) between 1 and 64 and ${table.profileId} ~ '^[a-z][a-z0-9_.-]*$'`,
    ),
    check(
      'turn_usage_budget_outcomes_counts_check',
      sql`${table.estimatedCostCents} >= 0 and ${table.modelCalls} >= 0 and ${table.toolCalls} >= 0 and ${table.toolResultsTruncated} >= 0 and ${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.wallClockMs} >= 0`,
    ),
  ],
);

/**
 * Provider tool call 的脱敏审计账本。参数与结果只保存服务端生成的结构摘要，
 * 不保存原始值、异常消息、堆栈或供应商推理内容。
 */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => lessonSessions.id, {
      onDelete: 'cascade',
    }),
    turnId: uuid('turn_id'),
    agentOperationId: uuid('agent_operation_id').references(
      () => agentOperations.id,
      { onDelete: 'cascade' },
    ),
    answerModelRunId: uuid('answer_model_run_id')
      .notNull()
      .references(() => modelRuns.id, { onDelete: 'cascade' }),
    providerToolCallId: text('provider_tool_call_id').notNull(),
    executionId: text('execution_id').notNull(),
    requestHash: text('request_hash').notNull(),
    traceId: text('trace_id').notNull(),
    toolName: text('tool_name'),
    teachingState: text('teaching_state'),
    exposure: text('exposure'),
    effect: text('effect'),
    argumentSummary: jsonb('argument_summary').notNull(),
    resultSummary: jsonb('result_summary'),
    status: text('status').notNull().default('pending'),
    code: text('code'),
    retryable: boolean('retryable').notNull().default(false),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('tool_calls_execution_id_unique').on(table.executionId),
    uniqueIndex('tool_calls_model_provider_call_unique').on(
      table.answerModelRunId,
      table.providerToolCallId,
    ),
    index('tool_calls_session_turn_idx').on(table.sessionId, table.turnId),
    index('tool_calls_agent_operation_idx').on(
      table.agentOperationId,
      table.createdAt,
      table.id,
    ),
    check(
      'tool_calls_scope_check',
      sql`(${table.sessionId} is not null and ${table.turnId} is not null and ${table.teachingState} is not null and ${table.agentOperationId} is null) or (${table.sessionId} is null and ${table.turnId} is null and ${table.teachingState} is null and ${table.agentOperationId} is not null)`,
    ),
    check(
      'tool_calls_status_check',
      sql`${table.status} in ('pending', 'running', 'succeeded', 'rejected', 'failed', 'outcome_unknown')`,
    ),
    check(
      'tool_calls_exposure_check',
      sql`${table.exposure} is null or ${table.exposure} in ('model', 'runtime')`,
    ),
    check(
      'tool_calls_effect_check',
      sql`${table.effect} is null or ${table.effect} in ('read', 'write')`,
    ),
    check(
      'tool_calls_lifecycle_check',
      sql`(${table.status} = 'pending' and ${table.startedAt} is null and ${table.completedAt} is null) or (${table.status} = 'running' and ${table.startedAt} is not null and ${table.completedAt} is null) or (${table.status} in ('succeeded', 'rejected', 'failed', 'outcome_unknown') and ${table.completedAt} is not null)`,
    ),
    check(
      'tool_calls_result_shape_check',
      sql`(${table.status} = 'succeeded' and ${table.resultSummary} is not null and ${table.code} is null) or (${table.status} in ('rejected', 'failed', 'outcome_unknown') and ${table.resultSummary} is null and ${table.code} is not null) or (${table.status} in ('pending', 'running') and ${table.resultSummary} is null and ${table.code} is null)`,
    ),
    check(
      'tool_calls_duration_check',
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
  ],
);

/**
 * write工具的持久副作用意图与提交证据。只保存稳定key/hash和终态；
 * 原始参数、输出、Credential、外部异常与回执正文禁止进入本表。
 */
export const toolEffects = pgTable(
  'tool_effects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentOperationId: uuid('agent_operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    toolCallId: uuid('tool_call_id')
      .notNull()
      .references(() => toolCalls.id, { onDelete: 'cascade' }),
    effectKey: text('effect_key').notNull(),
    semanticsHash: text('semantics_hash').notNull(),
    // 可空text兼容旧行；只冻结安全稳定ID，不保存Adapter配置或凭据，且无批量查询无需索引。
    reconciliationVerifierId: text('reconciliation_verifier_id'),
    status: text('status').notNull().default('intended'),
    code: text('code'),
    receiptHash: text('receipt_hash'),
    intendedAt: timestamp('intended_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('tool_effects_operation_key_unique').on(
      table.agentOperationId,
      table.effectKey,
    ),
    uniqueIndex('tool_effects_tool_call_unique').on(table.toolCallId),
    index('tool_effects_status_idx').on(
      table.status,
      table.intendedAt,
      table.id,
    ),
    check(
      'tool_effects_text_check',
      sql`${table.effectKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' and ${table.semanticsHash} ~ '^[a-f0-9]{64}$' and (${table.reconciliationVerifierId} is null or ${table.reconciliationVerifierId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$') and (${table.code} is null or ${table.code} ~ '^[a-z][a-z0-9._:-]{0,127}$') and (${table.receiptHash} is null or ${table.receiptHash} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'tool_effects_status_check',
      sql`${table.status} in ('intended', 'committed', 'failed', 'outcome_unknown')`,
    ),
    check(
      'tool_effects_lifecycle_check',
      sql`(${table.status} = 'intended' and ${table.code} is null and ${table.receiptHash} is null and ${table.settledAt} is null) or (${table.status} = 'committed' and ${table.code} is null and ${table.settledAt} is not null) or (${table.status} in ('failed', 'outcome_unknown') and ${table.code} is not null and ${table.receiptHash} is null and ${table.settledAt} is not null)`,
    ),
  ],
);

/**
 * Adapter完成耐久准备、Gateway尚未公开approval.required之间的最小意图。
 * 这里只保存恢复引用与可空W3C父上下文，不提供参数、Prompt、正文、Credential、Secret或结果字段。
 * trace_parent使用text而非JSON：W3C v00长度固定且不允许tracestate/baggage扩展信任边界。
 */
export const toolApprovalIntents = pgTable(
  'tool_approval_intents',
  {
    approvalId: text('approval_id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    protocolVersion: text('protocol_version').notNull(),
    toolCallId: uuid('tool_call_id')
      .notNull()
      .references(() => toolCalls.id, { onDelete: 'cascade' }),
    adapterSource: text('adapter_source').notNull(),
    resumeRef: text('resume_ref').notNull(),
    traceParent: text('trace_parent'),
    status: text('status').notNull().default('prepared'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    preparedAt: timestamp('prepared_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    boundAt: timestamp('bound_at', { withTimezone: true }),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
  },
  (table) => [
    index('tool_approval_intents_operation_fk_idx').on(table.operationId),
    uniqueIndex('tool_approval_intents_tool_call_unique').on(table.toolCallId),
    uniqueIndex('tool_approval_intents_adapter_resume_unique').on(
      table.adapterSource,
      table.resumeRef,
    ),
    index('tool_approval_intents_status_expiry_idx').on(
      table.status,
      table.expiresAt,
      table.preparedAt,
    ),
    check(
      'tool_approval_intents_status_check',
      sql`${table.status} in ('prepared', 'bound', 'abandoned')`,
    ),
    check(
      'tool_approval_intents_text_check',
      sql`${table.protocolVersion} = 'educanvas.tool-approval-intent.v1' and char_length(${table.approvalId}) between 1 and 256 and ${table.approvalId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' and ${table.adapterSource} in ('local', 'teaching', 'mcp', 'node') and char_length(${table.resumeRef}) between 1 and 256 and ${table.resumeRef} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'`,
    ),
    check(
      'tool_approval_intents_trace_parent_check',
      sql`${table.traceParent} is null or (char_length(${table.traceParent}) = 55 and ${table.traceParent} ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$' and substring(${table.traceParent} from 4 for 32) <> repeat('0', 32) and substring(${table.traceParent} from 37 for 16) <> repeat('0', 16))`,
    ),
    check(
      'tool_approval_intents_lifecycle_check',
      sql`(${table.status} = 'prepared' and ${table.boundAt} is null and ${table.abandonedAt} is null) or (${table.status} = 'bound' and ${table.boundAt} is not null and ${table.abandonedAt} is null) or (${table.status} = 'abandoned' and ${table.boundAt} is null and ${table.abandonedAt} is not null)`,
    ),
    check(
      'tool_approval_intents_time_check',
      sql`${table.expiresAt} > ${table.preparedAt} and (${table.boundAt} is null or ${table.boundAt} >= ${table.preparedAt}) and (${table.abandonedAt} is null or ${table.abandonedAt} >= ${table.preparedAt})`,
    ),
  ],
);

/**
 * 高风险工具/外部等待的耐久执行游标。只保存稳定业务引用、lease与可空W3C父上下文，
 * 不保存Prompt、消息正文、工具参数、Credential、Secret或副作用结果。trace_parent仅用于观测，不参与业务状态。
 */
export const operationContinuations = pgTable(
  'operation_continuations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    protocolVersion: text('protocol_version').notNull(),
    kind: text('kind').notNull(),
    step: text('step').notNull(),
    approvalId: text('approval_id').notNull(),
    toolCallId: uuid('tool_call_id')
      .notNull()
      .references(() => toolCalls.id, { onDelete: 'cascade' }),
    adapterSource: text('adapter_source').notNull(),
    resumeRef: text('resume_ref').notNull(),
    traceParent: text('trace_parent'),
    status: text('status').notNull().default('waiting_approval'),
    leaseGeneration: integer('lease_generation').notNull().default(0),
    leaseOwnerId: text('lease_owner_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('operation_continuations_operation_sequence_unique').on(
      table.operationId,
      table.sequence,
    ),
    uniqueIndex('operation_continuations_active_operation_unique')
      .on(table.operationId)
      .where(sql`${table.status} in ('waiting_approval', 'ready', 'running')`),
    uniqueIndex('operation_continuations_approval_unique').on(table.approvalId),
    uniqueIndex('operation_continuations_tool_call_unique').on(
      table.toolCallId,
    ),
    uniqueIndex('operation_continuations_adapter_resume_unique').on(
      table.adapterSource,
      table.resumeRef,
    ),
    index('operation_continuations_claim_idx').on(
      table.status,
      table.leaseExpiresAt,
      table.updatedAt,
    ),
    check(
      'operation_continuations_kind_check',
      sql`${table.sequence} between 1 and 1000 and ${table.kind} = 'tool_approval' and ${table.step} = 'tool.invoke'`,
    ),
    check(
      'operation_continuations_status_check',
      sql`${table.status} in ('waiting_approval', 'ready', 'running', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      'operation_continuations_text_check',
      sql`${table.protocolVersion} = 'educanvas.operation-continuation.v1' and char_length(${table.approvalId}) between 1 and 256 and ${table.approvalId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' and ${table.adapterSource} in ('local', 'teaching', 'mcp', 'node') and char_length(${table.resumeRef}) between 1 and 256 and ${table.resumeRef} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' and (${table.leaseOwnerId} is null or (char_length(${table.leaseOwnerId}) between 1 and 256 and ${table.leaseOwnerId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')) and (${table.failureCode} is null or ${table.failureCode} ~ '^[a-z][a-z0-9._:-]{0,127}$')`,
    ),
    check(
      'operation_continuations_trace_parent_check',
      sql`${table.traceParent} is null or (char_length(${table.traceParent}) = 55 and ${table.traceParent} ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$' and substring(${table.traceParent} from 4 for 32) <> repeat('0', 32) and substring(${table.traceParent} from 37 for 16) <> repeat('0', 16))`,
    ),
    check(
      'operation_continuations_lease_check',
      sql`${table.leaseGeneration} between 0 and 1000000 and ((${table.status} = 'running' and ${table.leaseGeneration} >= 1 and ${table.leaseOwnerId} is not null and ${table.leaseExpiresAt} is not null and ${table.heartbeatAt} is not null) or (${table.status} <> 'running' and ${table.leaseOwnerId} is null and ${table.leaseExpiresAt} is null and ${table.heartbeatAt} is null))`,
    ),
    check(
      'operation_continuations_terminal_check',
      sql`((${table.status} in ('completed', 'failed', 'cancelled')) = (${table.completedAt} is not null)) and ((${table.status} = 'failed') = (${table.failureCode} is not null))`,
    ),
    check(
      'operation_continuations_time_check',
      sql`${table.updatedAt} >= ${table.createdAt} and (${table.completedAt} is null or ${table.completedAt} >= ${table.createdAt})`,
    ),
  ],
);

/**
 * Turn 输入/输出的安全决策审计。该表刻意不提供正文、Prompt、推理或 detector payload 字段，
 * 只保存可关联、可版本化的稳定分类结果。
 */
export const turnSafetyDecisions = pgTable(
  'turn_safety_decisions',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').notNull(),
    phase: text('phase').notNull(),
    policyVersion: text('policy_version').notNull(),
    category: text('category').notNull(),
    action: text('action').notNull(),
    detectorVersion: text('detector_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'turn_safety_decisions_turn_phase_policy_category_pk',
      columns: [table.turnId, table.phase, table.policyVersion, table.category],
    }),
    index('turn_safety_decisions_session_turn_created_idx').on(
      table.sessionId,
      table.turnId,
      table.createdAt,
    ),
    index('turn_safety_decisions_category_action_created_idx').on(
      table.category,
      table.action,
      table.createdAt,
    ),
    check(
      'turn_safety_decisions_phase_check',
      sql`${table.phase} in ('input', 'output')`,
    ),
    check(
      'turn_safety_decisions_category_check',
      sql`${table.category} in ('normal', 'pii', 'prompt_injection', 'self_harm', 'abuse', 'sexual_content', 'violence', 'dangerous_behavior')`,
    ),
    check(
      'turn_safety_decisions_action_check',
      sql`${table.action} in ('allow', 'block', 'escalate')`,
    ),
    check(
      'turn_safety_decisions_policy_version_check',
      sql`${table.policyVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'`,
    ),
    check(
      'turn_safety_decisions_detector_version_check',
      sql`${table.detectorVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'`,
    ),
  ],
);
