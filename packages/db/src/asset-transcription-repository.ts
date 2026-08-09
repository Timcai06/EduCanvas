import type { AssetRepresentationKind } from '@educanvas/agent-core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { upsertAssetRepresentation } from './asset-representation-repository';
import { assetProcessingJobs, assets, assetVersions } from './schema';

type Database = ReturnType<typeof getDb>;

export const ASSET_TRANSCRIBE_AUDIO_TASK = 'assets:transcribe_audio' as const;
const TRANSCRIPTION_REPRESENTATION_KIND =
  'transcription' as const satisfies AssetRepresentationKind;

const AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
]);
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export interface AudioTranscriptionAttempt {
  storageKey: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
}

export interface AudioTranscriptionMetadata {
  provider: string;
  resolvedModelId: string;
  latencyMs: number;
  traceId: string;
  language: string | null;
  durationSeconds: number;
}

export type AudioTranscriptionOutcome =
  | {
      status: 'ready';
      /** 转录文本对象（D04 内容权威：由 worker 写入对象存储，指向 representation）。 */
      derivedStorageKey: string;
      /** 转录文本对象 SHA-256（小写 hex）。 */
      checksum: string;
      transcriptionText: string;
      /** 双写镜像（审计元数据无新归宿前的 compatibility，见 docs/04-data/08-D04）。 */
      transcriptionMetadata: AudioTranscriptionMetadata;
    }
  | { status: 'failed'; failureCode: string };

/**
 * 音频转录是初始 ingestion 状态机：它把 processing Asset Version 推进到终态。
 * 它与只处理 ready 当前版本的 preview/thumbnail 派生仓储故意分离。
 */
export class DrizzleAssetTranscriptionRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async beginAttempt(input: {
    jobId: string;
    now?: Date;
  }): Promise<AudioTranscriptionAttempt | null> {
    const jobId = requireUuid(input.jobId);
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const [claimed] = await transaction
        .update(assetProcessingJobs)
        .set({
          status: 'running',
          attempts: sql`${assetProcessingJobs.attempts} + 1`,
          startedAt: sql`coalesce(${assetProcessingJobs.startedAt}, ${now.toISOString()}::timestamptz)`,
        })
        .where(
          and(
            eq(assetProcessingJobs.id, jobId),
            eq(assetProcessingJobs.kind, 'transcribe_audio'),
            inArray(assetProcessingJobs.status, ['queued', 'running']),
          ),
        )
        .returning({
          assetVersionId: assetProcessingJobs.assetVersionId,
          variant: assetProcessingJobs.variant,
          producer: assetProcessingJobs.producer,
          producerVersion: assetProcessingJobs.producerVersion,
        });
      if (!claimed) return null;

      const [version] = await transaction
        .select({
          storageKey: assetVersions.storageKey,
          mimeType: assetVersions.mimeType,
          byteSize: assetVersions.byteSize,
          contentHash: assetVersions.contentHash,
        })
        .from(assetVersions)
        .innerJoin(assets, eq(assets.id, assetVersions.assetId))
        .where(
          and(
            eq(assetVersions.id, claimed.assetVersionId),
            eq(assetVersions.kind, 'audio'),
            eq(assetVersions.status, 'processing'),
            eq(assets.status, 'processing'),
            isNull(assets.currentVersionId),
          ),
        )
        .limit(1);
      if (version) return version;

      await transaction
        .update(assetProcessingJobs)
        .set({ status: 'cancelled', completedAt: now, failureCode: null })
        .where(
          and(
            eq(assetProcessingJobs.id, jobId),
            eq(assetProcessingJobs.kind, 'transcribe_audio'),
            eq(assetProcessingJobs.status, 'running'),
          ),
        );
      return null;
    });
  }

  async settle(input: {
    jobId: string;
    outcome: AudioTranscriptionOutcome;
    now?: Date;
  }): Promise<boolean> {
    const jobId = requireUuid(input.jobId);
    const now = input.now ?? new Date();
    const outcome = validateOutcome(input.outcome);
    return this.database.transaction(async (transaction) => {
      const [claimed] = await transaction
        .update(assetProcessingJobs)
        .set({
          status: outcome.status === 'ready' ? 'succeeded' : 'failed',
          completedAt: now,
          failureCode: outcome.status === 'failed' ? outcome.failureCode : null,
        })
        .where(
          and(
            eq(assetProcessingJobs.id, jobId),
            eq(assetProcessingJobs.kind, 'transcribe_audio'),
            inArray(assetProcessingJobs.status, ['queued', 'running']),
          ),
        )
        .returning({
          assetVersionId: assetProcessingJobs.assetVersionId,
          variant: assetProcessingJobs.variant,
          producer: assetProcessingJobs.producer,
          producerVersion: assetProcessingJobs.producerVersion,
        });
      if (!claimed) return false;

      const ready = outcome.status === 'ready';
      const [version] = await transaction
        .update(assetVersions)
        .set({
          status: ready ? 'ready' : 'failed',
          // D04：内容权威 = transcription representation（对象存储）；
          // transcriptionText/transcriptionMetadata 为同事务 compatibility
          // 镜像（agent context 读取与审计元数据，退出条件见 docs/04-data/08-D04）。
          transcriptionText: ready ? outcome.transcriptionText : null,
          transcriptionMetadata: ready ? outcome.transcriptionMetadata : null,
          failureCode: ready ? null : outcome.failureCode,
        })
        .where(
          and(
            eq(assetVersions.id, claimed.assetVersionId),
            eq(assetVersions.kind, 'audio'),
            eq(assetVersions.status, 'processing'),
          ),
        )
        .returning();
      if (!version)
        throw new Error('asset_transcription_version_not_available');

      /* D04：按完整 identity（默认 identity 显式）幂等 upsert——
         同一 identity 重试更新本行，不同 identity（多 Provider）并存互不覆盖。 */
      await upsertAssetRepresentation(transaction, {
        assetVersionId: version.id,
        kind: TRANSCRIPTION_REPRESENTATION_KIND,
        variant: claimed.variant,
        producer: claimed.producer,
        producerVersion: claimed.producerVersion,
        mimeType: 'text/plain',
        status: outcome.status,
        derivedStorageKey: ready ? outcome.derivedStorageKey : null,
        checksum: ready ? outcome.checksum : null,
        byteSize: ready
          ? Buffer.byteLength(outcome.transcriptionText, 'utf8')
          : null,
        failureCode: ready ? null : outcome.failureCode,
        now,
      });

      const [updatedAsset] = await transaction
        .update(assets)
        .set({
          status: ready ? 'ready' : 'failed',
          currentVersionId: ready ? version.id : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(assets.id, version.assetId),
            eq(assets.status, 'processing'),
            isNull(assets.currentVersionId),
          ),
        )
        .returning({ id: assets.id });
      if (!updatedAsset)
        throw new Error('asset_transcription_asset_not_available');
      return true;
    });
  }
}

function requireUuid(value: string): string {
  if (!isUuid(value)) throw new Error('asset_job_not_available');
  return value;
}

function requireSafeToken(value: string, maxLength: number): string {
  const normalized = value.normalize('NFC').trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    !SAFE_TOKEN.test(normalized)
  ) {
    throw new Error('invalid_audio_transcription_metadata');
  }
  return normalized;
}

function validateOutcome(
  outcome: AudioTranscriptionOutcome,
): AudioTranscriptionOutcome {
  if (outcome.status === 'failed') {
    return {
      status: 'failed',
      failureCode: requireSafeToken(outcome.failureCode, 128),
    };
  }
  const transcriptionText = outcome.transcriptionText.normalize('NFC').trim();
  if (!transcriptionText || [...transcriptionText].length > 500_000) {
    throw new Error('invalid_audio_transcription_text');
  }
  if (
    !outcome.derivedStorageKey ||
    !/^[a-z0-9][a-z0-9._/-]{0,1023}$/i.test(outcome.derivedStorageKey) ||
    outcome.derivedStorageKey.length > 1024
  ) {
    throw new Error('invalid_audio_transcription_storage_key');
  }
  if (!/^[a-f0-9]{64}$/.test(outcome.checksum)) {
    throw new Error('invalid_audio_transcription_checksum');
  }
  const metadata = outcome.transcriptionMetadata;
  if (
    !Number.isSafeInteger(metadata.latencyMs) ||
    metadata.latencyMs < 0 ||
    metadata.latencyMs > 300_000 ||
    !Number.isFinite(metadata.durationSeconds) ||
    metadata.durationSeconds <= 0 ||
    metadata.durationSeconds > 3_600 ||
    (metadata.language !== null &&
      (!metadata.language.trim() || metadata.language.length > 64))
  ) {
    throw new Error('invalid_audio_transcription_metadata');
  }
  return {
    status: 'ready',
    derivedStorageKey: outcome.derivedStorageKey,
    checksum: outcome.checksum,
    transcriptionText,
    transcriptionMetadata: {
      provider: requireSafeToken(metadata.provider, 64),
      resolvedModelId: requireSafeToken(metadata.resolvedModelId, 256),
      latencyMs: metadata.latencyMs,
      traceId: requireSafeToken(metadata.traceId, 160),
      language: metadata.language?.normalize('NFC').trim() ?? null,
      durationSeconds: metadata.durationSeconds,
    },
  };
}
