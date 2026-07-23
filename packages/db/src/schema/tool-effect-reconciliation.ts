import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { toolEffects } from '../schema';

/**
 * 对 outcome_unknown Effect 的追加式权威决议；原始 Effect、Tool Call 与 Operation
 * 终态均不回写。本表只保存稳定身份与证据哈希，不保存参数、输出、Credential 或正文。
 * 状态使用text加CHECK以保持additive演进和旧应用回滚兼容；所有读写按effect_id主键，
 * 当前没有批量调度查询，因此不为低基数字段建立额外索引。
 */
export const toolEffectReconciliations = pgTable(
  'tool_effect_reconciliations',
  {
    effectId: uuid('effect_id')
      .primaryKey()
      .references(() => toolEffects.id, { onDelete: 'cascade' }),
    resolution: text('resolution').notNull(),
    source: text('source').notNull(),
    resolverId: text('resolver_id').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    receiptHash: text('receipt_hash'),
    code: text('code'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'tool_effect_reconciliations_resolution_check',
      sql`${table.resolution} in ('confirmed_committed', 'confirmed_not_committed')`,
    ),
    check(
      'tool_effect_reconciliations_source_check',
      sql`${table.source} in ('manual', 'adapter')`,
    ),
    check(
      'tool_effect_reconciliations_text_check',
      sql`${table.resolverId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' and ${table.evidenceHash} ~ '^[a-f0-9]{64}$' and (${table.receiptHash} is null or ${table.receiptHash} ~ '^[a-f0-9]{64}$') and (${table.code} is null or ${table.code} ~ '^[a-z][a-z0-9._:-]{0,127}$')`,
    ),
    check(
      'tool_effect_reconciliations_shape_check',
      sql`(${table.resolution} = 'confirmed_committed' and ${table.code} is null) or (${table.resolution} = 'confirmed_not_committed' and ${table.receiptHash} is null and ${table.code} is not null)`,
    ),
  ],
);
