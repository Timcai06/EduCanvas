import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { assets, assetVersions } from './asset';
import { conversations } from './conversation';
import { platformUsers } from './identity';
import { spaces } from './workspace';

/** User-confirmed source groups freeze the source version; no model-inferred chapter facts. */
export const notebookChapters = pgTable(
  'notebook_chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notebookId: uuid('notebook_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').notNull(),
    assetVersionId: uuid('asset_version_id').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'restrict' }),
    clientRequestId: uuid('client_request_id').notNull(),
    title: text('title').notNull(),
    locator: jsonb('locator')
      .$type<
        | { kind: 'whole' }
        | { kind: 'pages' | 'text'; start: number; end: number }
      >()
      .notNull(),
    origin: text('origin').notNull().default('user_grouped'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('notebook_chapters_id_notebook_unique').on(
      table.id,
      table.notebookId,
    ),
    uniqueIndex('notebook_chapters_request_unique').on(
      table.notebookId,
      table.createdByUserId,
      table.clientRequestId,
    ),
    index('notebook_chapters_asset_version_fk_idx').on(
      table.assetVersionId,
      table.assetId,
    ),
    index('notebook_chapters_asset_notebook_fk_idx').on(
      table.assetId,
      table.notebookId,
    ),
    foreignKey({
      columns: [table.assetId, table.notebookId],
      foreignColumns: [assets.id, assets.spaceId],
      name: 'notebook_chapters_asset_notebook_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.assetVersionId, table.assetId],
      foreignColumns: [assetVersions.id, assetVersions.assetId],
      name: 'notebook_chapters_version_asset_fk',
    }).onDelete('cascade'),
    check(
      'notebook_chapters_title_check',
      sql`char_length(${table.title}) between 1 and 120`,
    ),
    check(
      'notebook_chapters_origin_check',
      sql`${table.origin} = 'user_grouped'`,
    ),
    check(
      'notebook_chapters_locator_check',
      sql`jsonb_typeof(${table.locator}) = 'object' and (
    (${table.locator}->>'kind' = 'whole' and ${table.locator} - 'kind' = '{}'::jsonb) or
    (${table.locator}->>'kind' in ('pages','text') and ${table.locator} ?& array['start','end']::text[] and ${table.locator} - array['kind','start','end']::text[] = '{}'::jsonb and jsonb_typeof(${table.locator}->'start') = 'number' and jsonb_typeof(${table.locator}->'end') = 'number' and (${table.locator}->>'start')::numeric >= 0 and (${table.locator}->>'end')::numeric >= (${table.locator}->>'start')::numeric and (${table.locator}->>'start')::numeric = trunc((${table.locator}->>'start')::numeric) and (${table.locator}->>'end')::numeric = trunc((${table.locator}->>'end')::numeric)))`,
    ),
  ],
);

/** Plans organize user-authored work; Goal/Session/diagnostic/mastery remain authoritative study facts. */
export const notebookPlans = pgTable(
  'notebook_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notebookId: uuid('notebook_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'restrict' }),
    clientRequestId: uuid('client_request_id').notNull(),
    sourceKind: text('source_kind').notNull(),
    conversationId: uuid('conversation_id'),
    chapterId: uuid('chapter_id'),
    purpose: text('purpose'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('notebook_plans_request_unique').on(
      table.notebookId,
      table.createdByUserId,
      table.clientRequestId,
    ),
    index('notebook_plans_notebook_recent_idx').on(
      table.notebookId,
      table.createdAt,
      table.id,
    ),
    index('notebook_plans_conversation_fk_idx').on(
      table.conversationId,
      table.notebookId,
    ),
    index('notebook_plans_chapter_fk_idx').on(
      table.chapterId,
      table.notebookId,
    ),
    foreignKey({
      columns: [table.conversationId, table.notebookId],
      foreignColumns: [conversations.id, conversations.spaceId],
      name: 'notebook_plans_conversation_notebook_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.chapterId, table.notebookId],
      foreignColumns: [notebookChapters.id, notebookChapters.notebookId],
      name: 'notebook_plans_chapter_notebook_fk',
    }).onDelete('cascade'),
    check(
      'notebook_plans_source_check',
      sql`(${table.sourceKind} = 'conversation' and ${table.conversationId} is not null and ${table.chapterId} is null and ${table.purpose} is null) or (${table.sourceKind} = 'chapter' and ${table.chapterId} is not null and ${table.conversationId} is null and ${table.purpose} is null) or (${table.sourceKind} = 'purpose' and ${table.purpose} is not null and char_length(${table.purpose}) between 1 and 500 and ${table.conversationId} is null and ${table.chapterId} is null)`,
    ),
    check(
      'notebook_plans_status_check',
      sql`${table.status} in ('active','completed','archived')`,
    ),
    check(
      'notebook_plans_text_check',
      sql`char_length(${table.title}) between 1 and 120 and char_length(${table.description}) <= 5000`,
    ),
  ],
);
