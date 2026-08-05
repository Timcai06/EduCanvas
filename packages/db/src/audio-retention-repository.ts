/**
 * 音频留存 Repository（ADR-0022 §3/§4、V14）。
 *
 * 单一职责：留存创建、本人/监护人读取、读取审计、撤回与到期扫描的数据库
 * 访问边界。所有方法在单个数据库事务内完成状态转换与删除意图写入；
 * storageKey 只在服务端事务内部从 asset_versions 读取并写入
 * objectDeletionOutbox，永不进入公共 DTO（见 `audio-retention-types.ts`）。
 * 读取授权纯判定见 `audio-retention-access.ts`。
 *
 * 安全模型：
 * - 创建与撤回都先对 consent 行加 FOR UPDATE 锁，与 V11 触发器
 *   `audio_retentions_consent_valid` 一起构成 fail-closed 双防线；
 * - 读取按"本人 / verified_guardian"矩阵授权，其余主体统一拒绝且错误
 *   不可区分（对外）；每次读取（成功或拒绝）写 securityAuditEvents，
 *   审计写入与成功读取同一事务，审计失败不得静默返回成功。
 */

import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { getDb } from './client';
import { appendSecurityAuditEvent } from './security-audit-repository';
import { assets, assetVersions } from './schema';
import { audioConsents, audioRetentions } from './schema/audio-consent';
import {
  AUDIO_RETENTION_READ_EVENT_TYPE,
  AUDIO_RETENTION_RESOURCE_TYPE,
  authorizeRead,
  toSummary,
  type RetentionRow,
} from './audio-retention-access';
export {
  AUDIO_RETENTION_READ_EVENT_TYPE,
  AUDIO_RETENTION_RESOURCE_TYPE,
} from './audio-retention-access';
import { enqueueDeletionIntents } from './audio-retention-lifecycle';
import {
  AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES,
  AudioRetentionAccessError,
  AudioRetentionConsentError,
  AudioRetentionPeriodError,
  AudioRetentionPersistenceError,
  audioRetentionAuditReasonCodes,
  type AudioRetentionGuardianProofPolicy,
  type AudioRetentionRevokeResult,
  type AudioRetentionScanResult,
  type AudioRetentionSummary,
  type CreateAudioRetentionInput,
  type ReadAudioRetentionInput,
} from './audio-retention-types';

type Database = ReturnType<typeof getDb>;
type DatabaseClockRow = Record<string, unknown> & { now: Date | string };

/** postgres-js 对裸 SQL timestamptz 可能返回 Date 或 ISO 字符串，统一归一化。 */
function parseDatabaseClock(row: DatabaseClockRow | undefined): Date {
  const now = row?.now instanceof Date ? row.now : new Date(String(row?.now));
  if (!Number.isFinite(now.getTime()))
    throw new AudioRetentionPersistenceError();
  return now;
}

/** 到期扫描单批上限；与 objectDeletionOutbox.claimBatch 的量级一致。 */
export const AUDIO_RETENTION_MAX_BATCH = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
/** ADR-0022 §2：留存上界固定 7 天，配置只能缩短。 */
const MAX_RETENTION_MS = 7 * DAY_MS;

/** postgres-js 把服务端错误放在 error.cause（PostgresError.code）。 */
function readPostgresErrorCode(error: unknown): string | undefined {
  return (error as { cause?: { code?: string } }).cause?.code;
}

/** 授权形态由 authorizationType 与 proofMethod 组合决定（V14-C 校验项）。 */
function isValidAuthorizationShape(
  authorizationType: string,
  proofMethod: string,
): boolean {
  if (authorizationType === 'self') {
    return (
      proofMethod === 'adult_self_attested' || proofMethod === 'adult_verified'
    );
  }
  if (authorizationType === 'guardian') {
    return (
      proofMethod === 'guardian_self_attested' ||
      proofMethod === 'guardian_verified'
    );
  }
  return false;
}

/** 把数据库/触发器/审计错误折叠为稳定错误，领域错误原样透传。 */
function toStableError(error: unknown): Error {
  if (
    error instanceof AudioRetentionAccessError ||
    error instanceof AudioRetentionConsentError ||
    error instanceof AudioRetentionPeriodError ||
    error instanceof AudioRetentionPersistenceError
  ) {
    return error;
  }
  return new AudioRetentionPersistenceError();
}

export interface AudioRetentionRepositoryOptions {
  /** 测试注入用；缺省使用进程内 getDb() 单例。 */
  database?: Database;
  /**
   * 监护证明策略（见 `audio-retention-types.ts`）。生产必须省略或传
   * `verified_only`；`allow_self_attested` 仅供显式开发/演示组合，浏览器
   * 请求参数永远无法覆盖该策略。
   */
  guardianProofPolicy?: AudioRetentionGuardianProofPolicy;
}

/**
 * 音频留存服务端数据访问边界。构造参数中的开发策略只影响"读取"门禁，
 * 创建、撤回与到期扫描不因策略放宽而改变。
 */
export class AudioRetentionRepository {
  private readonly database: Database;
  private readonly guardianProofPolicy: AudioRetentionGuardianProofPolicy;

  constructor(options: AudioRetentionRepositoryOptions = {}) {
    this.database = options.database ?? getDb();
    this.guardianProofPolicy =
      options.guardianProofPolicy ??
      AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES.verifiedOnly;
  }

  /**
   * 创建留存（V14-C）。事务内锁定 consent 行并校验五项约束后插入；
   * 重复 assetVersion 幂等返回已存在行。期限默认 7 天、只允许缩短。
   * V11 触发器仍是最终 fail-closed 防线：并发撤回等未覆盖场景由数据库拒绝。
   */
  async createRetention(
    input: CreateAudioRetentionInput,
  ): Promise<AudioRetentionSummary> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [clock] = await transaction.execute<DatabaseClockRow>(
          sql`select now() as "now"`,
        );
        const now = parseDatabaseClock(clock);
        const [consent] = await transaction
          .select()
          .from(audioConsents)
          .where(eq(audioConsents.id, input.consentId))
          .for('update')
          .limit(1);
        if (
          !consent ||
          consent.subjectUserId !== input.subjectUserId ||
          consent.purpose !== 'audio_retention' ||
          consent.status !== 'active' ||
          consent.expiresAt.getTime() <= now.getTime()
        ) {
          throw new AudioRetentionConsentError();
        }
        // assetVersionId 是服务端对象引用，不能因为调用方持有 UUID 就允许
        // 绑定。这里同时验证版本归属、媒体类型和可读终态，避免撤回/到期
        // 时把其他主体或非音频对象送进删除 Outbox。
        const [ownedAudioVersion] = await transaction
          .select({ id: assetVersions.id })
          .from(assetVersions)
          .innerJoin(assets, eq(assetVersions.assetId, assets.id))
          .where(
            and(
              eq(assetVersions.id, input.assetVersionId),
              eq(assetVersions.kind, 'audio'),
              eq(assetVersions.status, 'ready'),
              eq(assets.kind, 'audio'),
              eq(assets.ownerSubjectId, input.subjectUserId),
            ),
          )
          .limit(1);
        if (!ownedAudioVersion) throw new AudioRetentionAccessError();
        if (
          !isValidAuthorizationShape(
            consent.authorizationType,
            consent.proofMethod,
          )
        ) {
          throw new AudioRetentionConsentError();
        }
        const expiresAt =
          input.expiresAt ?? new Date(now.getTime() + MAX_RETENTION_MS);
        if (
          expiresAt.getTime() < now.getTime() ||
          expiresAt.getTime() > now.getTime() + MAX_RETENTION_MS
        ) {
          throw new AudioRetentionPeriodError();
        }
        try {
          const [row] = await transaction
            .insert(audioRetentions)
            .values({
              subjectUserId: input.subjectUserId,
              consentId: input.consentId,
              consentPurpose: 'audio_retention',
              assetVersionId: input.assetVersionId,
              createdAt: now,
              expiresAt,
            })
            .onConflictDoNothing()
            .returning();
          if (row) return toSummary(row);
          // 唯一冲突：同一 assetVersion 已留存。onConflictDoNothing 让事务
          // 不被 23505 中止，此处返回既有行（幂等，不重复创建）。
          const [existing] = await transaction
            .select()
            .from(audioRetentions)
            .where(eq(audioRetentions.assetVersionId, input.assetVersionId))
            .limit(1);
          if (
            existing?.subjectUserId === input.subjectUserId &&
            existing.consentId === input.consentId
          ) {
            return toSummary(existing);
          }
          // UUID 冲突不等于幂等。不同主体或不同 consent 的既有行不得回显，
          // 否则会泄漏 retentionId/consentId/status 等跨主体元数据。
          if (existing) throw new AudioRetentionAccessError();
          throw new AudioRetentionPersistenceError();
        } catch (error) {
          const code = readPostgresErrorCode(error);
          if (code === '23514') {
            // 触发器 fail-closed（如并发撤回穿透）：归并为 consent 无效。
            throw new AudioRetentionConsentError();
          }
          throw error;
        }
      });
    } catch (error) {
      throw toStableError(error);
    }
  }

  /**
   * 读取留存（V14-D/V14-E）。授权矩阵见 `audio-retention-access.ts`；
   * 每次读取同事务写安全审计，允许/拒绝对外统一为
   * `audio_retention_access_denied`（不存在与无权不可区分，防资源探测）。
   */
  async readRetention(
    input: ReadAudioRetentionInput,
  ): Promise<AudioRetentionSummary> {
    const decision = await this.database
      .transaction(async (transaction) => {
        const [clock] = await transaction.execute<DatabaseClockRow>(
          sql`select now() as "now"`,
        );
        const now = parseDatabaseClock(clock);
        const [retention] = await transaction
          .select()
          .from(audioRetentions)
          .where(eq(audioRetentions.id, input.retentionId))
          .limit(1);
        if (!retention) {
          await appendSecurityAuditEvent(transaction, {
            actorUserId: input.requesterUserId,
            eventType: AUDIO_RETENTION_READ_EVENT_TYPE,
            resourceType: AUDIO_RETENTION_RESOURCE_TYPE,
            resourceId: input.retentionId,
            outcome: 'denied',
            reasonCode: audioRetentionAuditReasonCodes.notFound,
            metadata: {},
          });
          return null;
        }
        const [consent] = await transaction
          .select()
          .from(audioConsents)
          .where(eq(audioConsents.id, retention.consentId))
          .limit(1);
        const decision = authorizeRead(
          retention,
          consent ?? null,
          input.requesterUserId,
          this.guardianProofPolicy,
          now,
        );
        await appendSecurityAuditEvent(transaction, {
          actorUserId: input.requesterUserId,
          eventType: AUDIO_RETENTION_READ_EVENT_TYPE,
          resourceType: AUDIO_RETENTION_RESOURCE_TYPE,
          resourceId: retention.id,
          outcome: decision.allowed ? 'succeeded' : 'denied',
          reasonCode: decision.reasonCode,
          metadata: decision.metadata,
        });
        return decision;
      })
      .catch(() => {
        // 审计写入失败等数据库错误：不得静默返回成功（V14-E）。
        throw new AudioRetentionPersistenceError();
      });
    if (!decision || !decision.allowed || !decision.summary) {
      throw new AudioRetentionAccessError();
    }
    return decision.summary;
  }

  /**
   * 撤回同意（V14-F）。单事务：锁定 consent → active→revoked → 锁定该
   * consent 下所有 active retention → 读 assetVersion 的 storageKey（仅
   * 服务端事务内部）→ 写 objectDeletionOutbox（objectKind=asset,
   * sourceType=asset_version, sourceId=assetVersionId）→ retention 转
   * deletion_requested。Outbox 写入失败整体回滚；重复撤回幂等。
   * 请求主体必须是 consent 的 subject 或 grantor。
   */
  async revokeConsent(input: {
    consentId: string;
    requesterUserId: string;
  }): Promise<AudioRetentionRevokeResult> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [consent] = await transaction
          .select()
          .from(audioConsents)
          .where(eq(audioConsents.id, input.consentId))
          .for('update')
          .limit(1);
        if (!consent) throw new AudioRetentionConsentError();
        if (
          input.requesterUserId !== consent.subjectUserId &&
          input.requesterUserId !== consent.grantorUserId
        ) {
          throw new AudioRetentionAccessError();
        }
        if (consent.status === 'revoked') {
          return {
            consentId: consent.id,
            status: 'revoked' as const,
            revokedAt: consent.revokedAt!.toISOString(),
            deletionIntents: 0,
            alreadyRevoked: true,
          };
        }
        const now = new Date();
        // revokedAt 必须用数据库时钟：grantedAt 由 DB now() 写入，
        // 应用时钟偏差可能违反 audio_consents_time_check（revokedAt >= grantedAt）。
        const [revoked] = await transaction
          .update(audioConsents)
          .set({ status: 'revoked', revokedAt: sql`now()` })
          .where(eq(audioConsents.id, input.consentId))
          .returning({ revokedAt: audioConsents.revokedAt });
        const activeRetentions = await transaction
          .select()
          .from(audioRetentions)
          .where(
            and(
              eq(audioRetentions.consentId, input.consentId),
              eq(audioRetentions.status, 'active'),
            ),
          )
          .for('update');
        const deletionIntents = await enqueueDeletionIntents(
          transaction,
          activeRetentions,
          now,
        );
        return {
          consentId: consent.id,
          status: 'revoked' as const,
          revokedAt: (revoked?.revokedAt ?? now).toISOString(),
          deletionIntents,
          alreadyRevoked: false,
        };
      });
    } catch (error) {
      throw toStableError(error);
    }
  }

  /**
   * 到期扫描（V14-G）。有界批处理：limit 上限、按 expiresAt/id 确定性排序、
   * FOR UPDATE SKIP LOCKED 单写者，只领取 active 且已到期行；同一事务写
   * Outbox 并转 deletion_requested，崩溃未提交整体回滚，重跑幂等。
   * 本方法不实现定时器或 Worker（V15 才消费 Outbox）。
   */
  async scanExpiredRetentions(
    input: {
      limit?: number;
      now?: Date;
    } = {},
  ): Promise<AudioRetentionScanResult> {
    const limit = Math.max(
      1,
      Math.min(
        input.limit ?? AUDIO_RETENTION_MAX_BATCH,
        AUDIO_RETENTION_MAX_BATCH,
      ),
    );
    const now = input.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(audioRetentions)
          .where(
            and(
              eq(audioRetentions.status, 'active'),
              lte(audioRetentions.expiresAt, now),
            ),
          )
          .orderBy(asc(audioRetentions.expiresAt), asc(audioRetentions.id))
          .limit(limit)
          .for('update', { skipLocked: true });
        const deletionIntents = await enqueueDeletionIntents(
          transaction,
          rows,
          now,
        );
        return { scanned: rows.length, deletionIntents };
      });
    } catch (error) {
      throw toStableError(error);
    }
  }
}
