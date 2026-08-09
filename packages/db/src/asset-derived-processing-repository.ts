import { randomUUID } from 'node:crypto';
import type {
  AssetProcessorKind,
  AssetRepresentationKind,
} from '@educanvas/agent-core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from './client';
import { isUuid } from './internal/identifiers';
import { upsertAssetRepresentation } from './asset-representation-repository';
import {
  assetProcessingJobs,
  assetRepresentations,
  assets,
  assetVersions,
} from './schema';

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const ASSET_RENDER_PREVIEW_TASK = 'assets:render_preview' as const;
export const ASSET_GENERATE_THUMBNAIL_TASK =
  'assets:generate_thumbnail' as const;

export type DerivedAssetJobKind = Extract<
  AssetProcessorKind,
  'render_preview' | 'generate_thumbnail'
>;

const PREVIEW_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml',
]);
const THUMBNAIL_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const SHA256 = /^[a-f0-9]{64}$/;

const JOB_CONFIG = {
  render_preview: {
    taskName: ASSET_RENDER_PREVIEW_TASK,
    representationKind: 'preview',
    representationMimeType: 'text/html',
  },
  generate_thumbnail: {
    taskName: ASSET_GENERATE_THUMBNAIL_TASK,
    representationKind: 'thumbnail',
    representationMimeType: 'image/jpeg',
  },
} as const satisfies Record<
  DerivedAssetJobKind,
  {
    taskName: string;
    representationKind: AssetRepresentationKind;
    representationMimeType: string;
  }
>;

export function getDerivedAssetJobKind(
  mimeType: string,
): DerivedAssetJobKind | null {
  if (PREVIEW_MIME_TYPES.has(mimeType)) return 'render_preview';
  if (THUMBNAIL_MIME_TYPES.has(mimeType)) return 'generate_thumbnail';
  return null;
}

/**
 * 在原始版本变为 ready 的同一事务中创建派生账本与 Graphile Job。
 * 调用方只能传服务端根据权威 MIME 选择的 kind。
 */
export async function enqueueDerivedAssetJob(
  transaction: Transaction,
  input: {
    assetVersionId: string;
    kind: DerivedAssetJobKind;
    now: Date;
  },
): Promise<string | null> {
  const config = JOB_CONFIG[input.kind];
  /* D04：唯一约束 (asset_version_id, kind, variant, producer, producer_version)
     直接兜底 TOCTOU——并发重复 enqueue 时 insert 冲突即幂等返回，不再依赖先查后插。 */
  const jobId = randomUUID();
  const queueJobKey = `asset-${input.kind}:${jobId}`;
  const insertedJob = await transaction
    .insert(assetProcessingJobs)
    .values({
      id: jobId,
      assetVersionId: input.assetVersionId,
      kind: input.kind,
      variant: 'default',
      producer: 'default',
      producerVersion: 'v1',
      status: 'queued',
      attempts: 0,
      queueJobKey,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: assetProcessingJobs.id });
  if (!insertedJob[0]) return null;
  await transaction
    .insert(assetRepresentations)
    .values({
      assetVersionId: input.assetVersionId,
      kind: config.representationKind,
      variant: 'default',
      producer: 'default',
      producerVersion: 'v1',
      mimeType: config.representationMimeType,
      status: 'processing',
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing();
  await transaction.execute(sql`
    select graphile_worker.add_job(
      ${config.taskName},
      payload := ${JSON.stringify({ jobId })}::json,
      job_key := ${queueJobKey},
      max_attempts := 3
    )
  `);
  return jobId;
}

export interface DerivedAssetAttempt {
  storageKey: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
}

type SettleOutcome =
  | {
      status: 'ready';
      derivedStorageKey: string;
      checksum: string;
      byteSize: number;
    }
  | { status: 'failed'; failureCode: string };

/** Worker 专用派生任务仓储；私有对象键不会进入公共 API 或 CanvasResource。 */
export class DrizzleAssetDerivedProcessingRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  beginPreviewRenderAttempt(input: {
    jobId: string;
    now?: Date;
  }): Promise<DerivedAssetAttempt | null> {
    return this.beginAttempt('render_preview', input);
  }

  beginThumbnailGenerationAttempt(input: {
    jobId: string;
    now?: Date;
  }): Promise<DerivedAssetAttempt | null> {
    return this.beginAttempt('generate_thumbnail', input);
  }

  settlePreviewRender(input: {
    jobId: string;
    outcome: SettleOutcome;
    now?: Date;
  }): Promise<boolean> {
    return this.settleAttempt('render_preview', input);
  }

  settleThumbnailGeneration(input: {
    jobId: string;
    outcome: SettleOutcome;
    now?: Date;
  }): Promise<boolean> {
    return this.settleAttempt('generate_thumbnail', input);
  }

  private async beginAttempt(
    kind: DerivedAssetJobKind,
    input: { jobId: string; now?: Date },
  ): Promise<DerivedAssetAttempt | null> {
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
            eq(assetProcessingJobs.kind, kind),
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
            eq(assetVersions.status, 'ready'),
            eq(assets.status, 'ready'),
            eq(assets.currentVersionId, assetVersions.id),
          ),
        )
        .limit(1);
      if (version) return version;

      // 旧版本或已删除资产不再产生派生物；这是无害取消，不进入失败重试。
      await transaction
        .update(assetProcessingJobs)
        .set({ status: 'cancelled', completedAt: now, failureCode: null })
        .where(
          and(
            eq(assetProcessingJobs.id, jobId),
            eq(assetProcessingJobs.kind, kind),
            eq(assetProcessingJobs.status, 'running'),
          ),
        );
      return null;
    });
  }

  private async settleAttempt(
    kind: DerivedAssetJobKind,
    input: { jobId: string; outcome: SettleOutcome; now?: Date },
  ): Promise<boolean> {
    const jobId = requireUuid(input.jobId);
    const now = input.now ?? new Date();
    const config = JOB_CONFIG[kind];
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
            eq(assetProcessingJobs.kind, kind),
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

      await upsertAssetRepresentation(transaction, {
        assetVersionId: claimed.assetVersionId,
        kind: config.representationKind,
        variant: claimed.variant,
        producer: claimed.producer,
        producerVersion: claimed.producerVersion,
        mimeType: config.representationMimeType,
        status: outcome.status,
        derivedStorageKey:
          outcome.status === 'ready' ? outcome.derivedStorageKey : null,
        checksum: outcome.status === 'ready' ? outcome.checksum : null,
        byteSize: outcome.status === 'ready' ? outcome.byteSize : null,
        failureCode: outcome.status === 'failed' ? outcome.failureCode : null,
        now,
      });
      return true;
    });
  }
}

function requireUuid(value: string): string {
  if (!isUuid(value)) throw new Error('asset_job_not_available');
  return value;
}

function validateOutcome(outcome: SettleOutcome): SettleOutcome {
  if (outcome.status === 'failed') {
    const failureCode = outcome.failureCode.normalize('NFC').trim();
    if (!failureCode || failureCode.length > 128) {
      throw new Error('invalid_asset_failure_code');
    }
    return { status: 'failed', failureCode };
  }
  const derivedStorageKey = outcome.derivedStorageKey.normalize('NFC').trim();
  if (
    !derivedStorageKey ||
    derivedStorageKey.length > 1_024 ||
    /^https?:\/\//i.test(derivedStorageKey) ||
    !SHA256.test(outcome.checksum) ||
    !Number.isSafeInteger(outcome.byteSize) ||
    outcome.byteSize < 0 ||
    outcome.byteSize > 50 * 1024 * 1024
  ) {
    throw new Error('invalid_asset_derived_outcome');
  }
  return { ...outcome, derivedStorageKey };
}
