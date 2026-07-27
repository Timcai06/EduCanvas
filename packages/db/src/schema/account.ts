import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { platformUsers } from '../schema';

/**
 * Web 账号凭据边界；只保存版本化的派生密码材料，
 * 不保存明文密码或原始 session token。
 */
export const webUserCredentials = pgTable(
  'web_user_credentials',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    usernameNormalized: text('username_normalized').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    passwordParams: jsonb('password_params').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('web_user_credentials_username_unique').on(
      table.usernameNormalized,
    ),
    check(
      'web_user_credentials_username_check',
      sql`${table.usernameNormalized} ~ '^[a-z0-9][a-z0-9_-]{2,31}$'`,
    ),
    check(
      'web_user_credentials_password_material_check',
      sql`${table.passwordHash} ~ '^[A-Za-z0-9_-]{43,128}$' and ${table.passwordSalt} ~ '^[A-Za-z0-9_-]{16,128}$' and jsonb_typeof(${table.passwordParams}) = 'object'`,
    ),
  ],
);

/** Web 个人资料；头像只保存私有对象 key，浏览器通过受控 route 读取。 */
export const webUserProfiles = pgTable(
  'web_user_profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    avatarObjectKey: text('avatar_object_key'),
    avatarMimeType: text('avatar_mime_type'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'web_user_profiles_nickname_check',
      sql`char_length(${table.nickname}) between 1 and 30 and ${table.nickname} !~ '[[:cntrl:]]'`,
    ),
    check(
      'web_user_profiles_avatar_check',
      sql`(${table.avatarObjectKey} is null and ${table.avatarMimeType} is null) or (${table.avatarObjectKey} ~ '^assets/[a-f0-9]{16}/[0-9a-f-]+\\.[a-z0-9]+$' and ${table.avatarMimeType} in ('image/png', 'image/jpeg', 'image/webp'))`,
    ),
  ],
);

/** Web 登录 session；cookie 保存原始 token，数据库只保存 SHA-256 hash。 */
export const webSessions = pgTable(
  'web_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('web_sessions_token_hash_unique').on(table.tokenHash),
    index('web_sessions_user_active_idx').on(
      table.userId,
      table.expiresAt,
      table.revokedAt,
    ),
    check(
      'web_sessions_token_hash_check',
      sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'web_sessions_lifecycle_check',
      sql`${table.expiresAt} > ${table.createdAt} and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt})`,
    ),
  ],
);
