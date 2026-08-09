import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { platformUsers } from './identity';

/** 通用资产、会话和产物的长期容器；不包含课程或教学状态。 */
export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerSubjectId: text('owner_subject_id').notNull(),
    kind: text('kind').notNull().default('personal'),
    title: text('title').notNull(),
    status: text('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('spaces_owner_status_updated_idx').on(
      table.ownerSubjectId,
      table.status,
      table.updatedAt,
      table.id,
    ),
    check(
      'spaces_kind_check',
      sql`${table.kind} in ('personal', 'notebook', 'course')`,
    ),
    check(
      'spaces_status_check',
      sql`${table.status} in ('active', 'archived')`,
    ),
    check(
      'spaces_text_check',
      sql`char_length(${table.ownerSubjectId}) between 1 and 160 and char_length(${table.title}) between 1 and 300`,
    ),
    check(
      'spaces_archive_shape_check',
      sql`(${table.status} = 'active' and ${table.archivedAt} is null) or (${table.status} = 'archived' and ${table.archivedAt} is not null)`,
    ),
  ],
);

/** Notebook 协作只共享显式资源，不传播个人 Agent 的私有权限。 */
export const notebookMemberships = pgTable(
  'notebook_memberships',
  {
    notebookId: uuid('notebook_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.notebookId, table.userId] }),
    index('notebook_memberships_user_active_idx').on(
      table.userId,
      table.revokedAt,
      table.notebookId,
    ),
    check(
      'notebook_memberships_role_check',
      sql`${table.role} in ('owner', 'editor', 'contributor', 'viewer')`,
    ),
    check(
      'notebook_memberships_time_check',
      sql`(${table.expiresAt} is null or ${table.expiresAt} > ${table.grantedAt}) and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt})`,
    ),
  ],
);

/** 教师、家长和管理员的范围委托；不能用于主体冒充。 */
export const delegatedGrants = pgTable(
  'delegated_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    granteeUserId: text('grantee_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    subjectUserId: text('subject_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    notebookId: uuid('notebook_id').references(() => spaces.id, {
      onDelete: 'cascade',
    }),
    scopes: text('scopes').array().notNull(),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('delegated_grants_notebook_fk_idx').on(table.notebookId),
    index('delegated_grants_grantee_active_idx').on(
      table.granteeUserId,
      table.expiresAt,
      table.revokedAt,
    ),
    check(
      'delegated_grants_kind_check',
      sql`${table.kind} in ('education.teacher', 'education.guardian', 'platform.operator')`,
    ),
    check(
      'delegated_grants_time_check',
      sql`${table.expiresAt} > ${table.grantedAt} and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt})`,
    ),
    check(
      'delegated_grants_scopes_check',
      sql`cardinality(${table.scopes}) between 1 and 16`,
    ),
  ],
);
