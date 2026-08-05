import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { assetVersions, platformUsers } from '../schema';

/**
 * 音频处理同意目的封闭三值（ADR-0022 §2）。三个目的互相独立、不可互相
 * 隐含：实时处理、本地留存、云端外传必须分别获得单独同意，任何一条路径
 * 都只检查与自身 purpose 匹配的 active 同意。
 */
export const audioConsentPurposes = [
  'voice_processing',
  'audio_retention',
  'cloud_transcription',
] as const;

/**
 * 同意授权依据的有界证明方式。`*_self_attested` 只允许开发/演示组合启用；
 * 生产组合必须由 V14/V17 要求对应的 `*_verified` 事实。
 */
export const audioConsentProofMethods = [
  'adult_self_attested',
  'adult_verified',
  'guardian_self_attested',
  'guardian_verified',
] as const;

/**
 * 监护人单独同意事实（ADR-0022）。独立于 `delegated_grants`——委托语义
 * 不能冒充同意（schema.ts 的 delegated_grants 注释）；也不从
 * `learner_profiles.age_band` 推断授权能力：age_band 是自我声明，不是
 * 监护关系证明，所有非 adult 与 unknown 年龄段 fail closed 走 guardian。
 *
 * 授权形态由 `authorizationType` 显式声明并由 check 强制：
 * - self：本人同意，要求 grantor = subject；
 * - guardian：监护人同意，要求 grantor ≠ subject。
 *
 * 本表不保存证件图片、Prompt、Provider body 或任何 Secret；撤回后同主体
 * 同目的需重新征求（同一主体+目的只允许一条 active 记录）。
 */
export const audioConsents = pgTable(
  'audio_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 数据主体（学生本人）。restrict 保留同意审计链，禁止静默级联删除。 */
    subjectUserId: text('subject_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'restrict' }),
    /** 授权人。restrict：授权人被删除前必须先处理其同意记录，防止静默失效。 */
    grantorUserId: text('grantor_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'restrict' }),
    /** self = 本人同意；guardian = 监护人同意（非 adult/unknown 必须 guardian）。 */
    authorizationType: text('authorization_type').notNull(),
    /** 审计同意为何有权授予；生产是否可用由 V14/V17 按环境 fail closed。 */
    proofMethod: text('proof_method').notNull(),
    /** 指向受控声明/核验事实的稳定引用，不保存证件图片或原始材料。 */
    proofReference: text('proof_reference').notNull(),
    purpose: text('purpose').notNull(),
    /** 同意文案/条款版本；文案、目的或处理方式变化必须重新征求。 */
    consentVersion: text('consent_version').notNull(),
    /** 展示文案版本，与用户实际看到的 notice 一一对应。 */
    noticeVersion: text('notice_version').notNull(),
    status: text('status').notNull().default('active'),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '12 months'`),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('audio_consents_subject_purpose_active_unique')
      .on(table.subjectUserId, table.purpose)
      .where(sql`${table.status} = 'active'`),
    // 供 audio_retentions 的 composite FK 强校验（purpose/subject 必须一致）。
    // 必须是 CREATE TABLE 内的 UNIQUE 约束而不是独立索引：drizzle 生成迁移时
    // 会把索引放在 ALTER TABLE FK 之后，而 PostgreSQL 要求 FK 引用时父表唯一
    // 约束已存在，否则报 42830。
    unique('audio_consents_id_purpose_subject_unique').on(
      table.id,
      table.purpose,
      table.subjectUserId,
    ),
    index('audio_consents_subject_status_idx').on(
      table.subjectUserId,
      table.status,
    ),
    check(
      'audio_consents_authorization_check',
      sql`${table.authorizationType} in ('self', 'guardian')
        and ((${table.authorizationType} = 'self'
              and ${table.grantorUserId} = ${table.subjectUserId}
              and ${table.proofMethod} in ('adult_self_attested', 'adult_verified'))
          or (${table.authorizationType} = 'guardian'
              and ${table.grantorUserId} <> ${table.subjectUserId}
              and ${table.proofMethod} in ('guardian_self_attested', 'guardian_verified')))`,
    ),
    check(
      'audio_consents_purpose_check',
      sql`${table.purpose} in ('voice_processing', 'audio_retention', 'cloud_transcription')`,
    ),
    check(
      'audio_consents_status_check',
      sql`${table.status} in ('active', 'revoked')`,
    ),
    check(
      'audio_consents_lifecycle_check',
      sql`(${table.status} = 'active' and ${table.revokedAt} is null)
        or (${table.status} = 'revoked' and ${table.revokedAt} is not null)`,
    ),
    check(
      'audio_consents_time_check',
      sql`${table.expiresAt} > ${table.grantedAt}
        and ${table.expiresAt} <= ${table.grantedAt} + interval '12 months'
        and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt})`,
    ),
    check(
      'audio_consents_version_check',
      sql`char_length(${table.consentVersion}) between 1 and 64
        and char_length(${table.noticeVersion}) between 1 and 64
        and char_length(${table.proofReference}) between 1 and 256`,
    ),
  ],
);

/**
 * 原始音频留存事实（ADR-0022 §3）。只记录元数据与生命周期：
 * 不复制 storageKey（服务端 Asset 约束），不存音频字节，不存转录文本
 * （文本生命周期跟随对话/Asset 历史，独立于 7 天音频期限）。
 *
 * 数据库层强制的跨表不变量：
 * - consentPurpose 恒为 'audio_retention'（check）；
 * - 引用的 consent 行必须 purpose=audio_retention 且 subject 与
 *   subjectUserId 一致（composite FK + check）；
 * - 创建时锁定 consent 行并确认未撤回且未过期，避免与撤回并发穿透；
 * - expiresAt ∈ [createdAt, createdAt + 7 days]（check，上界只能缩短）；
 * - 同一 assetVersion 只允许一条留存记录（unique），身份和期限不可变；
 * - 同意与留存事实禁止物理删除，只能走状态转换和删除 Outbox；
 * - 删除意图由 `object_deletion_outbox` 复用承担，本表不建第二套 Outbox。
 */
export const audioRetentions = pgTable(
  'audio_retentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectUserId: text('subject_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'restrict' }),
    consentId: uuid('consent_id').notNull(),
    /** 冗余 purpose 仅为 composite FK 强校验（见 audio_consents 唯一索引）。 */
    consentPurpose: text('consent_purpose').notNull(),
    assetVersionId: uuid('asset_version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 撤回或到期时写入删除意图的时间；复用 object_deletion_outbox 删除。 */
    deletionRequestedAt: timestamp('deletion_requested_at', {
      withTimezone: true,
    }),
  },
  (table) => [
    uniqueIndex('audio_retentions_asset_version_unique').on(
      table.assetVersionId,
    ),
    index('audio_retentions_subject_status_idx').on(
      table.subjectUserId,
      table.status,
    ),
    index('audio_retentions_consent_fk_idx').on(table.consentId),
    index('audio_retentions_expiry_idx').on(table.status, table.expiresAt),
    foreignKey({
      columns: [table.consentId, table.consentPurpose, table.subjectUserId],
      foreignColumns: [
        audioConsents.id,
        audioConsents.purpose,
        audioConsents.subjectUserId,
      ],
      name: 'audio_retentions_consent_purpose_subject_fk',
    }).onDelete('restrict'),
    check(
      'audio_retentions_purpose_check',
      sql`${table.consentPurpose} = 'audio_retention'`,
    ),
    check(
      'audio_retentions_status_check',
      sql`${table.status} in ('active', 'deletion_requested')`,
    ),
    check(
      'audio_retentions_time_check',
      sql`${table.expiresAt} >= ${table.createdAt}
        and ${table.expiresAt} <= ${table.createdAt} + interval '7 days'`,
    ),
    check(
      'audio_retentions_lifecycle_check',
      sql`(${table.status} = 'active' and ${table.deletionRequestedAt} is null)
        or (${table.status} = 'deletion_requested' and ${table.deletionRequestedAt} is not null)`,
    ),
  ],
);
