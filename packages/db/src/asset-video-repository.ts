import type {
  AssetRepresentationKind,
  RepresentationIdentity,
} from '@educanvas/agent-core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { upsertAssetRepresentation } from './asset-representation-repository';
import {
  assetProcessingJobs,
  assetVersions,
  assetVideoKeyframes,
  assets,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export const ASSET_PROCESS_VIDEO_TASK = 'assets:process_video' as const;

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_KEYFRAMES = 16;

export interface VideoProcessingAttempt {
  assetVersionId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
}

export interface VideoTranscriptionMetadata {
  provider: string;
  resolvedModelId: string;
  latencyMs: number;
  traceId: string;
  language: string | null;
  durationSeconds: number;
}

export interface VideoKeyframeRecord {
  ordinal: number;
  timestampSeconds: number;
  storageKey: string;
  checksum: string;
  byteSize: number;
}

/**
 * 视频派生的两路结果。
 *
 * 音轨与关键帧是两条独立派生：一条失败不应该抹掉另一条已经成功的结果。因此
 * 结算入参把两者分开表达，而不是共用一个 status。
 */
export interface VideoProcessingOutcome {
  /** 无论两路结果如何，元数据探测成功是版本能进入 ready 的前提。 */
  durationSeconds: number;
  width: number;
  height: number;
  transcription:
    | {
        status: 'ready';
        text: string;
        metadata: VideoTranscriptionMetadata;
        derivedStorageKey: string;
        checksum: string;
      }
    | { status: 'failed'; failureCode: string }
    | { status: 'unavailable' };
  keyframes:
    | {
        status: 'ready';
        algorithmVersion: string;
        frames: readonly VideoKeyframeRecord[];
      }
    | { status: 'failed'; failureCode: string };
}

/**
 * 视频来源处理的唯一数据库边界（ADR-0016）。
 *
 * 与音频转录仓储并列而不是合并：视频派生天然是「多路、可部分成功」的，而音频
 * 转录是单一结果的状态机。把部分成功语义塞进后者会让两条路径都变得难以推理。
 *
 * 纪律：
 * - 原始 Asset Version 是唯一内容事实，本仓储只写派生行与状态；
 * - 部分成功是一等状态：只要元数据探测成功，版本就进入 ready，两路派生各自在
 *   `asset_representations` 上留下自己的 ready/failed；
 * - 关键帧按 `(版本, 算法版本, 序号)` 幂等写入，重投不产生重复帧。
 */
export class DrizzleAssetVideoRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  /** 领取一次执行；只有 queued/running 的 process_video 任务可被领取。 */
  async beginAttempt(input: {
    jobId: string;
    now?: Date;
  }): Promise<VideoProcessingAttempt | null> {
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
            eq(assetProcessingJobs.kind, 'process_video'),
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
          assetVersionId: assetVersions.id,
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
            eq(assetVersions.kind, 'video'),
            eq(assetVersions.status, 'processing'),
            eq(assets.status, 'processing'),
            isNull(assets.currentVersionId),
          ),
        )
        .limit(1);
      if (version) return version;

      /* 版本已经不在 processing：任务与事实不一致，取消而不是失败——它不是
         处理错误，而是这次投递已经没有可处理的对象。 */
      await transaction
        .update(assetProcessingJobs)
        .set({ status: 'cancelled', completedAt: now, failureCode: null })
        .where(
          and(
            eq(assetProcessingJobs.id, jobId),
            eq(assetProcessingJobs.kind, 'process_video'),
            eq(assetProcessingJobs.status, 'running'),
          ),
        );
      return null;
    });
  }

  /**
   * 结算一次成功的处理（可能部分成功）。
   *
   * 任务本身记为 succeeded：元数据已经拿到、版本可用。两路派生各自的 ready/failed
   * 保存在 representation 上，UI 因此能诚实区分「还没做」「做失败了」和「没有音轨」。
   */
  async settleProcessed(input: {
    jobId: string;
    outcome: VideoProcessingOutcome;
    now?: Date;
  }): Promise<boolean> {
    const jobId = requireUuid(input.jobId);
    const now = input.now ?? new Date();
    const outcome = validateOutcome(input.outcome);
    return this.database.transaction(async (transaction) => {
      const [claimed] = await transaction
        .update(assetProcessingJobs)
        .set({ status: 'succeeded', completedAt: now, failureCode: null })
        .where(
          and(
            eq(assetProcessingJobs.id, jobId),
            eq(assetProcessingJobs.kind, 'process_video'),
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

      /* 先把联合窄化到局部常量：直接在对象字面量里用三元判断会丢失窄化，
         TypeScript 无法证明两次访问命中同一分支。 */
      const transcription = outcome.transcription;
      const [version] = await transaction
        .update(assetVersions)
        .set({
          status: 'ready',
          transcriptionText:
            transcription.status === 'ready' ? transcription.text : null,
          transcriptionMetadata:
            transcription.status === 'ready' ? transcription.metadata : null,
          failureCode: null,
        })
        .where(
          and(
            eq(assetVersions.id, claimed.assetVersionId),
            eq(assetVersions.kind, 'video'),
            eq(assetVersions.status, 'processing'),
          ),
        )
        .returning();
      if (!version) throw new Error('asset_video_version_not_available');

      await upsertRepresentation(transaction, {
        assetVersionId: version.id,
        identity: claimed,
        kind: 'transcription',
        mimeType: 'text/plain',
        now,
        values:
          transcription.status === 'ready'
            ? {
                status: 'ready',
                byteSize: Buffer.byteLength(transcription.text, 'utf8'),
                derivedStorageKey: transcription.derivedStorageKey,
                checksum: transcription.checksum,
                failureCode: null,
              }
            : transcription.status === 'failed'
              ? {
                  status: 'failed',
                  byteSize: null,
                  derivedStorageKey: null,
                  checksum: null,
                  failureCode: transcription.failureCode,
                }
              : /* 没有音轨不是失败：它是这段视频的事实。 */
                {
                  status: 'unavailable',
                  byteSize: null,
                  derivedStorageKey: null,
                  checksum: null,
                  failureCode: null,
                },
      });

      const keyframes = outcome.keyframes;
      if (keyframes.status === 'ready') {
        await transaction
          .insert(assetVideoKeyframes)
          .values(
            keyframes.frames.map((frame) => ({
              assetVersionId: version.id,
              algorithmVersion: keyframes.algorithmVersion,
              ordinal: frame.ordinal,
              timestampSeconds: frame.timestampSeconds,
              storageKey: frame.storageKey,
              checksum: frame.checksum,
              byteSize: frame.byteSize,
              mimeType: 'image/jpeg',
              createdAt: now,
            })),
          )
          /* 重投同一批帧收敛为同一行；对象键由内容哈希派生，不会互相覆盖。 */
          .onConflictDoNothing();
      }
      await upsertRepresentation(transaction, {
        assetVersionId: version.id,
        identity: claimed,
        kind: 'keyframes',
        mimeType: 'image/jpeg',
        now,
        values:
          keyframes.status === 'ready'
            ? {
                status: 'ready',
                byteSize: keyframes.frames.reduce(
                  (total, frame) => total + frame.byteSize,
                  0,
                ),
                derivedStorageKey: null,
                checksum: null,
                failureCode: null,
              }
            : {
                status: 'failed',
                byteSize: null,
                derivedStorageKey: null,
                checksum: null,
                failureCode: keyframes.failureCode,
              },
      });

      const [updatedAsset] = await transaction
        .update(assets)
        .set({ status: 'ready', currentVersionId: version.id, updatedAt: now })
        .where(
          and(
            eq(assets.id, version.assetId),
            eq(assets.status, 'processing'),
            isNull(assets.currentVersionId),
          ),
        )
        .returning({ id: assets.id });
      if (!updatedAsset) throw new Error('asset_video_asset_not_available');
      return true;
    });
  }

  /** 结算一次整体失败；元数据都没拿到时版本无法进入 ready。 */
  async settleFailed(input: {
    jobId: string;
    failureCode: string;
    now?: Date;
  }): Promise<boolean> {
    const jobId = requireUuid(input.jobId);
    const failureCode = requireSafeToken(input.failureCode, 128);
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const [claimed] = await transaction
        .update(assetProcessingJobs)
        .set({ status: 'failed', completedAt: now, failureCode })
        .where(
          and(
            eq(assetProcessingJobs.id, jobId),
            eq(assetProcessingJobs.kind, 'process_video'),
            inArray(assetProcessingJobs.status, ['queued', 'running']),
          ),
        )
        .returning({ assetVersionId: assetProcessingJobs.assetVersionId });
      if (!claimed) return false;

      const [version] = await transaction
        .update(assetVersions)
        .set({ status: 'failed', failureCode })
        .where(
          and(
            eq(assetVersions.id, claimed.assetVersionId),
            eq(assetVersions.kind, 'video'),
            eq(assetVersions.status, 'processing'),
          ),
        )
        .returning();
      if (!version) throw new Error('asset_video_version_not_available');

      const [updatedAsset] = await transaction
        .update(assets)
        .set({ status: 'failed', currentVersionId: null, updatedAt: now })
        .where(
          and(
            eq(assets.id, version.assetId),
            eq(assets.status, 'processing'),
            isNull(assets.currentVersionId),
          ),
        )
        .returning({ id: assets.id });
      if (!updatedAsset) throw new Error('asset_video_asset_not_available');
      return true;
    });
  }
}

async function upsertRepresentation(
  transaction: DatabaseTransaction,
  input: {
    assetVersionId: string;
    identity: RepresentationIdentity;
    kind: Extract<AssetRepresentationKind, 'transcription' | 'keyframes'>;
    mimeType: string;
    now: Date;
    values: {
      status: 'ready' | 'failed' | 'unavailable';
      byteSize: number | null;
      derivedStorageKey: string | null;
      checksum: string | null;
      failureCode: string | null;
    };
  },
): Promise<void> {
  /* D04：按完整 identity（默认 identity 显式）幂等 upsert——
     同一 identity 重试更新本行，不同 identity 并存互不覆盖。 */
  await upsertAssetRepresentation(transaction, {
    assetVersionId: input.assetVersionId,
    kind: input.kind,
    ...input.identity,
    mimeType: input.mimeType,
    ...input.values,
    now: input.now,
  });
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
    throw new Error('invalid_video_processing_metadata');
  }
  return normalized;
}

function validateOutcome(
  outcome: VideoProcessingOutcome,
): VideoProcessingOutcome {
  if (
    !Number.isFinite(outcome.durationSeconds) ||
    outcome.durationSeconds <= 0 ||
    !Number.isInteger(outcome.width) ||
    !Number.isInteger(outcome.height) ||
    outcome.width <= 0 ||
    outcome.height <= 0
  ) {
    throw new Error('invalid_video_processing_metadata');
  }

  const transcription = ((): VideoProcessingOutcome['transcription'] => {
    if (outcome.transcription.status === 'unavailable') {
      return { status: 'unavailable' };
    }
    if (outcome.transcription.status === 'failed') {
      return {
        status: 'failed',
        failureCode: requireSafeToken(outcome.transcription.failureCode, 128),
      };
    }
    const text = outcome.transcription.text.normalize('NFC').trim();
    if (
      !text ||
      [...text].length > 500_000 ||
      !outcome.transcription.derivedStorageKey ||
      outcome.transcription.derivedStorageKey.length > 1_024 ||
      /^https?:\/\//i.test(outcome.transcription.derivedStorageKey) ||
      !SHA256.test(outcome.transcription.checksum)
    ) {
      throw new Error('invalid_video_transcription_text');
    }
    const metadata = outcome.transcription.metadata;
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
      throw new Error('invalid_video_processing_metadata');
    }
    return {
      status: 'ready',
      text,
      derivedStorageKey: outcome.transcription.derivedStorageKey,
      checksum: outcome.transcription.checksum,
      metadata: {
        provider: requireSafeToken(metadata.provider, 64),
        resolvedModelId: requireSafeToken(metadata.resolvedModelId, 256),
        latencyMs: metadata.latencyMs,
        traceId: requireSafeToken(metadata.traceId, 160),
        language: metadata.language?.normalize('NFC').trim() ?? null,
        durationSeconds: metadata.durationSeconds,
      },
    };
  })();

  const keyframes = ((): VideoProcessingOutcome['keyframes'] => {
    if (outcome.keyframes.status === 'failed') {
      return {
        status: 'failed',
        failureCode: requireSafeToken(outcome.keyframes.failureCode, 128),
      };
    }
    const frames = outcome.keyframes.frames;
    if (frames.length === 0 || frames.length > MAX_KEYFRAMES) {
      throw new Error('invalid_video_keyframes');
    }
    const ordinals = new Set(frames.map((frame) => frame.ordinal));
    if (ordinals.size !== frames.length) {
      throw new Error('invalid_video_keyframes');
    }
    for (const frame of frames) {
      if (
        !Number.isInteger(frame.ordinal) ||
        frame.ordinal < 1 ||
        !Number.isFinite(frame.timestampSeconds) ||
        frame.timestampSeconds < 0 ||
        !Number.isSafeInteger(frame.byteSize) ||
        frame.byteSize <= 0 ||
        frame.byteSize > 2 * 1024 * 1024 ||
        !SHA256.test(frame.checksum) ||
        !frame.storageKey ||
        frame.storageKey.length > 1_024 ||
        /^https?:\/\//i.test(frame.storageKey)
      ) {
        throw new Error('invalid_video_keyframes');
      }
    }
    return {
      status: 'ready',
      algorithmVersion: requireSafeToken(
        outcome.keyframes.algorithmVersion,
        128,
      ),
      frames,
    };
  })();

  return {
    durationSeconds: outcome.durationSeconds,
    width: outcome.width,
    height: outcome.height,
    transcription,
    keyframes,
  };
}
