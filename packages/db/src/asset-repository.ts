import { randomUUID } from 'node:crypto';
import {
  assetDescriptorSchema,
  assetKindSchema,
  assetOriginSchema,
  assetVersionDescriptorSchema,
  assetVersionReferenceSchema,
  canTransitionAssetStatus,
  type AssetDescriptor,
  type AssetKind,
  type AssetOrigin,
  type AssetProcessorKind,
  type AssetRepresentationKind,
  type RepresentationQuality,
  type AssetScope,
  type AssetVersionDescriptor,
  type AssetVersionReference,
} from '@educanvas/agent-core';
import type { NotebookMembershipRole } from '@educanvas/gateway-core';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import {
  loadOwnedReadyAssetVersions,
  OwnedAssetVersionError,
} from './internal/owned-asset-versions';
import { requireNotebookAccess } from './notebook-access';
import {
  boundedPageLimit,
  type CursorPage,
  type TemporalIdCursor,
} from './pagination';
import {
  assetProcessingJobs,
  assetRepresentations,
  assets,
  assetVersions,
  assetVideoKeyframes,
  notebookAssetBindings,
  objectDeletionOutbox,
} from './schema';
import {
  DrizzleAssetDerivedProcessingRepository,
  enqueueDerivedAssetJob,
  getDerivedAssetJobKind,
} from './asset-derived-processing-repository';
import {
  ASSET_TRANSCRIBE_AUDIO_TASK,
  DrizzleAssetTranscriptionRepository,
  type AudioTranscriptionOutcome,
} from './asset-transcription-repository';
import { ASSET_PROCESS_VIDEO_TASK } from './asset-video-repository';
import {
  defaultRepresentationOrderBy,
  upsertAssetRepresentation,
} from './asset-representation-repository';

type Database = ReturnType<typeof getDb>;

/** worker 任务注册表里的稳定标识；`域:动作` 命名与其他周期/业务任务一致。 */
export const ASSET_EXTRACT_TEXT_TASK = 'assets:extract_text' as const;

const OWNER_ID = /^.{1,160}$/u;
const SHA256 = /^[a-f0-9]{64}$/;

export interface AssetSnapshot {
  descriptor: AssetDescriptor;
  version: AssetVersionDescriptor | null;
  /** 浏览器安全的处理账本投影；不包含队列错误原文、堆栈或对象存储地址。 */
  processing: AssetProcessingSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetProcessingSnapshot {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempts: number;
  failureCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MaterializedAssetVersion {
  reference: AssetVersionReference;
  displayName: string;
  mimeType: string;
  byteSize: number;
  extractedText: string | null;
  /** 音频转录派生文本；与 extractedText 来源不同（文本抽取 vs. Provider 转录）。 */
  transcriptionText: string | null;
}

export interface AssetAccessPolicy {
  role: NotebookMembershipRole;
}

/**
 * 仅供服务端对象存储 Adapter 使用的当前版本。
 * storageKey 绝不能进入 AssetSnapshot、公共 API、模型 Context 或客户端状态。
 */
export interface OwnedStoredAssetVersion {
  assetId: string;
  versionId: string;
  displayName: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  origin: AssetOrigin;
  createdAt: string;
  storageKey: string;
  extractedText: string | null;
  /** 音频转录派生文本。 */
  transcriptionText: string | null;
  /** 音频转录 Provider 审计元数据。 */
  transcriptionMetadata: unknown;
  /** 浏览器预览组合层可用的安全派生状态；不含对象键、校验和或 Provider 数据。 */
  derivedStatuses: readonly {
    kind: Extract<AssetRepresentationKind, 'transcription' | 'keyframes'>;
    status: 'processing' | 'ready' | 'failed' | 'unavailable';
  }[];
  /**
   * D04：默认 identity 的转录表示（对象内容身份，仅供服务端 Adapter
   * 读取转录文本——对象键绝不进入客户端状态；无表示时为 null）。
   */
  transcriptionRepresentation: {
    derivedStorageKey: string;
    checksum: string;
    status: 'ready' | 'failed' | 'processing' | 'unavailable';
  } | null;
  /**
   * ADR-0026 决定 6：默认 identity 的文本派生表示。quality 四态向用户
   * 可见（structured / degraded_plain_text / processing / failed），
   * 阅读视图与 preview 组合层据此显示实际状态；对象键绝不进入客户端状态。
   */
  textRepresentation: {
    derivedStorageKey: string;
    checksum: string;
    status: 'ready' | 'failed' | 'processing' | 'unavailable';
    quality: RepresentationQuality;
    mimeType: string | null;
  } | null;
}

export interface CreateUploadedAssetInput {
  ownerSubjectId: string;
  spaceId: string;
  scope: AssetScope;
  kind: Extract<AssetKind, 'image' | 'document' | 'link' | 'audio' | 'video'>;
  /** 缺省 upload;链接导入传 url_import,溯源与上传物理区分。 */
  origin?: Extract<AssetOrigin, 'upload' | 'url_import'>;
  displayName: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  storageKey: string;
  extractedText?: string | null;
  outcome: { status: 'ready' } | { status: 'failed'; failureCode: string };
  now?: Date;
}

const ORIGINAL_REPRESENTATION_KIND =
  'original' as const satisfies AssetRepresentationKind;
const TEXT_REPRESENTATION_KIND =
  'text' as const satisfies AssetRepresentationKind;
const EXTRACT_TEXT_PROCESSOR_KIND =
  'extract_text' as const satisfies AssetProcessorKind;

export class AssetAccessError extends Error {
  readonly code = 'asset_not_available';

  constructor() {
    super('Asset不存在、不可用或不属于当前空间');
    this.name = 'AssetAccessError';
  }
}

export class AssetPersistenceError extends Error {
  readonly code = 'asset_persistence_failed';

  constructor(message: string) {
    super(message);
    this.name = 'AssetPersistenceError';
  }
}

function requireOwner(value: string): string {
  if (!OWNER_ID.test(value)) throw new AssetAccessError();
  return value;
}

function requireUuid(value: string): string {
  if (!isUuid(value)) throw new AssetAccessError();
  return value;
}

function requireText(value: string, label: string, max: number): string {
  const normalized = value.normalize('NFC').trim();
  if (!normalized || normalized.length > max) {
    throw new AssetPersistenceError(`${label}格式或长度无效`);
  }
  return normalized;
}

function toSnapshot(
  asset: typeof assets.$inferSelect,
  version: typeof assetVersions.$inferSelect | null,
  processingJob: typeof assetProcessingJobs.$inferSelect | null = null,
): AssetSnapshot {
  return {
    descriptor: assetDescriptorSchema.parse({
      assetId: asset.id,
      scope: asset.scope,
      kind: asset.kind,
      origin: asset.origin,
      displayName: asset.displayName,
      mimeType: asset.mimeType,
      status: asset.status,
      currentVersionId: asset.currentVersionId,
    }),
    version: version
      ? assetVersionDescriptorSchema.parse({
          assetId: version.assetId,
          versionId: version.id,
          kind: version.kind,
          mimeType: version.mimeType,
          byteSize: version.byteSize,
          contentHash: version.contentHash,
          status: version.status,
        })
      : null,
    processing: processingJob
      ? {
          status: processingJob.status as AssetProcessingSnapshot['status'],
          attempts: processingJob.attempts,
          failureCode: processingJob.failureCode,
          createdAt: processingJob.createdAt.toISOString(),
          startedAt: processingJob.startedAt?.toISOString() ?? null,
          completedAt: processingJob.completedAt?.toISOString() ?? null,
        }
      : null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

/** 通用 Asset 仓储；K12 只负责把可信学生与当前 lesson session 映射成 owner/space。 */
export class DrizzleAssetRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  private async loadLatestProcessingJobsByAssetIds(
    assetIds: readonly string[],
  ): Promise<ReadonlyMap<string, typeof assetProcessingJobs.$inferSelect>> {
    if (assetIds.length === 0) return new Map();
    const rows = await this.database
      .select({
        assetId: assetVersions.assetId,
        job: assetProcessingJobs,
      })
      .from(assetProcessingJobs)
      .innerJoin(
        assetVersions,
        eq(assetVersions.id, assetProcessingJobs.assetVersionId),
      )
      .where(
        and(
          inArray(assetVersions.assetId, [...assetIds]),
          inArray(assetProcessingJobs.kind, [
            'extract_text',
            'transcribe_audio',
            'process_video',
          ]),
        ),
      )
      .orderBy(
        desc(assetProcessingJobs.createdAt),
        desc(assetProcessingJobs.id),
      );
    const latest = new Map<string, typeof assetProcessingJobs.$inferSelect>();
    for (const row of rows) {
      if (!latest.has(row.assetId)) latest.set(row.assetId, row.job);
    }
    return latest;
  }

  /**
   * 落库一个等待异步解析的上传（ADR-0010）。
   *
   * 与 `createUploaded` 的关键差异：asset 与 version 都停在 `processing`，
   * `currentVersionId` 保持为空（`assets_status_shape_check` 要求非 ready 状态
   * 不得引用当前版本），同时写一条 `queued` 的解析任务。只有 worker 调用
   * `settleTextExtraction` 之后，资产才会推进到 ready 或 failed。
   *
   * 入队在同一事务内完成：graphile-worker 的队列与业务表同库，
   * `graphile_worker.add_job` 因此和业务写入是一个原子单元，不存在
   * 「任务已入队但资产不存在」或「资产已建但任务丢了」的中间态。
   * 这与 `platform-artifact-repository` 创建生成任务的做法一致。
   */
  async createUploadedPending(
    input: Omit<CreateUploadedAssetInput, 'extractedText' | 'outcome'>,
  ): Promise<{ snapshot: AssetSnapshot; versionId: string; jobId: string }> {
    const validated = this.validateUploadInput(input);
    const now = input.now ?? new Date();
    const assetId = randomUUID();
    const versionId = randomUUID();
    const jobId = randomUUID();

    return this.database.transaction(async (transaction) => {
      await requireNotebookAccess(transaction, {
        notebookId: validated.spaceId,
        trustedSubjectId: validated.ownerSubjectId,
        requiredPermission: 'source.write',
        now,
      }).catch(() => {
        throw new AssetAccessError();
      });
      const [createdAsset] = await transaction
        .insert(assets)
        .values({
          id: assetId,
          ownerSubjectId: validated.ownerSubjectId,
          spaceId: validated.spaceId,
          scope: input.scope,
          kind: validated.kind,
          origin: validated.origin,
          displayName: validated.displayName,
          mimeType: validated.mimeType,
          status: 'processing',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const [createdVersion] = await transaction
        .insert(assetVersions)
        .values({
          id: versionId,
          assetId,
          kind: validated.kind,
          mimeType: validated.mimeType,
          byteSize: input.byteSize,
          contentHash: input.contentHash,
          status: 'processing',
          storageKey: validated.storageKey,
          extractedText: null,
          failureCode: null,
          createdAt: now,
        })
        .returning();
      /**
       * 音频走转录队列，视频走派生处理队列（探测→音轨转录→抽帧），
       * 其他可抽取文本类型走文本抽取队列。三种 job 共用
       * asset_processing_jobs 表，kind 字段区分。
       */
      const processingKind =
        input.kind === 'audio'
          ? 'transcribe_audio'
          : input.kind === 'video'
            ? 'process_video'
            : 'extract_text';
      const taskName =
        processingKind === 'transcribe_audio'
          ? ASSET_TRANSCRIBE_AUDIO_TASK
          : processingKind === 'process_video'
            ? ASSET_PROCESS_VIDEO_TASK
            : ASSET_EXTRACT_TEXT_TASK;
      const queueJobKey = `asset-${processingKind}:${jobId}`;
      /* D04：job 与 representation 共享 identity（默认 identity 显式），
         唯一约束防止同一 identity 重复入队。 */
      const [createdJob] = await transaction
        .insert(assetProcessingJobs)
        .values({
          id: jobId,
          assetVersionId: versionId,
          kind: processingKind,
          variant: 'default',
          producer: 'default',
          producerVersion: 'v1',
          status: 'queued',
          attempts: 0,
          queueJobKey,
          createdAt: now,
        })
        .returning();
      await transaction.execute(sql`
        select graphile_worker.add_job(
          ${taskName},
          payload := ${JSON.stringify({ jobId })}::json,
          job_key := ${queueJobKey},
          max_attempts := 3
        )
      `);
      if (!createdAsset || !createdVersion || !createdJob) {
        throw new AssetPersistenceError('Asset创建失败');
      }
      return {
        snapshot: toSnapshot(createdAsset, createdVersion, createdJob),
        versionId,
        jobId,
      };
    });
  }

  /**
   * 供 worker 读取一个待解析任务的输入。
   *
   * 只返回解析所需的最小事实：storageKey 与 MIME。它不经过公共 API，
   * 也不进入任何面向客户端的投影（storageKey 是私有对象地址）。
   * assetVersionId/producer 仅供 worker 日志链路使用（ADR-0026 决定 6
   * 要求日志记录 producer）。
   * 任务已终结时返回 null，让重复投递直接退出而不是重跑一遍解析。
   */
  async beginTextExtractionAttempt(input: {
    jobId: string;
    now?: Date;
  }): Promise<{
    storageKey: string;
    mimeType: string;
    assetVersionId: string;
    producer: string;
  } | null> {
    const jobId = requireUuid(input.jobId);
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const [claimed] = await transaction
        .update(assetProcessingJobs)
        .set({
          status: 'running',
          attempts: sql`${assetProcessingJobs.attempts} + 1`,
          /*
           * 裸 Date 放进 sql`` 会退化成平台本地字符串（如 GMT+0800），
           * PostgreSQL 不保证能解析。ISO 字符串显式转 timestamptz，同时保留
           * 第一次开始时间，确保跨时区和重试都稳定。
           */
          startedAt: sql`coalesce(${assetProcessingJobs.startedAt}, ${now.toISOString()}::timestamptz)`,
        })
        .where(
          and(
            eq(assetProcessingJobs.id, jobId),
            eq(assetProcessingJobs.kind, 'extract_text'),
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
        })
        .from(assetVersions)
        .where(eq(assetVersions.id, claimed.assetVersionId))
        .limit(1);
      if (!version) throw new AssetPersistenceError('Asset版本不存在');
      return {
        storageKey: version.storageKey,
        mimeType: version.mimeType,
        assetVersionId: claimed.assetVersionId,
        producer: claimed.producer,
      };
    });
  }

  /**
   * 由 worker 写入解析终态。
   *
   * 不接受 ownerSubjectId：worker 是系统主体，授权已经在上传时完成，作用域由
   * jobId 唯一确定。只允许从 `queued`/`running` 推进，重复投递因此是幂等的——
   * 任务已终结时直接返回 false，不会把一个已 ready 的资产改回 processing。
   */
  async settleTextExtraction(input: {
    jobId: string;
    outcome:
      | {
          status: 'ready';
          extractedText: string;
          /** D04：抽取文本对象（text representation 的内容身份）。 */
          derivedStorageKey: string;
          /** 抽取文本对象 SHA-256（小写 hex）。 */
          checksum: string;
          /**
           * ADR-0026 质量状态：MinerU/直接 Markdown 解码为 'structured'；
           * 结构化失败后的纯文本回退省略即可（缺省推导 degraded_plain_text）。
           */
          quality?: RepresentationQuality;
          /**
           * 表示 MIME：结构化表示是 text/markdown，降级纯文本是 text/plain。
           * 缺省 text/plain（旧行为）。
           */
          mimeType?: 'text/plain' | 'text/markdown';
        }
      | { status: 'failed'; failureCode: string };
    now?: Date;
  }): Promise<boolean> {
    const jobId = requireUuid(input.jobId);
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const [claimed] = await transaction
        .update(assetProcessingJobs)
        .set({
          status: input.outcome.status === 'ready' ? 'succeeded' : 'failed',
          completedAt: now,
          failureCode:
            input.outcome.status === 'failed'
              ? requireText(input.outcome.failureCode, 'failureCode', 128)
              : null,
        })
        .where(
          and(
            eq(assetProcessingJobs.id, jobId),
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

      const outcome = input.outcome;
      const ready = outcome.status === 'ready';
      const [version] = await transaction
        .update(assetVersions)
        .set({
          status: ready ? 'ready' : 'failed',
          extractedText:
            outcome.status === 'ready' ? outcome.extractedText.trim() : null,
          failureCode: outcome.status === 'failed' ? outcome.failureCode : null,
        })
        .where(eq(assetVersions.id, claimed.assetVersionId))
        .returning();
      if (!version) throw new AssetPersistenceError('Asset版本不存在');

      if (ready && version.extractedText) {
        await upsertAssetRepresentation(transaction, {
          assetVersionId: version.id,
          kind: 'text',
          variant: claimed.variant,
          producer: claimed.producer,
          producerVersion: claimed.producerVersion,
          /* 结构化表示是 Markdown，降级纯文本是 text/plain（ADR-0026 决定 6）。 */
          mimeType: outcome.mimeType ?? 'text/plain',
          status: 'ready',
          quality: outcome.quality,
          derivedStorageKey: outcome.derivedStorageKey,
          checksum: outcome.checksum,
          byteSize: Buffer.byteLength(version.extractedText, 'utf8'),
          now,
        });
      }
      if (!canTransitionAssetStatus('processing', ready ? 'ready' : 'failed')) {
        throw new AssetPersistenceError('Asset状态转换无效');
      }
      await transaction
        .update(assets)
        .set({
          status: ready ? 'ready' : 'failed',
          currentVersionId: ready ? version.id : null,
          updatedAt: now,
        })
        .where(eq(assets.id, version.assetId));
      const derivedKind = ready
        ? getDerivedAssetJobKind(version.mimeType)
        : null;
      if (derivedKind) {
        await enqueueDerivedAssetJob(transaction, {
          assetVersionId: version.id,
          kind: derivedKind,
          now,
        });
      }
      return true;
    });
  }

  /**
   * 供 worker 读取一个待渲染预览任务的输入。
   *
   * 只返回渲染所需的最小事实：storageKey 与 MIME。它不经过公共 API，
   * 也不进入任何面向客户端的投影（storageKey 是私有对象地址）。
   * 任务已终结时返回 null，让重复投递直接退出而不是重跑一遍渲染。
   */
  async beginPreviewRenderAttempt(input: { jobId: string; now?: Date }) {
    return new DrizzleAssetDerivedProcessingRepository(
      this.database,
    ).beginPreviewRenderAttempt(input);
  }

  /**
   * 由 worker 写入预览渲染终态。
   *
   * 不接受 ownerSubjectId：worker 是系统主体，授权已经在上传时完成，作用域由
   * jobId 唯一确定。只允许从 `queued`/`running` 推进，重复投递因此是幂等的——
   * 任务已终结时直接返回 false，不会把一个已 ready 的 representation 改回去。
   */
  async settlePreviewRender(input: {
    jobId: string;
    outcome:
      | {
          status: 'ready';
          derivedStorageKey: string;
          checksum: string;
          byteSize: number;
        }
      | { status: 'failed'; failureCode: string };
    now?: Date;
  }): Promise<boolean> {
    return new DrizzleAssetDerivedProcessingRepository(
      this.database,
    ).settlePreviewRender(input);
  }

  /**
   * 供 worker 读取一个待生成缩略图任务的输入。
   *
   * 只返回生成所需的最小事实：storageKey 与 MIME。它不经过公共 API，
   * 也不进入任何面向客户端的投影（storageKey 是私有对象地址）。
   * 任务已终结时返回 null，让重复投递直接退出而不是重跑一遍生成。
   */
  async beginThumbnailGenerationAttempt(input: { jobId: string; now?: Date }) {
    return new DrizzleAssetDerivedProcessingRepository(
      this.database,
    ).beginThumbnailGenerationAttempt(input);
  }

  /**
   * 由 worker 写入缩略图生成终态。
   *
   * 不接受 ownerSubjectId：worker 是系统主体，授权已经在上传时完成，作用域由
   * jobId 唯一确定。只允许从 `queued`/`running` 推进，重复投递因此是幂等的——
   * 任务已终结时直接返回 false，不会把一个已 ready 的 representation 改回去。
   */
  async settleThumbnailGeneration(input: {
    jobId: string;
    outcome:
      | {
          status: 'ready';
          derivedStorageKey: string;
          checksum: string;
          byteSize: number;
        }
      | { status: 'failed'; failureCode: string };
    now?: Date;
  }): Promise<boolean> {
    return new DrizzleAssetDerivedProcessingRepository(
      this.database,
    ).settleThumbnailGeneration(input);
  }

  /**
   * 供 worker 读取一个待音频转录任务的输入。
   *
   * 只返回转录所需的最小事实：storageKey 与 MIME。它不经过公共 API，
   * 也不进入任何面向客户端的投影（storageKey 是私有对象地址）。
   * 任务已终结时返回 null，让重复投递直接退出而不是重跑一遍转录。
   */
  async beginAudioTranscriptionAttempt(input: { jobId: string; now?: Date }) {
    return new DrizzleAssetTranscriptionRepository(this.database).beginAttempt(
      input,
    );
  }

  /**
   * 由 worker 写入音频转录终态。
   *
   * 不接受 ownerSubjectId：worker 是系统主体，授权已经在上传时完成，作用域由
   * jobId 唯一确定。只允许从 `queued`/`running` 推进，重复投递因此是幂等的——
   * 任务已终结时直接返回 false，不会把已就绪的 representation 改回去。
   *
   * 转录文本是派生内容，写入 transcriptionText 列而非 extractedText，
   * 保证不覆盖原始 Asset Version 的文本抽取结果。
   */
  async settleAudioTranscription(input: {
    jobId: string;
    outcome: AudioTranscriptionOutcome;
    now?: Date;
  }): Promise<boolean> {
    return new DrizzleAssetTranscriptionRepository(this.database).settle(input);
  }

  private validateUploadInput(input: {
    ownerSubjectId: string;
    spaceId: string;
    kind: AssetKind;
    origin?: AssetOrigin;
    displayName: string;
    mimeType: string;
    storageKey: string;
    byteSize: number;
    contentHash: string;
  }): {
    ownerSubjectId: string;
    spaceId: string;
    kind: AssetKind;
    origin: AssetOrigin;
    displayName: string;
    mimeType: string;
    storageKey: string;
  } {
    const storageKey = requireText(input.storageKey, 'storageKey', 1_024);
    if (/^https?:\/\//i.test(storageKey)) {
      throw new AssetPersistenceError('storageKey不能是公开URL');
    }
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 0 ||
      input.byteSize > 50 * 1024 * 1024
    ) {
      throw new AssetPersistenceError('byteSize超出允许范围');
    }
    if (!SHA256.test(input.contentHash)) {
      throw new AssetPersistenceError('contentHash必须是小写SHA-256');
    }
    if (!canTransitionAssetStatus('pending', 'processing')) {
      throw new AssetPersistenceError('Asset状态机不可用');
    }
    // D03：kind/origin 是开放扩展 Vocabulary，写入入口必须通过
    // agent-core Registry（assetKindSchema/assetOriginSchema）验证；
    // 数据库只保留格式约束。
    const kind = assetKindSchema.parse(input.kind);
    const origin = assetOriginSchema.parse(input.origin ?? 'upload');
    return {
      ownerSubjectId: requireOwner(input.ownerSubjectId),
      spaceId: requireUuid(input.spaceId),
      kind,
      origin,
      displayName: requireText(input.displayName, 'displayName', 300),
      mimeType: requireText(input.mimeType, 'mimeType', 255).toLowerCase(),
      storageKey,
    };
  }

  async createUploaded(
    input: CreateUploadedAssetInput,
  ): Promise<AssetSnapshot> {
    const {
      ownerSubjectId,
      spaceId,
      kind,
      origin,
      displayName,
      mimeType,
      storageKey,
    } = this.validateUploadInput(input);

    const now = input.now ?? new Date();
    const assetId = randomUUID();
    const versionId = randomUUID();
    const versionStatus = input.outcome.status;

    return this.database.transaction(async (transaction) => {
      await requireNotebookAccess(transaction, {
        notebookId: spaceId,
        trustedSubjectId: ownerSubjectId,
        requiredPermission: 'source.write',
        now,
      }).catch(() => {
        throw new AssetAccessError();
      });
      const [createdAsset] = await transaction
        .insert(assets)
        .values({
          id: assetId,
          ownerSubjectId,
          spaceId,
          scope: input.scope,
          kind,
          origin,
          displayName,
          mimeType,
          status: 'processing',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const [createdVersion] = await transaction
        .insert(assetVersions)
        .values({
          id: versionId,
          assetId,
          kind,
          mimeType,
          byteSize: input.byteSize,
          contentHash: input.contentHash,
          status: versionStatus,
          storageKey,
          extractedText: input.extractedText?.trim() || null,
          failureCode:
            input.outcome.status === 'failed'
              ? requireText(input.outcome.failureCode, 'failureCode', 128)
              : null,
          createdAt: now,
        })
        .returning();
      if (!createdAsset || !createdVersion) {
        throw new AssetPersistenceError('Asset或版本写入失败');
      }
      await transaction.insert(assetRepresentations).values({
        assetVersionId: versionId,
        kind: ORIGINAL_REPRESENTATION_KIND,
        variant: 'default',
        producer: 'default',
        producerVersion: 'v1',
        mimeType,
        status: 'ready',
        /* original 不携带文档质量维度（ADR-0026 决定 6）。 */
        quality: 'unavailable',
        byteSize: input.byteSize,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });
      const extractedText = input.extractedText?.trim() || null;
      if (extractedText) {
        await transaction.insert(assetRepresentations).values({
          assetVersionId: versionId,
          kind: TEXT_REPRESENTATION_KIND,
          variant: 'default',
          producer: 'default',
          producerVersion: 'v1',
          mimeType: 'text/plain',
          status: 'ready',
          /* 同步提供的正文（如 link 网页导入）是直接解码文本，
             不是结构化转换失败后的回退（ADR-0026 决定 2/6）。 */
          quality: 'structured',
          byteSize: Buffer.byteLength(extractedText, 'utf8'),
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        });
      }
      let processingJob: typeof assetProcessingJobs.$inferSelect | null = null;
      if (input.kind === 'document') {
        const [createdProcessingJob] = await transaction
          .insert(assetProcessingJobs)
          .values({
            assetVersionId: versionId,
            kind: EXTRACT_TEXT_PROCESSOR_KIND,
            status: versionStatus === 'ready' ? 'succeeded' : 'failed',
            attempts: 1,
            failureCode:
              versionStatus === 'failed'
                ? requireText(input.outcome.failureCode, 'failureCode', 128)
                : null,
            startedAt: now,
            completedAt: now,
            createdAt: now,
          })
          .returning();
        processingJob = createdProcessingJob ?? null;
      }

      const nextAssetStatus = versionStatus === 'ready' ? 'ready' : 'failed';
      if (!canTransitionAssetStatus('processing', nextAssetStatus)) {
        throw new AssetPersistenceError('Asset状态转换无效');
      }
      const [updatedAsset] = await transaction
        .update(assets)
        .set({
          status: nextAssetStatus,
          currentVersionId: versionStatus === 'ready' ? versionId : null,
          updatedAt: now,
        })
        .where(eq(assets.id, assetId))
        .returning();
      if (!updatedAsset) throw new AssetPersistenceError('Asset状态更新失败');
      const derivedKind =
        versionStatus === 'ready' ? getDerivedAssetJobKind(mimeType) : null;
      if (derivedKind) {
        await enqueueDerivedAssetJob(transaction, {
          assetVersionId: versionId,
          kind: derivedKind,
          now,
        });
      }
      return toSnapshot(updatedAsset, createdVersion, processingJob);
    });
  }

  async listOwnedSpace(input: {
    ownerSubjectId: string;
    spaceId: string;
    limit?: number;
  }): Promise<readonly AssetSnapshot[]> {
    return (await this.listAccessibleSpacePage(input)).items;
  }

  async listAccessibleSpacePage(input: {
    ownerSubjectId: string;
    spaceId: string;
    limit?: number;
    cursor?: TemporalIdCursor | null;
  }): Promise<CursorPage<AssetSnapshot>> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const limit = boundedPageLimit(input.limit);
    await requireNotebookAccess(this.database, {
      notebookId: spaceId,
      trustedSubjectId: ownerSubjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => {
      throw new AssetAccessError();
    });
    const rows = await this.database
      .select({ asset: assets, version: assetVersions })
      .from(assets)
      .leftJoin(assetVersions, eq(assetVersions.id, assets.currentVersionId))
      .where(
        and(
          eq(assets.spaceId, spaceId),
          ne(assets.status, 'tombstoned'),
          input.cursor
            ? or(
                lt(assets.createdAt, input.cursor.timestamp),
                and(
                  eq(assets.createdAt, input.cursor.timestamp),
                  lt(assets.id, input.cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(limit + 1);
    const pageRows = rows.slice(0, limit);
    const processingJobs = await this.loadLatestProcessingJobsByAssetIds(
      pageRows.map(({ asset }) => asset.id),
    );
    const last = pageRows.at(-1)?.asset;
    return {
      items: pageRows.map(({ asset, version }) =>
        toSnapshot(asset, version, processingJobs.get(asset.id) ?? null),
      ),
      nextCursor:
        rows.length > limit && last
          ? { timestamp: last.createdAt, id: last.id }
          : null,
    };
  }

  /**
   * 读取单个主体和空间内的Asset状态投影；失败或处理中可以没有当前内容版本。
   * 不返回storageKey，供状态类只读组合层使用。
   */
  async getOwnedSnapshot(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
  }): Promise<AssetSnapshot> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    await requireNotebookAccess(this.database, {
      notebookId: spaceId,
      trustedSubjectId: ownerSubjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => {
      throw new AssetAccessError();
    });
    const [row] = await this.database
      .select({ asset: assets, version: assetVersions })
      .from(assets)
      .leftJoin(assetVersions, eq(assetVersions.id, assets.currentVersionId))
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.spaceId, spaceId),
          ne(assets.status, 'tombstoned'),
        ),
      )
      .limit(1);
    if (!row) throw new AssetAccessError();
    const processingJobs = await this.loadLatestProcessingJobsByAssetIds([
      row.asset.id,
    ]);
    return toSnapshot(
      row.asset,
      row.version,
      processingJobs.get(row.asset.id) ?? null,
    );
  }

  /** Canvas 动作策略只使用数据库成员角色与资源创建者，不接受客户端声明。 */
  async getAccessPolicy(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
  }): Promise<AssetAccessPolicy> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    const access = await requireNotebookAccess(this.database, {
      notebookId: spaceId,
      trustedSubjectId: ownerSubjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => null);
    if (!access) throw new AssetAccessError();
    const [asset] = await this.database
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.spaceId, spaceId),
          ne(assets.status, 'tombstoned'),
        ),
      )
      .limit(1);
    if (!asset) throw new AssetAccessError();
    return { role: access.role };
  }

  /**
   * 读取当前主体和空间内的已就绪对象存储版本。
   * 调用边界：只允许服务端在完成身份与Notebook路由后读取，返回值不得序列化给客户端。
   */
  async loadOwnedCurrentStoredVersion(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
  }): Promise<OwnedStoredAssetVersion> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    await requireNotebookAccess(this.database, {
      notebookId: spaceId,
      trustedSubjectId: ownerSubjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => {
      throw new AssetAccessError();
    });
    const [row] = await this.database
      .select({ asset: assets, version: assetVersions })
      .from(assets)
      .innerJoin(assetVersions, eq(assetVersions.id, assets.currentVersionId))
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.spaceId, spaceId),
          eq(assets.status, 'ready'),
          eq(assetVersions.status, 'ready'),
        ),
      )
      .limit(1);
    if (!row) throw new AssetAccessError();
    const orderedDerivedStatuses =
      row.asset.kind === 'video'
        ? await this.database
            .select({
              kind: assetRepresentations.kind,
              status: assetRepresentations.status,
            })
            .from(assetRepresentations)
            .where(
              and(
                eq(assetRepresentations.assetVersionId, row.version.id),
                inArray(assetRepresentations.kind, [
                  'transcription',
                  'keyframes',
                ]),
              ),
            )
            .orderBy(
              asc(assetRepresentations.kind),
              ...defaultRepresentationOrderBy(),
            )
        : [];
    const derivedStatuses = orderedDerivedStatuses.filter(
      (item, index, items) =>
        index === items.findIndex((candidate) => candidate.kind === item.kind),
    );
    /* D04：默认 identity 的 transcription representation（确定性默认选择：
       ready 优先 → variant/producer default → producer_version 字典序）。 */
    const [transcriptionRepresentation] =
      row.asset.kind === 'video' || row.asset.kind === 'audio'
        ? await this.database
            .select({
              derivedStorageKey: assetRepresentations.derivedStorageKey,
              checksum: assetRepresentations.checksum,
              status: assetRepresentations.status,
            })
            .from(assetRepresentations)
            .where(
              and(
                eq(assetRepresentations.assetVersionId, row.version.id),
                eq(assetRepresentations.kind, 'transcription'),
              ),
            )
            .orderBy(...defaultRepresentationOrderBy())
            .limit(1)
        : [];
    /* ADR-0026：默认 identity 的 text representation（同样按确定性默认选择；
       quality 四态供预览层显示实际状态）。 */
    const [textRepresentation] = await this.database
      .select({
        derivedStorageKey: assetRepresentations.derivedStorageKey,
        checksum: assetRepresentations.checksum,
        status: assetRepresentations.status,
        quality: assetRepresentations.quality,
        mimeType: assetRepresentations.mimeType,
      })
      .from(assetRepresentations)
      .where(
        and(
          eq(assetRepresentations.assetVersionId, row.version.id),
          eq(assetRepresentations.kind, 'text'),
        ),
      )
      .orderBy(...defaultRepresentationOrderBy())
      .limit(1);
    return {
      assetId: row.asset.id,
      versionId: row.version.id,
      displayName: row.asset.displayName,
      mimeType: row.version.mimeType,
      byteSize: row.version.byteSize,
      contentHash: row.version.contentHash,
      origin: assetOriginSchema.parse(row.asset.origin),
      createdAt: row.version.createdAt.toISOString(),
      storageKey: row.version.storageKey,
      extractedText: row.version.extractedText,
      transcriptionText: row.version.transcriptionText,
      transcriptionMetadata: row.version.transcriptionMetadata,
      derivedStatuses: derivedStatuses.map((representation) => ({
        kind: representation.kind as 'transcription' | 'keyframes',
        status: representation.status as
          'processing' | 'ready' | 'failed' | 'unavailable',
      })),
      transcriptionRepresentation:
        transcriptionRepresentation &&
        transcriptionRepresentation.derivedStorageKey &&
        transcriptionRepresentation.checksum
          ? {
              derivedStorageKey: transcriptionRepresentation.derivedStorageKey,
              checksum: transcriptionRepresentation.checksum,
              status: transcriptionRepresentation.status as
                'ready' | 'failed' | 'processing' | 'unavailable',
            }
          : null,
      textRepresentation:
        textRepresentation &&
        textRepresentation.derivedStorageKey &&
        textRepresentation.checksum
          ? {
              derivedStorageKey: textRepresentation.derivedStorageKey,
              checksum: textRepresentation.checksum,
              status: textRepresentation.status as
                'ready' | 'failed' | 'processing' | 'unavailable',
              quality: textRepresentation.quality as RepresentationQuality,
              mimeType: textRepresentation.mimeType,
            }
          : null,
    };
  }

  /**
   * 供资源路由读取某 Asset 的文本派生表示（ADR-0026 决定 3：响应派生
   * 资源时重新校验用户、Notebook、Asset 与 Version 权限）。权限复验与
   * `loadOwnedCurrentStoredVersion` 相同；text 表示采用与转录一致的
   * 确定性默认选择（ready 优先 → variant/producer default → 字典序）。
   * 无可用表示返回 null（调用方按 404 处理）。
   */
  async loadOwnedTextRepresentation(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
  }): Promise<{
    derivedStorageKey: string;
    checksum: string;
    status: 'processing' | 'ready' | 'failed' | 'unavailable';
    quality: RepresentationQuality;
    mimeType: string | null;
  } | null> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    await requireNotebookAccess(this.database, {
      notebookId: spaceId,
      trustedSubjectId: ownerSubjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => {
      throw new AssetAccessError();
    });
    const [row] = await this.database
      .select({ assetId: assets.id, versionId: assetVersions.id })
      .from(assets)
      .innerJoin(assetVersions, eq(assetVersions.id, assets.currentVersionId))
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.spaceId, spaceId),
          eq(assets.status, 'ready'),
          eq(assetVersions.status, 'ready'),
        ),
      )
      .limit(1);
    if (!row) throw new AssetAccessError();
    const [representation] = await this.database
      .select({
        derivedStorageKey: assetRepresentations.derivedStorageKey,
        checksum: assetRepresentations.checksum,
        status: assetRepresentations.status,
        quality: assetRepresentations.quality,
        mimeType: assetRepresentations.mimeType,
      })
      .from(assetRepresentations)
      .where(
        and(
          eq(assetRepresentations.assetVersionId, row.versionId),
          eq(assetRepresentations.kind, 'text'),
        ),
      )
      .orderBy(...defaultRepresentationOrderBy())
      .limit(1);
    if (
      !representation ||
      !representation.derivedStorageKey ||
      !representation.checksum
    ) {
      return null;
    }
    return {
      derivedStorageKey: representation.derivedStorageKey,
      checksum: representation.checksum,
      status: representation.status as
        'processing' | 'ready' | 'failed' | 'unavailable',
      quality: representation.quality as RepresentationQuality,
      mimeType: representation.mimeType,
    };
  }

  async materializeOwnedReferences(input: {
    ownerSubjectId: string;
    spaceId: string;
    references: readonly AssetVersionReference[];
  }): Promise<readonly MaterializedAssetVersion[]> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const references = input.references.map((reference) =>
      assetVersionReferenceSchema.parse(reference),
    );
    if (references.length === 0) return [];

    try {
      const rows = await loadOwnedReadyAssetVersions(this.database, {
        ownerSubjectId,
        spaceId,
        references,
      });
      return rows.map((row, index) => {
        const reference = references[index]!;
        return {
          reference,
          displayName: row.asset.displayName,
          mimeType: row.version.mimeType,
          byteSize: row.version.byteSize,
          extractedText: row.version.extractedText,
          transcriptionText: row.version.transcriptionText,
        };
      });
    } catch (error) {
      if (error instanceof OwnedAssetVersionError) throw new AssetAccessError();
      throw error;
    }
  }

  /**
   * 将资产及版本收敛为tombstoned；保留storageKey供后续Outbox物理清理。
   * 调用者必须传入服务端确认的主体与空间，跨主体请求统一返回false。
   */
  /**
   * 读取某个成员在当前 Notebook 内的来源启停状态。
   *
   * 启停是成员私有事实：只要求 `notebook.read`，viewer 也能有自己的一份。
   * 取值是每个 asset 下 sequence 最大的那条事实；从未切换过的 asset 不出现在
   * 结果里，由调用方决定默认值（当前 UI 默认启用 space 级来源）。
   */
  async listSubjectAssetBindings(input: {
    subjectId: string;
    spaceId: string;
  }): Promise<ReadonlyMap<string, boolean>> {
    const subjectId = requireOwner(input.subjectId);
    const spaceId = requireUuid(input.spaceId);
    await requireNotebookAccess(this.database, {
      notebookId: spaceId,
      trustedSubjectId: subjectId,
      requiredPermission: 'notebook.read',
    }).catch(() => {
      throw new AssetAccessError();
    });
    const rows = await this.database
      .selectDistinctOn(
        [notebookAssetBindings.subjectId, notebookAssetBindings.assetId],
        {
          assetId: notebookAssetBindings.assetId,
          enabled: notebookAssetBindings.enabled,
        },
      )
      .from(notebookAssetBindings)
      .innerJoin(assets, eq(assets.id, notebookAssetBindings.assetId))
      .where(
        and(
          eq(notebookAssetBindings.subjectId, subjectId),
          eq(assets.spaceId, spaceId),
          ne(assets.status, 'tombstoned'),
        ),
      )
      .orderBy(
        notebookAssetBindings.subjectId,
        notebookAssetBindings.assetId,
        desc(notebookAssetBindings.sequence),
      );
    return new Map(rows.map((row) => [row.assetId, row.enabled]));
  }

  /**
   * 追加一条启停事实。返回生效后的值。
   *
   * `mutationId` 让重放幂等：同一成员重复提交同一个 mutationId 时唯一索引冲突，
   * 此时读回既有事实返回，而不是写第二条或报错——网络重试不该翻转开关。
   */
  async setSubjectAssetBinding(input: {
    subjectId: string;
    spaceId: string;
    assetId: string;
    enabled: boolean;
    mutationId: string;
  }): Promise<boolean | null> {
    const subjectId = requireOwner(input.subjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    const mutationId = requireText(input.mutationId, 'mutationId', 128);
    return this.database.transaction(async (transaction) => {
      const access = await requireNotebookAccess(transaction, {
        notebookId: spaceId,
        trustedSubjectId: subjectId,
        requiredPermission: 'notebook.read',
      }).catch(() => null);
      if (!access) return null;
      const [owned] = await transaction
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.spaceId, spaceId),
            ne(assets.status, 'tombstoned'),
          ),
        )
        .limit(1);
      if (!owned) return null;

      const [replayed] = await transaction
        .select({ enabled: notebookAssetBindings.enabled })
        .from(notebookAssetBindings)
        .where(
          and(
            eq(notebookAssetBindings.subjectId, subjectId),
            eq(notebookAssetBindings.mutationId, mutationId),
          ),
        )
        .limit(1);
      if (replayed) return replayed.enabled;

      const [latest] = await transaction
        .select({ sequence: notebookAssetBindings.sequence })
        .from(notebookAssetBindings)
        .where(
          and(
            eq(notebookAssetBindings.subjectId, subjectId),
            eq(notebookAssetBindings.assetId, assetId),
          ),
        )
        .orderBy(desc(notebookAssetBindings.sequence))
        .limit(1);
      await transaction.insert(notebookAssetBindings).values({
        subjectId,
        assetId,
        sequence: (latest?.sequence ?? 0) + 1,
        enabled: input.enabled,
        mutationId,
      });
      return input.enabled;
    });
  }

  /** 重命名是共享事实，按 `source.write` 授权；只改展示名，不动任何版本。 */
  async renameOwnedAsset(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
    displayName: string;
  }): Promise<boolean> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    const displayName = requireText(input.displayName, 'displayName', 300);
    return this.database.transaction(async (transaction) => {
      const access = await requireNotebookAccess(transaction, {
        notebookId: spaceId,
        trustedSubjectId: ownerSubjectId,
        requiredPermission: 'source.write',
      }).catch(() => null);
      if (!access) return false;
      const updated = await transaction
        .update(assets)
        .set({ displayName, updatedAt: new Date() })
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.spaceId, spaceId),
            ne(assets.status, 'tombstoned'),
          ),
        )
        .returning({ id: assets.id });
      return updated.length > 0;
    });
  }

  async tombstoneOwnedAsset(input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
  }): Promise<boolean> {
    const ownerSubjectId = requireOwner(input.ownerSubjectId);
    const spaceId = requireUuid(input.spaceId);
    const assetId = requireUuid(input.assetId);
    const now = new Date();
    return this.database.transaction(async (transaction) => {
      const access = await requireNotebookAccess(transaction, {
        notebookId: spaceId,
        trustedSubjectId: ownerSubjectId,
        requiredPermission: 'source.write',
        now,
      }).catch(() => null);
      if (!access) return false;
      const [owned] = await transaction
        .select({ id: assets.id, createdBy: assets.ownerSubjectId })
        .from(assets)
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.spaceId, spaceId),
            ne(assets.status, 'tombstoned'),
          ),
        )
        .limit(1);
      if (!owned) return false;
      if (
        owned.createdBy !== ownerSubjectId &&
        access.role !== 'owner' &&
        access.role !== 'editor'
      ) {
        return false;
      }

      const storedVersions = await transaction
        .select({
          id: assetVersions.id,
          storageKey: assetVersions.storageKey,
        })
        .from(assetVersions)
        .where(eq(assetVersions.assetId, assetId));
      const derivedRepresentations = await transaction
        .select({
          id: assetRepresentations.id,
          storageKey: assetRepresentations.derivedStorageKey,
        })
        .from(assetRepresentations)
        .innerJoin(
          assetVersions,
          eq(assetVersions.id, assetRepresentations.assetVersionId),
        )
        .where(
          and(
            eq(assetVersions.assetId, assetId),
            isNotNull(assetRepresentations.derivedStorageKey),
          ),
        );
      /* 关键帧与 representation 一样是派生对象，删除 Source 时必须一并进入
         删除 outbox；漏掉它们会在对象存储里留下无人引用的孤儿帧。 */
      const derivedKeyframes = await transaction
        .select({
          id: assetVideoKeyframes.id,
          storageKey: assetVideoKeyframes.storageKey,
        })
        .from(assetVideoKeyframes)
        .innerJoin(
          assetVersions,
          eq(assetVersions.id, assetVideoKeyframes.assetVersionId),
        )
        .where(eq(assetVersions.assetId, assetId));
      const deletionEntries = [
        ...storedVersions.map((version) => ({
          objectKind: 'asset' as const,
          storageKey: version.storageKey,
          sourceType: 'asset_version' as const,
          sourceId: version.id,
          availableAt: now,
        })),
        ...derivedKeyframes.map((keyframe) => ({
          objectKind: 'asset' as const,
          storageKey: keyframe.storageKey,
          sourceType: 'asset_video_keyframe' as const,
          sourceId: keyframe.id,
          availableAt: now,
        })),
        ...derivedRepresentations.flatMap((representation) =>
          representation.storageKey
            ? [
                {
                  objectKind: 'asset' as const,
                  storageKey: representation.storageKey,
                  sourceType: 'asset_representation' as const,
                  sourceId: representation.id,
                  availableAt: now,
                },
              ]
            : [],
        ),
      ];
      if (deletionEntries.length > 0) {
        await transaction
          .insert(objectDeletionOutbox)
          .values(deletionEntries)
          .onConflictDoNothing();
      }
      await transaction
        .update(assetVersions)
        .set({ status: 'tombstoned' })
        .where(eq(assetVersions.assetId, assetId));
      await transaction
        .update(assets)
        .set({ status: 'tombstoned', tombstonedAt: now, updatedAt: now })
        .where(eq(assets.id, assetId));
      return true;
    });
  }
}
