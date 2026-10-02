import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { platformUsers } from './identity';
import { spaces } from './workspace';
import {
  agentOperations,
  conversationMessages,
  conversations,
} from './conversation';

/** No prompt or provider output is retained in a user confirmation request. */
export const artifactConfirmationRequests = pgTable(
  'artifact_confirmation_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    userMessageId: uuid('user_message_id')
      .notNull()
      .references(() => conversationMessages.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    notebookId: uuid('notebook_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    artifactKind: text('artifact_kind').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('pending'),
    confirmedKind: text('confirmed_kind'),
    confirmationMessageId: text('confirmation_message_id'),
    attemptNumber: integer('attempt_number').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('artifact_confirmation_requests_operation_unique').on(
      table.operationId,
    ),
    index('artifact_confirmation_requests_conversation_status_idx').on(
      table.conversationId,
      table.status,
      table.createdAt,
    ),
    check(
      'artifact_confirmation_requests_scope_check',
      sql`char_length(${table.notebookId}::text) = 36 and char_length(${table.conversationId}::text) = 36 and char_length(${table.actorUserId}) between 1 and 128`,
    ),
    check(
      'artifact_confirmation_requests_kind_check',
      sql`${table.artifactKind} in ('markdown_document', 'mind_map', 'slides', 'flashcards', 'picturebook', 'note', 'web_app') and (${table.confirmedKind} is null or ${table.confirmedKind} in ('markdown_document', 'mind_map', 'slides', 'flashcards', 'picturebook', 'note', 'web_app'))`,
    ),
    check(
      'artifact_confirmation_requests_status_check',
      sql`${table.status} in ('pending', 'confirmed', 'cancelled') and ((${table.status} = 'pending' and ${table.confirmedKind} is null and ${table.confirmationMessageId} is null) or (${table.status} = 'confirmed' and ${table.confirmedKind} is not null and ${table.confirmationMessageId} is not null) or (${table.status} = 'cancelled' and ${table.confirmedKind} is null and ${table.confirmationMessageId} is null))`,
    ),
    check(
      'artifact_confirmation_requests_title_check',
      sql`char_length(btrim(${table.title})) between 1 and 120`,
    ),
    check(
      'artifact_confirmation_requests_attempt_check',
      sql`${table.attemptNumber} between 1 and 1000`,
    ),
    foreignKey({
      columns: [table.conversationId, table.notebookId],
      foreignColumns: [conversations.id, conversations.spaceId],
      name: 'artifact_confirmation_requests_conversation_notebook_fk',
    }).onDelete('cascade'),
  ],
);
