import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { spaces } from './workspace';

/**
 * 纸面批注（朱砂/墨笔痕迹）——canvas-protocol `annotate` action 的持久化实体。
 *
 * resourceKind + resourceId 是多态引用（assets.id / artifacts.id），不建 FK：
 * 批注跟随引用语义走 CanvasResource 协议，而不是绑定单一物理表；
 * resourceVersionId 记录批注绘制时所对的不可变版本（null = 针对整份资源）。
 *
 * ownerSubjectId 是可信服务端解析出的不透明主体（Notebook 所有者），生命周期
 * 归属它：Agent 写下的朱砂批注也是落在学生纸上的痕迹，随学生数据一起清理。
 * ON DELETE restrict 强制 Space 删除前先清理批注（生命周期注册表保证顺序）。
 */
export const resourceAnnotations = pgTable(
  'resource_annotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'restrict' }),
    resourceKind: text('resource_kind').notNull(),
    resourceId: uuid('resource_id').notNull(),
    /** 批注绘制时面对的不可变版本；null 表示针对整份资源。 */
    resourceVersionId: uuid('resource_version_id'),
    ownerSubjectId: text('owner_subject_id').notNull(),
    /** 谁的笔：dai = 学生自己的墨笔；zhusha = 批改的笔（Agent/教师）。 */
    authorPen: text('author_pen').notNull(),
    kind: text('kind').notNull(),
    /** 归一化几何（0..1 坐标 + 可选 page/region），与渲染分辨率解耦。 */
    geometry: jsonb('geometry').notNull(),
    /** kind='note' 时的批注文字；其余 kind 可为空。 */
    body: text('body'),
    source: text('source').notNull(),
    /** 审计线索：产生该批注的 Agent operation（语音会话轮次等）。 */
    operationId: uuid('operation_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('resource_annotations_space_fk_idx').on(table.spaceId),
    index('resource_annotations_resource_idx').on(
      table.resourceKind,
      table.resourceId,
    ),
    index('resource_annotations_owner_space_idx').on(
      table.ownerSubjectId,
      table.spaceId,
    ),
    check(
      'resource_annotations_resource_kind_check',
      sql`${table.resourceKind} in ('asset', 'artifact')`,
    ),
    check(
      'resource_annotations_author_pen_check',
      sql`${table.authorPen} in ('dai', 'zhusha')`,
    ),
    check(
      'resource_annotations_kind_check',
      sql`${table.kind} in ('circle', 'underline', 'strike', 'note', 'seal')`,
    ),
    check(
      'resource_annotations_source_check',
      sql`${table.source} in ('voice', 'canvas', 'chat')`,
    ),
    check(
      'resource_annotations_geometry_check',
      sql`jsonb_typeof(${table.geometry}) = 'object'`,
    ),
    check(
      'resource_annotations_body_check',
      sql`(${table.kind} = 'note' and ${table.body} is not null and char_length(${table.body}) between 1 and 2000)
        or (${table.kind} <> 'note' and (${table.body} is null or char_length(${table.body}) <= 2000))`,
    ),
    check(
      'resource_annotations_owner_check',
      sql`char_length(${table.ownerSubjectId}) between 1 and 160`,
    ),
  ],
);
