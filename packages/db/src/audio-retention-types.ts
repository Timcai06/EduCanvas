/**
 * 音频留存 Repository 的公共类型面（ADR-0022 §4、V14）。
 *
 * 本文件只承载类型、常量与稳定错误类，不包含任何数据库访问逻辑；实现见
 * `audio-retention-repository.ts`。公共 DTO 是浏览器与服务端之间的安全边界：
 * 只允许稳定 ID 与生命周期字段，storageKey、proofReference、原始音频、
 * 转录文本、Prompt、Provider 信息与堆栈一律不得进入。
 */

/**
 * 音频留存访问角色（ADR-0022 §4）。
 * - `subject`：数据主体本人；
 * - `verified_guardian`：通过监护关系证明门禁的监护人（生产环境仅接受
 *   `guardian_verified`；`guardian_self_attested` 只能在显式开发策略下启用）。
 */
export type AudioRetentionAccessRole = 'subject' | 'verified_guardian';

/** 留存生命周期：创建后 active，撤回或到期扫描后终态 deletion_requested。 */
export type AudioRetentionStatus = 'active' | 'deletion_requested';

/**
 * 监护人证明策略，构造 Repository 时注入。
 * - `verified_only`（生产默认）：只接受 `guardian_verified` 证明；
 * - `allow_self_attested`：显式开发/演示策略，允许 `guardian_self_attested`
 *   读取。浏览器请求参数永远不能影响该策略（fail closed）。
 */
export const AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES = {
  verifiedOnly: 'verified_only',
  allowSelfAttested: 'allow_self_attested',
} as const;

export type AudioRetentionGuardianProofPolicy =
  (typeof AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES)[keyof typeof AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES];

/** 创建留存输入：绑定一条有效 audio_retention 同意与一个 assetVersion。 */
export interface CreateAudioRetentionInput {
  /** 必须存在、purpose=audio_retention、active、未过期。 */
  consentId: string;
  /** 必须与 consent 的 subjectUserId 一致。 */
  subjectUserId: string;
  assetVersionId: string;
  /**
   * 可选期限；默认创建时刻 + 7 天，允许调用方缩短，禁止超过创建时刻 + 7 天
   * （ADR-0022 §2 留存期限上界只能缩短）。
   */
  expiresAt?: Date;
}

/** 读取留存输入：以请求主体身份读取一条留存的公共摘要。 */
export interface ReadAudioRetentionInput {
  retentionId: string;
  /** 服务端可信主体；无 session 侧声明参与授权。 */
  requesterUserId: string;
}

/**
 * 安全留存摘要（公共 DTO）。只含稳定 ID 与生命周期，storageKey / proof /
 * 音频 / 转录文本永不进入；这也是浏览器能拿到的最大信息面。
 */
export interface AudioRetentionSummary {
  retentionId: string;
  consentId: string;
  subjectUserId: string;
  assetVersionId: string;
  status: AudioRetentionStatus;
  createdAt: string;
  expiresAt: string;
}

/** 撤回结果：consent 终态 revoked，同事务已登记全部删除意图。 */
export interface AudioRetentionRevokeResult {
  consentId: string;
  status: 'revoked';
  revokedAt: string;
  /** 本次新写入 objectDeletionOutbox 的删除意图数；幂等重复撤回为 0。 */
  deletionIntents: number;
  /** 幂等标记：本次调用前 consent 已是 revoked（未重复写 Outbox）。 */
  alreadyRevoked: boolean;
}

/** 到期扫描结果：本次领取并处理的行数（单事务写 Outbox + 转 deletion_requested）。 */
export interface AudioRetentionScanResult {
  /** 本次领取的 active 到期留存数；并发扫描器不会重复领取同一行。 */
  scanned: number;
  /** 本次实际写入 objectDeletionOutbox 的删除意图数。 */
  deletionIntents: number;
}

/**
 * 读取失败对外统一错误：不存在与无权访问不可区分，避免资源探测
 * （ADR-0022 §4）。具体拒绝原因只进入服务端审计（reasonCode），不返回。
 */
export class AudioRetentionAccessError extends Error {
  readonly code = 'audio_retention_access_denied';

  constructor() {
    super('音频留存不存在或无权访问');
    this.name = 'AudioRetentionAccessError';
  }
}

/** 创建/撤回时 consent 缺失或未满足校验（目的、状态、有效期、subject、授权形态）。 */
export class AudioRetentionConsentError extends Error {
  readonly code = 'audio_retention_consent_invalid';

  constructor() {
    super('音频留存同意缺失或已失效');
    this.name = 'AudioRetentionConsentError';
  }
}

/** 留存期限超过 7 天上界（仅允许缩短）。 */
export class AudioRetentionPeriodError extends Error {
  readonly code = 'audio_retention_period_invalid';

  constructor() {
    super('留存期限不能超过七天');
    this.name = 'AudioRetentionPeriodError';
  }
}

/**
 * 数据库/审计写入失败的统一稳定错误。不携带 SQL 文本、约束名、堆栈或
 * Provider 信息；调用方只能据此判定"操作失败"，不得从中恢复内部细节。
 */
export class AudioRetentionPersistenceError extends Error {
  readonly code = 'audio_retention_persistence_failed';

  constructor() {
    super('音频留存操作失败');
    this.name = 'AudioRetentionPersistenceError';
  }
}

/**
 * 读取审计的有界 reasonCode 集合（V14-E）。对外错误统一为
 * `audio_retention_access_denied`，但审计是服务端内部事实，允许用更细的
 * 稳定码区分拒绝原因，便于安全分析与追溯，且不向请求方泄露。
 */
export const audioRetentionAuditReasonCodes = {
  readSucceeded: 'audio_retention_read_succeeded',
  notFound: 'audio_retention_not_found',
  accessDenied: 'audio_retention_access_denied',
  consentInactive: 'audio_retention_consent_inactive',
  guardianProofNotVerified: 'audio_retention_guardian_proof_not_verified',
} as const;
