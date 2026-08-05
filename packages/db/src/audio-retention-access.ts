/**
 * 音频留存读取授权与审计投影（ADR-0022 §4、V14-D/V14-E）。
 *
 * 独立成模块的单一职责：把"谁可以读"的纯授权判定与安全审计元数据投影
 * 从事务编排中分离出来，便于逐分支验证。本文件不含任何数据库写入；
 * 读取事务编排见 `audio-retention-repository.ts`。
 *
 * 授权矩阵（对外统一失败，拒绝原因只进审计）：
 * - subject：requesterUserId === retention.subjectUserId；
 * - verified_guardian：requesterUserId === consent.grantorUserId 且
 *   authorizationType=guardian 且 consent 有效且证明通过门禁（生产仅
 *   guardian_verified；guardian_self_attested 仅显式开发策略）；
 * - 其余主体（教师、管理员、Notebook 成员、跨主体、未知用户）一律拒绝。
 */

import {
  AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES,
  audioRetentionAuditReasonCodes,
  type AudioRetentionGuardianProofPolicy,
  type AudioRetentionStatus,
  type AudioRetentionSummary,
} from './audio-retention-types';
import type { audioConsents, audioRetentions } from './schema/audio-consent';

/** 读取审计固定 eventType / resourceType（V14-E）。 */
export const AUDIO_RETENTION_READ_EVENT_TYPE = 'audio_retention.read';
export const AUDIO_RETENTION_RESOURCE_TYPE = 'audio_retention';

export type RetentionRow = typeof audioRetentions.$inferSelect;
export type ConsentRow = typeof audioConsents.$inferSelect;

export interface ReadDecision {
  allowed: boolean;
  reasonCode: string;
  summary: AudioRetentionSummary | null;
  /** 审计 metadata：只允许安全枚举与稳定 ID。 */
  metadata: Record<string, string>;
}

/** 行 → 公共摘要；只投影允许字段，杜绝 storageKey 泄漏。 */
export function toSummary(row: RetentionRow): AudioRetentionSummary {
  return {
    retentionId: row.id,
    consentId: row.consentId,
    subjectUserId: row.subjectUserId,
    assetVersionId: row.assetVersionId,
    status: row.status as AudioRetentionStatus,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * 授权判定：返回是否允许、审计 reasonCode 与 metadata。
 * 原始音频只在 retention 与 consent 都有效时可读；随后再区分本人或满足
 * grantor + guardian 形态与证明门禁的监护人。撤回、到期或已经登记删除
 * 的 retention 对所有主体立即 fail closed。
 */
export function authorizeRead(
  retention: RetentionRow,
  consent: ConsentRow | null,
  requesterUserId: string,
  guardianProofPolicy: AudioRetentionGuardianProofPolicy,
  now: Date,
): ReadDecision {
  if (
    retention.status !== 'active' ||
    !consent ||
    consent.status !== 'active' ||
    consent.expiresAt.getTime() <= now.getTime()
  ) {
    return denied(audioRetentionAuditReasonCodes.consentInactive);
  }
  if (requesterUserId === retention.subjectUserId) {
    return {
      allowed: true,
      reasonCode: audioRetentionAuditReasonCodes.readSucceeded,
      summary: toSummary(retention),
      metadata: { access_role: 'subject' },
    };
  }
  if (
    requesterUserId !== consent.grantorUserId ||
    consent.authorizationType !== 'guardian'
  ) {
    // 教师、管理员、Notebook 成员、跨主体、未知用户统一拒绝。
    return denied(audioRetentionAuditReasonCodes.accessDenied);
  }
  if (consent.proofMethod === 'guardian_verified') {
    return allowed(retention, {
      access_role: 'verified_guardian',
      authorization_type: 'guardian',
      proof_method: 'guardian_verified',
    });
  }
  if (
    consent.proofMethod === 'guardian_self_attested' &&
    guardianProofPolicy ===
      AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES.allowSelfAttested
  ) {
    return allowed(retention, {
      access_role: 'verified_guardian',
      authorization_type: 'guardian',
      proof_method: 'guardian_self_attested',
    });
  }
  return denied(audioRetentionAuditReasonCodes.guardianProofNotVerified);
}

function allowed(
  retention: RetentionRow,
  metadata: Record<string, string>,
): ReadDecision {
  return {
    allowed: true,
    reasonCode: audioRetentionAuditReasonCodes.readSucceeded,
    summary: toSummary(retention),
    metadata,
  };
}

function denied(reasonCode: string): ReadDecision {
  return {
    allowed: false,
    reasonCode,
    summary: null,
    metadata: {},
  };
}
