import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { assets } from './asset';

/**
 * 成员对 Notebook 来源的启用/停用事实流。
 *
 * 为什么按成员而不是按 Notebook：启用与否是「这轮对话我要不要带这份资料」的
 * 个人选择，多人笔记本里不应互相覆盖。因此它不是资源动作（不进
 * `canvasResourceActions`），viewer 也能改自己的绑定；删除和重命名才是共享事实，
 * 仍需 owner/editor。
 *
 * 为什么是追加事实流而不是一列布尔：与 `session_source_bindings` 保持同一范式，
 * 保留切换历史用于审计，并靠 `mutationId` 让重放不产生第二条事实。
 * 当前值 = 同一 `(subjectId, assetId)` 下 `sequence` 最大的那条。
 *
 * 不存 notebookId：它可由 `assets.spaceId` 唯一确定，denormalize 只会引入漂移；
 * 按 Notebook 过滤时 join assets 即可。
 */
export const notebookAssetBindings = pgTable(
  'notebook_asset_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: text('subject_id').notNull(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    enabled: boolean('enabled').notNull(),
    mutationId: text('mutation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('notebook_asset_bindings_asset_fk_idx').on(table.assetId),
    uniqueIndex('notebook_asset_bindings_subject_mutation_unique').on(
      table.subjectId,
      table.mutationId,
    ),
    uniqueIndex('notebook_asset_bindings_subject_asset_sequence_unique').on(
      table.subjectId,
      table.assetId,
      table.sequence,
    ),
    /* 最新绑定读取复用 notebook_asset_bindings_subject_asset_sequence_unique：
       列与顺序完全相同，重复索引只增加写放大。 */
    check(
      'notebook_asset_bindings_sequence_check',
      sql`${table.sequence} >= 1`,
    ),
    check(
      'notebook_asset_bindings_text_shape_check',
      sql`char_length(${table.subjectId}) between 1 and 160 and char_length(${table.mutationId}) between 1 and 128`,
    ),
  ],
);
