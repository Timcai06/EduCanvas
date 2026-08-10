/** V17 语音能力闸门的只读同意/Repository 健康查询。 */
import { and, eq, gt, sql } from 'drizzle-orm';
import { getDb } from './client';
import { audioConsents } from './schema/audio-consent';
import {
  AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES,
  AudioRetentionPersistenceError,
  type AudioRetentionGuardianProofPolicy,
} from './audio-retention-types';

type Database = ReturnType<typeof getDb>;
type DatabaseClockRow = Record<string, unknown> & { now: Date | string };

interface AudioVoiceCapabilityRepositoryOptions {
  readonly database?: Database;
  readonly guardianProofPolicy?: AudioRetentionGuardianProofPolicy;
}

function parseDatabaseClock(row: DatabaseClockRow | undefined): Date {
  const now = row?.now instanceof Date ? row.now : new Date(String(row?.now));
  if (!Number.isFinite(now.getTime())) {
    throw new AudioRetentionPersistenceError();
  }
  return now;
}

function proofIsAccepted(
  authorizationType: string,
  proofMethod: string,
  policy: AudioRetentionGuardianProofPolicy,
): boolean {
  if (authorizationType === 'self') {
    return (
      proofMethod === 'adult_verified' ||
      (policy === AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES.allowSelfAttested &&
        proofMethod === 'adult_self_attested')
    );
  }
  if (authorizationType === 'guardian') {
    return (
      proofMethod === 'guardian_verified' ||
      (policy === AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES.allowSelfAttested &&
        proofMethod === 'guardian_self_attested')
    );
  }
  return false;
}

/**
 * 只返回是否可用，不返回 consent ID、授权人或证明引用；错误统一 fail
 * closed。生产默认只接受 verified，显式开发策略才接受 self_attested。
 */
export class AudioVoiceCapabilityRepository {
  private readonly database: Database;
  private readonly proofPolicy: AudioRetentionGuardianProofPolicy;

  constructor(options: AudioVoiceCapabilityRepositoryOptions = {}) {
    this.database = options.database ?? getDb();
    this.proofPolicy =
      options.guardianProofPolicy ??
      AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES.verifiedOnly;
  }

  async checkVoiceProcessingReadiness(input: {
    subjectUserId: string;
  }): Promise<{ consentActive: boolean; repositoryHealthy: true }> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [clock] = await transaction.execute<DatabaseClockRow>(
          sql`select now() as "now"`,
        );
        const now = parseDatabaseClock(clock);
        const [consent] = await transaction
          .select({
            authorizationType: audioConsents.authorizationType,
            proofMethod: audioConsents.proofMethod,
          })
          .from(audioConsents)
          .where(
            and(
              eq(audioConsents.subjectUserId, input.subjectUserId),
              eq(audioConsents.purpose, 'voice_processing'),
              eq(audioConsents.status, 'active'),
              gt(audioConsents.expiresAt, now),
            ),
          )
          .limit(1);
        return {
          consentActive:
            consent !== undefined &&
            proofIsAccepted(
              consent.authorizationType,
              consent.proofMethod,
              this.proofPolicy,
            ),
          repositoryHealthy: true as const,
        };
      });
    } catch {
      throw new AudioRetentionPersistenceError();
    }
  }
}
