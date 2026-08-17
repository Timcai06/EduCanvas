import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { assetVersions } from './asset';

/**
 * 网页版本的最小、安全溯源。URL 是来源身份而不是对象存储位置；原始响应仍只在
 * asset_versions.storage_key 指向的私有对象中。1:1 主键禁止同一不可变版本被
 * 就地改写成另一次抓取结果。
 */
export const assetWebSnapshots = pgTable(
  'asset_web_snapshots',
  {
    assetVersionId: uuid('asset_version_id')
      .primaryKey()
      .references(() => assetVersions.id, { onDelete: 'cascade' }),
    requestedUrl: text('requested_url').notNull(),
    finalUrl: text('final_url').notNull(),
    responseContentType: text('response_content_type').notNull(),
    pageTitle: text('page_title'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('asset_web_snapshots_fetched_idx').on(table.fetchedAt),
    check(
      'asset_web_snapshots_url_shape_check',
      sql`char_length(${table.requestedUrl}) between 1 and 2048 and char_length(${table.finalUrl}) between 1 and 2048 and ${table.requestedUrl} ~* '^https?://' and ${table.finalUrl} ~* '^https?://'`,
    ),
    check(
      'asset_web_snapshots_text_shape_check',
      sql`char_length(${table.responseContentType}) between 1 and 255 and (${table.pageTitle} is null or char_length(${table.pageTitle}) between 1 and 300)`,
    ),
  ],
);
