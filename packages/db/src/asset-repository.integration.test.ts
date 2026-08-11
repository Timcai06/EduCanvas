import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DrizzleObjectDeletionOutboxRepository,
  OBJECT_DELETION_LEASE_TIMEOUT_MS,
} from './object-deletion-outbox-repository';
import {
  DrizzleAssetDerivedProcessingRepository,
  getDerivedAssetJobKind,
} from './asset-derived-processing-repository';
import { DrizzleAssetTranscriptionRepository } from './asset-transcription-repository';
import { DrizzleAssetVideoRepository } from './asset-video-repository';
import { AssetAccessError, DrizzleAssetRepository } from './asset-repository';
import { DrizzleChatRepository } from './chat-repository';
import * as schema from './schema';
import { DrizzleTeachingTurnLedger } from './turn-ledger-repository';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('集成测试拒绝清空非隔离数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 8 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;
const ownerSubjectId = `anon:v1:${'a'.repeat(64)}`;
const otherSubjectId = `anon:v1:${'b'.repeat(64)}`;
const spaceId = '91000000-0000-4000-8000-000000000001';
const otherSpaceId = '91000000-0000-4000-8000-000000000002';

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

function readyPdf(
  overrides: Partial<
    Parameters<DrizzleAssetRepository['createUploaded']>[0]
  > = {},
) {
  return {
    ownerSubjectId,
    spaceId,
    scope: 'space' as const,
    kind: 'document' as const,
    displayName: '视觉识别讲义.pdf',
    mimeType: 'application/pdf',
    byteSize: 256,
    contentHash: 'c'.repeat(64),
    storageKey: 'uploads/fixture/vision.pdf',
    extractedText: '图像分类模型会从像素中提取可比较的特征。',
    outcome: { status: 'ready' as const },
    ...overrides,
  };
}

describeWithDatabase('平台Asset仓储与消息引用', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table
        object_deletion_outbox,
        asset_video_keyframes,
        asset_processing_jobs,
        asset_representations,
        agent_message_parts,
        chat_messages,
        asset_versions,
        assets,
        lesson_sessions,
        notebook_memberships,
        spaces,
        personal_agents,
        platform_users
      restart identity cascade
    `);
    await getDatabase()
      .insert(schema.platformUsers)
      .values([
        { id: ownerSubjectId, kind: 'anonymous_compat', status: 'active' },
        { id: otherSubjectId, kind: 'anonymous_compat', status: 'active' },
      ]);
    await getDatabase()
      .insert(schema.spaces)
      .values([
        {
          id: spaceId,
          ownerSubjectId,
          kind: 'notebook',
          title: 'Asset fixture',
        },
        {
          id: otherSpaceId,
          ownerSubjectId,
          kind: 'notebook',
          title: 'Other fixture',
        },
      ]);
    await getDatabase()
      .insert(schema.notebookMemberships)
      .values([
        {
          notebookId: spaceId,
          userId: ownerSubjectId,
          role: 'owner',
          grantedByUserId: ownerSubjectId,
        },
        {
          notebookId: otherSpaceId,
          userId: ownerSubjectId,
          role: 'owner',
          grantedByUserId: ownerSubjectId,
        },
      ]);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('创建不可变版本、列出公开描述并按所有权物化正文', async () => {
    const repository = new DrizzleAssetRepository(getDatabase());
    const created = await repository.createUploaded(readyPdf());

    expect(created.descriptor).toMatchObject({
      scope: 'space',
      kind: 'document',
      status: 'ready',
      displayName: '视觉识别讲义.pdf',
    });
    expect(created.version?.versionId).toBe(
      created.descriptor.currentVersionId,
    );
    expect(JSON.stringify(created)).not.toContain('uploads/fixture');
    await expect(
      getDatabase()
        .select()
        .from(schema.assetRepresentations)
        .orderBy(schema.assetRepresentations.kind),
    ).resolves.toMatchObject([
      { kind: 'original', status: 'ready' },
      { kind: 'preview', status: 'processing' },
      { kind: 'text', status: 'ready' },
    ]);
    await expect(
      getDatabase()
        .select()
        .from(schema.assetProcessingJobs)
        .orderBy(schema.assetProcessingJobs.kind),
    ).resolves.toMatchObject([
      { kind: 'extract_text', status: 'succeeded', attempts: 1 },
      { kind: 'render_preview', status: 'queued', attempts: 0 },
    ]);

    await expect(
      repository.listOwnedSpace({ ownerSubjectId, spaceId }),
    ).resolves.toEqual([created]);
    const reference = {
      assetId: created.descriptor.assetId,
      versionId: created.version!.versionId,
      kind: 'document' as const,
    };
    await expect(
      repository.materializeOwnedReferences({
        ownerSubjectId,
        spaceId,
        references: [reference],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        reference,
        extractedText: '图像分类模型会从像素中提取可比较的特征。',
      }),
    ]);

    await expect(
      repository.materializeOwnedReferences({
        ownerSubjectId: otherSubjectId,
        spaceId,
        references: [reference],
      }),
    ).rejects.toBeInstanceOf(AssetAccessError);
  });

  it('失败版本可审计但不能进入消息上下文', async () => {
    const repository = new DrizzleAssetRepository(getDatabase());
    const failed = await repository.createUploaded(
      readyPdf({
        contentHash: 'd'.repeat(64),
        storageKey: 'uploads/fixture/scanned.pdf',
        extractedText: null,
        outcome: { status: 'failed', failureCode: 'pdf_text_unavailable' },
      }),
    );
    expect(failed.descriptor.status).toBe('failed');
    expect(failed.descriptor.currentVersionId).toBeNull();
    await expect(
      repository.materializeOwnedReferences({
        ownerSubjectId,
        spaceId,
        references: [
          {
            assetId: failed.descriptor.assetId,
            versionId: failed.version!.versionId,
            kind: 'document',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(AssetAccessError);
  });

  it('异步解析按ISO时间领取并把处理账本推进到可公开终态', async () => {
    const repository = new DrizzleAssetRepository(getDatabase());
    const assetId = '92000000-0000-4000-8000-000000000001';
    const versionId = '92000000-0000-4000-8000-000000000002';
    const jobId = '92000000-0000-4000-8000-000000000003';
    const startedAt = new Date('2026-07-26T08:01:39.806Z');
    await getDatabase().insert(schema.assets).values({
      id: assetId,
      ownerSubjectId,
      spaceId,
      scope: 'space',
      kind: 'document',
      origin: 'upload',
      displayName: '异步解析讲义.md',
      mimeType: 'text/markdown',
      status: 'processing',
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    await getDatabase()
      .insert(schema.assetVersions)
      .values({
        id: versionId,
        assetId,
        kind: 'document',
        mimeType: 'text/markdown',
        byteSize: 12,
        contentHash: 'e'.repeat(64),
        status: 'processing',
        storageKey: 'uploads/fixture/async.md',
        createdAt: startedAt,
      });
    await getDatabase().insert(schema.assetProcessingJobs).values({
      id: jobId,
      assetVersionId: versionId,
      kind: 'extract_text',
      status: 'queued',
      attempts: 0,
      createdAt: startedAt,
    });
    await getDatabase().insert(schema.assetRepresentations).values({
      assetVersionId: versionId,
      kind: 'text',
      variant: 'default',
      producer: 'default',
      producerVersion: 'v1',
      mimeType: 'text/plain',
      status: 'processing',
      /* ADR-0026 决定 6 形状约束：processing 状态要求 processing 质量。 */
      quality: 'processing',
      createdAt: startedAt,
      updatedAt: startedAt,
    });

    await expect(
      repository.beginTextExtractionAttempt({ jobId, now: startedAt }),
    ).resolves.toEqual({
      storageKey: 'uploads/fixture/async.md',
      mimeType: 'text/markdown',
      /* assetVersionId/producer 供日志链路使用（ADR-0026 决定 6）。 */
      assetVersionId: versionId,
      producer: 'default',
    });
    await expect(
      repository.settleTextExtraction({
        jobId,
        outcome: {
          status: 'ready',
          extractedText: '异步解析完成',
          derivedStorageKey: `derived/text/${jobId}/abc.txt`,
          checksum: 'a'.repeat(64),
        },
        now: new Date('2026-07-26T08:02:00.000Z'),
      }),
    ).resolves.toBe(true);

    await expect(
      repository.getOwnedSnapshot({
        ownerSubjectId,
        spaceId,
        assetId,
      }),
    ).resolves.toMatchObject({
      descriptor: { status: 'ready', currentVersionId: versionId },
      processing: {
        status: 'succeeded',
        attempts: 1,
        failureCode: null,
        startedAt: startedAt.toISOString(),
        completedAt: '2026-07-26T08:02:00.000Z',
      },
    });
    await expect(
      getDatabase()
        .select()
        .from(schema.assetProcessingJobs)
        .where(sql`${schema.assetProcessingJobs.kind} <> 'extract_text'`),
    ).resolves.toEqual([]);
    await expect(
      getDatabase()
        .select({ id: schema.assetRepresentations.id })
        .from(schema.assetRepresentations)
        .where(
          sql`${schema.assetRepresentations.assetVersionId} = ${versionId} and ${schema.assetRepresentations.kind} = 'text'`,
        ),
    ).resolves.toHaveLength(1);
  });

  it('settle 显式 quality=structured 时落结构化表示（ADR-0026 决定 6）', async () => {
    const repository = new DrizzleAssetRepository(getDatabase());
    const startedAt = new Date('2026-07-26T08:00:00.000Z');
    const assetId = '92000000-0000-4000-8000-0000000000aa';
    const versionId = '92000000-0000-4000-8000-0000000000ab';
    const jobId = '92000000-0000-4000-8000-0000000000ac';
    await getDatabase().insert(schema.assets).values({
      id: assetId,
      ownerSubjectId,
      spaceId,
      scope: 'space',
      kind: 'document',
      origin: 'upload',
      displayName: '讲义.pdf',
      mimeType: 'application/pdf',
      status: 'processing',
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    await getDatabase()
      .insert(schema.assetVersions)
      .values({
        id: versionId,
        assetId,
        kind: 'document',
        mimeType: 'application/pdf',
        byteSize: 12,
        contentHash: 'e'.repeat(64),
        status: 'processing',
        storageKey: 'uploads/fixture/讲义.pdf',
        createdAt: startedAt,
      });
    await getDatabase().insert(schema.assetProcessingJobs).values({
      id: jobId,
      assetVersionId: versionId,
      kind: 'extract_text',
      status: 'queued',
      attempts: 0,
      createdAt: startedAt,
    });

    await repository.beginTextExtractionAttempt({ jobId, now: startedAt });
    await repository.settleTextExtraction({
      jobId,
      outcome: {
        status: 'ready',
        extractedText: '# 结构化标题',
        derivedStorageKey: `derived/text/${jobId}/abc.md`,
        checksum: 'b'.repeat(64),
        quality: 'structured',
        mimeType: 'text/markdown',
      },
      now: new Date('2026-07-26T08:02:00.000Z'),
    });

    /* 结构化表示以 Markdown MIME 与 structured 质量落库，可被阅读视图读回。 */
    await expect(
      getDatabase()
        .select({
          quality: schema.assetRepresentations.quality,
          mimeType: schema.assetRepresentations.mimeType,
          status: schema.assetRepresentations.status,
        })
        .from(schema.assetRepresentations)
        .where(
          sql`${schema.assetRepresentations.assetVersionId} = ${versionId} and ${schema.assetRepresentations.kind} = 'text'`,
        ),
    ).resolves.toEqual([
      { quality: 'structured', mimeType: 'text/markdown', status: 'ready' },
    ]);
  });

  it('音频转录从processing推进当前版本并生成安全派生表示', async () => {
    const repository = new DrizzleAssetRepository(getDatabase());
    const transcriptionRepository = new DrizzleAssetTranscriptionRepository(
      getDatabase(),
    );
    const created = await repository.createUploadedPending({
      ownerSubjectId,
      spaceId,
      scope: 'space',
      kind: 'audio',
      displayName: '课堂录音.wav',
      mimeType: 'audio/wav',
      byteSize: 128,
      contentHash: '8'.repeat(64),
      storageKey: 'uploads/fixture/lesson.wav',
    });

    expect(created.snapshot.descriptor).toMatchObject({
      kind: 'audio',
      status: 'processing',
      currentVersionId: null,
    });
    await expect(
      transcriptionRepository.beginAttempt({
        jobId: created.jobId,
        now: new Date('2026-07-27T10:00:00.000Z'),
      }),
    ).resolves.toEqual({
      storageKey: 'uploads/fixture/lesson.wav',
      mimeType: 'audio/wav',
      byteSize: 128,
      contentHash: '8'.repeat(64),
    });
    await expect(
      transcriptionRepository.settle({
        jobId: created.jobId,
        outcome: {
          status: 'ready',
          derivedStorageKey: `derived/transcription/${created.jobId}/abc.txt`,
          checksum: 'b'.repeat(64),
          transcriptionText: '今天学习一元二次方程。',
          transcriptionMetadata: {
            provider: 'openai-compatible',
            resolvedModelId: 'whisper-1',
            latencyMs: 123,
            traceId: `asset-transcription:${created.jobId}`,
            language: 'zh',
            durationSeconds: 30,
          },
        },
        now: new Date('2026-07-27T10:01:00.000Z'),
      }),
    ).resolves.toBe(true);
    await expect(
      transcriptionRepository.settle({
        jobId: created.jobId,
        outcome: { status: 'failed', failureCode: 'duplicate' },
      }),
    ).resolves.toBe(false);

    await expect(
      repository.getOwnedSnapshot({
        ownerSubjectId,
        spaceId,
        assetId: created.snapshot.descriptor.assetId,
      }),
    ).resolves.toMatchObject({
      descriptor: {
        status: 'ready',
        currentVersionId: created.versionId,
      },
      processing: {
        status: 'succeeded',
        attempts: 1,
        failureCode: null,
      },
    });
    await expect(
      repository.materializeOwnedReferences({
        ownerSubjectId,
        spaceId,
        references: [
          {
            assetId: created.snapshot.descriptor.assetId,
            versionId: created.versionId,
            kind: 'audio',
          },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        transcriptionText: '今天学习一元二次方程。',
      }),
    ]);
    await expect(
      getDatabase()
        .select()
        .from(schema.assetRepresentations)
        .where(
          sql`${schema.assetRepresentations.assetVersionId} = ${created.versionId}`,
        ),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: 'transcription',
        mimeType: 'text/plain',
        status: 'ready',
        derivedStorageKey: `derived/transcription/${created.jobId}/abc.txt`,
        checksum: 'b'.repeat(64),
        failureCode: null,
      }),
    ]);
  });

  it('视频部分成功推进当前版本，关键帧随Source删除进入Outbox', async () => {
    const repository = new DrizzleAssetRepository(getDatabase());
    const videoRepository = new DrizzleAssetVideoRepository(getDatabase());
    const created = await repository.createUploadedPending({
      ownerSubjectId,
      spaceId,
      scope: 'space',
      kind: 'video',
      displayName: '课堂录像.mp4',
      mimeType: 'video/mp4',
      byteSize: 1_024,
      contentHash: '7'.repeat(64),
      storageKey: 'uploads/fixture/lesson.mp4',
    });

    await expect(
      videoRepository.beginAttempt({ jobId: created.jobId }),
    ).resolves.toMatchObject({
      assetVersionId: created.versionId,
      mimeType: 'video/mp4',
      byteSize: 1_024,
    });
    await expect(
      videoRepository.settleProcessed({
        jobId: created.jobId,
        outcome: {
          durationSeconds: 120,
          width: 1280,
          height: 720,
          transcription: {
            status: 'ready',
            text: '视频中的课堂讲解。',
            derivedStorageKey: `derived/transcription/${created.jobId}/${'5'.repeat(64)}.txt`,
            checksum: '5'.repeat(64),
            metadata: {
              provider: 'fixture',
              resolvedModelId: 'transcription-v1',
              latencyMs: 100,
              traceId: `asset-video:${created.jobId}`,
              language: 'zh',
              durationSeconds: 120,
            },
          },
          keyframes: {
            status: 'ready',
            algorithmVersion: 'fixture-v1',
            frames: [
              {
                ordinal: 1,
                timestampSeconds: 30,
                storageKey: `assets/${created.versionId}/keyframes/frame.jpg`,
                checksum: '6'.repeat(64),
                byteSize: 256,
              },
            ],
          },
        },
      }),
    ).resolves.toBe(true);

    await getDatabase()
      .insert(schema.assetRepresentations)
      .values([
        {
          assetVersionId: created.versionId,
          kind: 'transcription',
          variant: 'default',
          producer: 'cloud',
          producerVersion: 'provider-a.v1',
          mimeType: 'text/plain',
          status: 'failed',
          /* ADR-0026 决定 6 形状约束：failed 状态要求 failed 质量。 */
          quality: 'failed',
          failureCode: 'cloud_failed',
        },
        {
          assetVersionId: created.versionId,
          kind: 'keyframes',
          variant: 'default',
          producer: 'cloud',
          producerVersion: 'provider-a.v1',
          mimeType: 'image/jpeg',
          status: 'failed',
          quality: 'failed',
          failureCode: 'cloud_failed',
        },
      ]);
    await expect(
      repository.loadOwnedCurrentStoredVersion({
        ownerSubjectId,
        spaceId,
        assetId: created.snapshot.descriptor.assetId,
      }),
    ).resolves.toMatchObject({
      derivedStatuses: expect.arrayContaining([
        { kind: 'transcription', status: 'ready' },
        { kind: 'keyframes', status: 'ready' },
      ]),
    });

    await expect(
      repository.getOwnedSnapshot({
        ownerSubjectId,
        spaceId,
        assetId: created.snapshot.descriptor.assetId,
      }),
    ).resolves.toMatchObject({
      descriptor: {
        kind: 'video',
        status: 'ready',
        currentVersionId: created.versionId,
      },
      processing: { status: 'succeeded' },
    });
    await expect(
      repository.materializeOwnedReferences({
        ownerSubjectId,
        spaceId,
        references: [
          {
            assetId: created.snapshot.descriptor.assetId,
            versionId: created.versionId,
            kind: 'video',
          },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        transcriptionText: '视频中的课堂讲解。',
      }),
    ]);

    await repository.tombstoneOwnedAsset({
      ownerSubjectId,
      spaceId,
      assetId: created.snapshot.descriptor.assetId,
    });
    await expect(
      getDatabase()
        .select()
        .from(schema.objectDeletionOutbox)
        .where(
          sql`${schema.objectDeletionOutbox.sourceType} = 'asset_video_keyframe'`,
        ),
    ).resolves.toEqual([
      expect.objectContaining({
        storageKey: `assets/${created.versionId}/keyframes/frame.jpg`,
        status: 'pending',
      }),
    ]);
  });

  it('派生预览只处理当前版本，重复结算幂等且删除进入Outbox', async () => {
    const assetsRepository = new DrizzleAssetRepository(getDatabase());
    const derivedRepository = new DrizzleAssetDerivedProcessingRepository(
      getDatabase(),
    );
    const created = await assetsRepository.createUploaded(readyPdf());
    const [job] = await getDatabase()
      .select()
      .from(schema.assetProcessingJobs)
      .where(sql`${schema.assetProcessingJobs.kind} = 'render_preview'`);
    expect(job).toBeDefined();

    await getDatabase()
      .insert(schema.assetRepresentations)
      .values({
        assetVersionId: job!.assetVersionId,
        kind: 'preview',
        variant: 'default',
        producer: 'cloud',
        producerVersion: 'renderer.v2',
        mimeType: 'text/html',
        status: 'ready',
        derivedStorageKey: 'derived/preview/cloud/fixture.html',
        checksum: 'a'.repeat(64),
        byteSize: 64,
      });

    await expect(
      derivedRepository.beginPreviewRenderAttempt({
        jobId: job!.id,
        now: new Date('2026-07-27T08:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      storageKey: 'uploads/fixture/vision.pdf',
      mimeType: 'application/pdf',
      byteSize: 256,
      contentHash: 'c'.repeat(64),
    });
    await expect(
      derivedRepository.settlePreviewRender({
        jobId: job!.id,
        outcome: {
          status: 'ready',
          derivedStorageKey: `derived/preview/${job!.id}/fixture.html`,
          checksum: 'f'.repeat(64),
          byteSize: 128,
        },
        now: new Date('2026-07-27T08:01:00.000Z'),
      }),
    ).resolves.toBe(true);
    await expect(
      getDatabase()
        .select({
          producer: schema.assetRepresentations.producer,
          derivedStorageKey: schema.assetRepresentations.derivedStorageKey,
        })
        .from(schema.assetRepresentations)
        .where(
          sql`${schema.assetRepresentations.assetVersionId} = ${job!.assetVersionId} and ${schema.assetRepresentations.kind} = 'preview'`,
        )
        .orderBy(schema.assetRepresentations.producer),
    ).resolves.toEqual([
      {
        producer: 'cloud',
        derivedStorageKey: 'derived/preview/cloud/fixture.html',
      },
      {
        producer: 'default',
        derivedStorageKey: `derived/preview/${job!.id}/fixture.html`,
      },
    ]);
    await expect(
      derivedRepository.settlePreviewRender({
        jobId: job!.id,
        outcome: {
          status: 'ready',
          derivedStorageKey: `derived/preview/${job!.id}/fixture.html`,
          checksum: 'f'.repeat(64),
          byteSize: 128,
        },
      }),
    ).resolves.toBe(false);
    await expect(
      derivedRepository.settleThumbnailGeneration({
        jobId: job!.id,
        outcome: { status: 'failed', failureCode: 'wrong_kind' },
      }),
    ).resolves.toBe(false);

    await assetsRepository.tombstoneOwnedAsset({
      ownerSubjectId,
      spaceId,
      assetId: created.descriptor.assetId,
    });
    await expect(
      getDatabase()
        .select()
        .from(schema.objectDeletionOutbox)
        .orderBy(schema.objectDeletionOutbox.sourceType),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'asset_representation',
          storageKey: `derived/preview/${job!.id}/fixture.html`,
          status: 'pending',
        }),
      ]),
    );
  });

  it('图片创建缩略图任务，资产失效后旧版本任务取消', async () => {
    expect(getDerivedAssetJobKind('image/png')).toBe('generate_thumbnail');
    const assetsRepository = new DrizzleAssetRepository(getDatabase());
    const derivedRepository = new DrizzleAssetDerivedProcessingRepository(
      getDatabase(),
    );
    const created = await assetsRepository.createUploaded(
      readyPdf({
        kind: 'image',
        displayName: 'diagram.png',
        mimeType: 'image/png',
        contentHash: '9'.repeat(64),
        storageKey: 'uploads/fixture/diagram.png',
        extractedText: null,
      }),
    );
    const [job] = await getDatabase()
      .select()
      .from(schema.assetProcessingJobs)
      .where(sql`${schema.assetProcessingJobs.kind} = 'generate_thumbnail'`);
    expect(job).toBeDefined();

    await assetsRepository.tombstoneOwnedAsset({
      ownerSubjectId,
      spaceId,
      assetId: created.descriptor.assetId,
    });
    await expect(
      derivedRepository.beginThumbnailGenerationAttempt({ jobId: job!.id }),
    ).resolves.toBeNull();
    await expect(
      getDatabase()
        .select({ status: schema.assetProcessingJobs.status })
        .from(schema.assetProcessingJobs)
        .where(sql`${schema.assetProcessingJobs.id} = ${job!.id}`),
    ).resolves.toEqual([{ status: 'cancelled' }]);
  });

  it('对象存储键只经服务端所有权方法返回且跨主体拒绝', async () => {
    const repository = new DrizzleAssetRepository(getDatabase());
    const created = await repository.createUploaded(readyPdf());

    await expect(
      repository.getOwnedSnapshot({
        ownerSubjectId,
        spaceId,
        assetId: created.descriptor.assetId,
      }),
    ).resolves.toMatchObject({
      descriptor: { assetId: created.descriptor.assetId, status: 'ready' },
      version: { versionId: created.version!.versionId },
    });
    await expect(
      repository.loadOwnedCurrentStoredVersion({
        ownerSubjectId,
        spaceId,
        assetId: created.descriptor.assetId,
      }),
    ).resolves.toMatchObject({
      assetId: created.descriptor.assetId,
      storageKey: 'uploads/fixture/vision.pdf',
      extractedText: '图像分类模型会从像素中提取可比较的特征。',
    });
    await expect(
      repository.loadOwnedCurrentStoredVersion({
        ownerSubjectId: otherSubjectId,
        spaceId,
        assetId: created.descriptor.assetId,
      }),
    ).rejects.toBeInstanceOf(AssetAccessError);
    await expect(
      repository.getOwnedSnapshot({
        ownerSubjectId: otherSubjectId,
        spaceId,
        assetId: created.descriptor.assetId,
      }),
    ).rejects.toBeInstanceOf(AssetAccessError);
    await expect(
      repository.getOwnedSnapshot({
        ownerSubjectId,
        spaceId: otherSpaceId,
        assetId: created.descriptor.assetId,
      }),
    ).rejects.toBeInstanceOf(AssetAccessError);
    expect(JSON.stringify(created)).not.toContain('uploads/fixture');
  });

  it('软删除只影响本主体资产并从公开列表隐藏', async () => {
    const repository = new DrizzleAssetRepository(getDatabase());
    const created = await repository.createUploaded(readyPdf());

    await expect(
      repository.tombstoneOwnedAsset({
        ownerSubjectId: otherSubjectId,
        spaceId,
        assetId: created.descriptor.assetId,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.tombstoneOwnedAsset({
        ownerSubjectId,
        spaceId,
        assetId: created.descriptor.assetId,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.listOwnedSpace({ ownerSubjectId, spaceId }),
    ).resolves.toEqual([]);
    await expect(
      repository.loadOwnedCurrentStoredVersion({
        ownerSubjectId,
        spaceId,
        assetId: created.descriptor.assetId,
      }),
    ).rejects.toBeInstanceOf(AssetAccessError);
    await expect(
      getDatabase().select().from(schema.objectDeletionOutbox),
    ).resolves.toMatchObject([
      {
        objectKind: 'asset',
        sourceType: 'asset_version',
        storageKey: 'uploads/fixture/vision.pdf',
        status: 'pending',
      },
    ]);
  });

  it('消息账本原子保存文本与资产引用并可从历史恢复', async () => {
    const repository = new DrizzleAssetRepository(getDatabase());
    const created = await repository.createUploaded(readyPdf());
    await getDatabase().insert(schema.lessonSessions).values({
      id: spaceId,
      studentId: ownerSubjectId,
      gradeBand: 'middle_school',
      courseSlug: 'generic-space',
      knowledgeNodeId: 'generic-node',
      state: 'EXPLAIN',
    });
    const parts = [
      { type: 'text' as const, text: '结合资料解释' },
      {
        type: 'asset_ref' as const,
        reference: {
          assetId: created.descriptor.assetId,
          versionId: created.version!.versionId,
          kind: 'document' as const,
        },
        usage: 'attachment' as const,
      },
    ];
    const ledger = await new DrizzleTeachingTurnLedger(
      getDatabase(),
    ).beginOrReplay({
      sessionId: spaceId,
      trustedStudentId: ownerSubjectId,
      clientMessageId: 'asset-message-1',
      parts,
      traceId: 'trace-asset-message-1',
      modelAlias: 'primary',
      promptVersion: 'turn-v1',
      promptHash: 'a'.repeat(64),
      provider: 'fixture',
    });
    const turn = ledger.turn;
    const chat = new DrizzleChatRepository(getDatabase());
    expect(turn.studentMessage.parts).toEqual(parts);
    const history = await chat.listHistory({
      sessionId: spaceId,
      trustedStudentId: ownerSubjectId,
    });
    expect(
      history.messages.find((message) => message.role === 'student')?.parts,
    ).toEqual(parts);
  });

  it('tombstone 写入的资产 outbox 行并发 claim 只有一个 worker 领取', async () => {
    const repository = new DrizzleAssetRepository(getDatabase());
    const created = await repository.createUploaded(readyPdf());
    await repository.tombstoneOwnedAsset({
      ownerSubjectId,
      spaceId,
      assetId: created.descriptor.assetId,
    });

    const workerA = new DrizzleObjectDeletionOutboxRepository(getDatabase());
    const workerB = new DrizzleObjectDeletionOutboxRepository(getDatabase());
    const [claimsA, claimsB] = await Promise.all([
      workerA.claimBatch({ limit: 10 }),
      workerB.claimBatch({ limit: 10 }),
    ]);
    const key = 'uploads/fixture/vision.pdf';
    const aHas = claimsA.some((c) => c.storageKey === key);
    const bHas = claimsB.some((c) => c.storageKey === key);
    expect(aHas !== bHas).toBe(true);
  });

  it('资产 outbox 行租约过期前不被抢占，过期后恢复且旧 attempt 失效', async () => {
    const repository = new DrizzleAssetRepository(getDatabase());
    const created = await repository.createUploaded(readyPdf());
    await repository.tombstoneOwnedAsset({
      ownerSubjectId,
      spaceId,
      assetId: created.descriptor.assetId,
    });

    const repo = new DrizzleObjectDeletionOutboxRepository(getDatabase());
    const now = new Date();
    /* worker A 领取并开始处理（模拟正在删除）。 */
    const first = await repo.claimBatch({ limit: 10, now });
    const claim = first.find(
      (c) => c.storageKey === 'uploads/fixture/vision.pdf',
    );
    expect(claim).toBeDefined();
    expect(claim!.attempt).toBe(1);

    /* worker B 在租约未过期时领取不到该行。 */
    const recent = new Date(now.getTime() + 30_000);
    const second = await repo.claimBatch({ limit: 10, now: recent });
    expect(
      second.some((c) => c.storageKey === 'uploads/fixture/vision.pdf'),
    ).toBe(false);

    /* 租约过期后 worker B 可恢复领取，attempt 递增防旧 worker 重入。 */
    const expired = new Date(
      now.getTime() + OBJECT_DELETION_LEASE_TIMEOUT_MS + 60_000,
    );
    const third = await repo.claimBatch({ limit: 10, now: expired });
    const recovered = third.find(
      (c) => c.storageKey === 'uploads/fixture/vision.pdf',
    );
    expect(recovered).toBeDefined();
    expect(recovered!.attempt).toBe(2);

    /* 旧 worker（attempt 1）不能推进已被重新领取的行。 */
    await repo.complete(claim!.id, claim!.attempt);
    const [row] = await getDatabase()
      .select({ status: schema.objectDeletionOutbox.status })
      .from(schema.objectDeletionOutbox)
      .where(eq(schema.objectDeletionOutbox.id, claim!.id));
    expect(row?.status).toBe('processing');
  });
});
