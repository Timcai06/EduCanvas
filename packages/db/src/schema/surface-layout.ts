import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { spaces } from './workspace';

/** 每位成员自己的案面布局；共享 Notebook 不共享个人注意力与摆放位置。 */
export const notebookSurfacePositions = pgTable(
  'notebook_surface_positions',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'restrict' }),
    ownerSubjectId: text('owner_subject_id').notNull(),
    resourceKind: text('resource_kind').notNull(),
    resourceId: uuid('resource_id').notNull(),
    zone: text('zone').notNull(),
    x: real('x').notNull(),
    y: real('y').notNull(),
    z: integer('z').notNull(),
    restState: text('rest_state').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.spaceId,
        table.ownerSubjectId,
        table.resourceKind,
        table.resourceId,
      ],
    }),
    index('notebook_surface_positions_owner_updated_idx').on(
      table.ownerSubjectId,
      table.spaceId,
      table.updatedAt,
    ),
    check(
      'notebook_surface_positions_resource_kind_check',
      sql`${table.resourceKind} in ('source', 'artifact')`,
    ),
    check(
      'notebook_surface_positions_zone_check',
      sql`${table.zone} in ('center', 'periphery', 'margin')`,
    ),
    check(
      'notebook_surface_positions_rest_state_check',
      sql`${table.restState} in ('open', 'folded', 'pinned')`,
    ),
    check(
      'notebook_surface_positions_coordinates_check',
      sql`${table.x} between 0 and 1 and ${table.y} between 0 and 1 and ${table.z} between 0 and 100`,
    ),
    check(
      'notebook_surface_positions_owner_check',
      sql`char_length(${table.ownerSubjectId}) between 1 and 160`,
    ),
  ],
);
