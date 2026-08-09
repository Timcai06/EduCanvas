import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// 阶段一模块化单体的现行表集。它同时包含通用 Agent/Asset/RAG 账本和 K12 纵切，
// 物理同库不代表领域同层；目标边界与迁移顺序见 docs/04-data/02-数据设计.md。
//
// 索引命名 `*_fk_idx` 专指「为外键强制查询兜底」的索引，不服务任何业务读取。
// 父行删除时 PostgreSQL 会对每条被删行在子表上做等值探测；缺索引时该探测退化为
// 顺序扫描，并在删除期间放大锁窗口。这类索引只在父表确实存在生产删除路径时才
// 添加——判定依据与 EXPLAIN 证据见 docs/04-data/03-外键索引审计.md。

/** 正式平台主体；匿名兼容主体也使用服务端派生 ID，不保存原始 bearer。 */
export const platformUsers = pgTable(
  'platform_users',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'platform_users_id_check',
      sql`char_length(${table.id}) between 1 and 160`,
    ),
    check(
      'platform_users_kind_check',
      sql`${table.kind} in ('registered', 'anonymous_compat')`,
    ),
    check(
      'platform_users_status_check',
      sql`${table.status} in ('active', 'suspended', 'deleted')`,
    ),
  ],
);

/**
 * 安全与权限变更的只追加审计账本。metadata 仅允许稳定标识和公开原因码，
 * 不得写入密码、Cookie、Prompt、Provider 原文或堆栈。
 */
export const securityAuditEvents = pgTable(
  'security_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: text('actor_user_id').references(() => platformUsers.id, {
      onDelete: 'set null',
    }),
    eventType: text('event_type').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    outcome: text('outcome').notNull(),
    reasonCode: text('reason_code'),
    requestId: text('request_id'),
    metadata: jsonb('metadata')
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('security_audit_events_actor_time_idx').on(
      table.actorUserId,
      table.occurredAt,
      table.id,
    ),
    index('security_audit_events_type_time_idx').on(
      table.eventType,
      table.occurredAt,
      table.id,
    ),
    check(
      'security_audit_events_outcome_check',
      sql`${table.outcome} in ('succeeded', 'denied', 'failed')`,
    ),
    check(
      'security_audit_events_text_check',
      sql`char_length(${table.eventType}) between 1 and 128 and (${table.resourceType} is null or char_length(${table.resourceType}) between 1 and 64) and (${table.resourceId} is null or char_length(${table.resourceId}) between 1 and 180) and (${table.reasonCode} is null or char_length(${table.reasonCode}) between 1 and 128) and (${table.requestId} is null or char_length(${table.requestId}) between 1 and 160)`,
    ),
    check(
      'security_audit_events_metadata_check',
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
  ],
);

/** 当前产品模型是一位自然人一个个人 Agent；专业行为通过 Profile/Skill 组合。 */
export const personalAgents = pgTable(
  'personal_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('personal_agents_user_unique').on(table.userId),
    check(
      'personal_agents_status_check',
      sql`${table.status} in ('active', 'suspended')`,
    ),
  ],
);
