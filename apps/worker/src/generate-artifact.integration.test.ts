/* worker 任务处理器默认经 getDb() 连接 DATABASE_URL;集成测试统一指到隔离库。 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import {
  audioOverviewMetadataSchema,
  generatedImageMetadataSchema,
  mindMapContentSchema,
} from '@educanvas/canvas-protocol';
import {
  ARTIFACT_GENERATE_TASK,
  ArtifactOwnershipError,
  ArtifactRevisionConflictError,
  DrizzleAssetRepository,
  DrizzlePlatformArtifactRepository,
  spaces,
  conversations,
  notebookMemberships,
  platformUsers,
  artifactVersions,
} from '@educanvas/db';
import { getDb } from '@educanvas/db/testing';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { runOnce } from 'graphile-worker';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTaskList } from './tasks/index.js';

const connectionString = process.env.TEST_DATABASE_URL!;
/* 最小合法 PNG 容器头 + 填充；Adapter 只按魔术字节判定 MIME，不看供应商声明。 */
const PNG_FIXTURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const taskList = createTaskList({
  continuationTrace: {
    run(_input, callback) {
      return callback();
    },
  },
});

describe('产物生成后端全链路(创建→原子入队→worker 消费→版本落库)', () => {
  const database = getDb();
  const repository = new DrizzlePlatformArtifactRepository();
  const owner = 'subject-artifact-chain';
  let spaceId = '';
  let conversationId = '';
  let providerServer: Server | null = null;
  let providerBaseUrl = '';
  let objectStorageRoot: string | null = null;
  let speechCalls = 0;
  let imageCalls = 0;
  let imageGenerationDelayMs = 0;

  beforeAll(async () => {
    await migrate(database, {
      migrationsFolder: fileURLToPath(
        new URL('../../../packages/db/drizzle', import.meta.url),
      ),
    });
    /* 首次 runOnce 触发 graphile 自迁移 */
    await runOnce({ connectionString, taskList: { noop: async () => {} } });
    objectStorageRoot = await mkdtemp(
      path.join(tmpdir(), 'educanvas-audio-artifact-'),
    );
    process.env.OBJECT_STORAGE_ROOT = objectStorageRoot;
    providerServer = createServer((request, response) => {
      const handle = async () => {
        if (request.url === '/v1/chat/completions') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              id: 'script-response-1',
              model: 'structured-fixture',
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    content: JSON.stringify({
                      script:
                        '欢迎收听来源概览。神经网络由多层神经元组成，训练通过误差更新权重。请回到原始资料核对。',
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 20, completion_tokens: 15 },
            }),
          );
          return;
        }
        if (request.url === '/v1/audio/speech') {
          speechCalls += 1;
          const bytes = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0]);
          response.writeHead(200, {
            'content-type': 'audio/mpeg',
            'content-length': String(bytes.byteLength),
            'x-request-id': `speech-${speechCalls}`,
          });
          response.end(bytes);
          return;
        }
        if (request.url === '/v1/images/generations') {
          imageCalls += 1;
          if (imageGenerationDelayMs > 0) {
            await new Promise<void>((resolve) =>
              setTimeout(resolve, imageGenerationDelayMs),
            );
          }
          response.writeHead(200, {
            'content-type': 'application/json',
            'x-request-id': `image-${imageCalls}`,
          });
          response.end(
            JSON.stringify({
              data: [{ b64_json: PNG_FIXTURE.toString('base64') }],
            }),
          );
          return;
        }
        response.writeHead(404).end();
      };

      void handle().catch(() => {
        if (!response.writableEnded) {
          response.writeHead(500).end('provider error');
        }
      });
    });
    await new Promise<void>((resolve) => {
      if (!providerServer) {
        throw new Error('fixture provider 初始化失败');
      }
      providerServer.listen(0, '127.0.0.1', resolve);
    });
    if (!providerServer) {
      throw new Error('fixture provider 初始化失败');
    }
    const address = providerServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('fixture provider 未监听 TCP 端口');
    }
    providerBaseUrl = `http://127.0.0.1:${address.port}/v1`;
  });

  beforeEach(async () => {
    await database.execute(
      sql`truncate table artifact_versions, artifact_generation_jobs, artifacts, asset_versions, assets, conversations, spaces restart identity cascade`,
    );
    await database.execute(sql`delete from graphile_worker._private_jobs`);
    await database
      .insert(platformUsers)
      .values({ id: owner, kind: 'registered', status: 'active' })
      .onConflictDoNothing();
    const [space] = await database
      .insert(spaces)
      .values({ ownerSubjectId: owner, title: '链路测试空间' })
      .returning();
    spaceId = space!.id;
    await database.insert(notebookMemberships).values({
      notebookId: spaceId,
      userId: owner,
      role: 'owner',
      grantedByUserId: owner,
    });
    const [conversation] = await database
      .insert(conversations)
      .values({ spaceId, ownerSubjectId: owner })
      .returning();
    conversationId = conversation!.id;
    process.env.MODEL_GATEWAY_PROVIDER = '';
    process.env.MODEL_GATEWAY_API_KEY = '';
    speechCalls = 0;
    imageCalls = 0;
    imageGenerationDelayMs = 0;
  });

  afterAll(async () => {
    if (providerServer) {
      await new Promise<void>((resolve, reject) =>
        providerServer!.close((error) => (error ? reject(error) : resolve())),
      );
    }
    if (objectStorageRoot) {
      await rm(objectStorageRoot, { recursive: true, force: true });
    }
    delete process.env.OBJECT_STORAGE_ROOT;
  });

  const enableFixtureProvider = () => {
    process.env.EDUCANVAS_DEPLOYMENT_ENV = 'test';
    process.env.MODEL_GATEWAY_PROVIDER = 'openai-compatible';
    process.env.MODEL_GATEWAY_BASE_URL = providerBaseUrl;
    process.env.MODEL_GATEWAY_API_KEY = 'fixture-key';
    process.env.MODEL_GATEWAY_PRIMARY_MODEL = 'primary-fixture';
    process.env.MODEL_GATEWAY_STRUCTURED_MODEL = 'structured-fixture';
    process.env.MODEL_GATEWAY_SPEECH_MODEL = 'speech-fixture';
    process.env.MODEL_GATEWAY_SPEECH_VOICE = 'alloy';
    process.env.MODEL_GATEWAY_IMAGE_MODEL = 'image-fixture';
  };

  const createReadyDocumentSource = async () => {
    const source = await new DrizzleAssetRepository().createUploaded({
      ownerSubjectId: owner,
      spaceId,
      scope: 'space',
      kind: 'document',
      displayName: '神经网络讲义.pdf',
      mimeType: 'application/pdf',
      byteSize: 64,
      contentHash: 'a'.repeat(64),
      storageKey: `integration/${spaceId}/source.pdf`,
      extractedText: '神经网络由多层神经元组成，训练通过误差更新权重。',
      outcome: { status: 'ready' },
    });
    return {
      assetId: source.descriptor.assetId,
      versionId: source.version!.versionId,
      kind: 'document' as const,
    };
  };

  const countVersions = async (artifactId: string) => {
    const rows = await database
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId));
    return rows.length;
  };

  it('产物/账本/队列三行同事务落库,runOnce 消费后版本 v1 通过公开 Schema', async () => {
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'mind_map',
      trustTier: 'tier1',
      title: '本课思维导图',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
    });
    expect(created.artifact.status).toBe('proposed');
    expect(created.job.status).toBe('queued');

    const queueRows = await database.execute(
      sql`select count(*)::int as count from graphile_worker.jobs where task_identifier = ${ARTIFACT_GENERATE_TASK}`,
    );
    expect(queueRows[0]).toMatchObject({ count: 1 });

    await runOnce({ connectionString, taskList });

    const detail = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(detail.artifact.status).toBe('active');
    expect(detail.artifact.latestVersion).toBe(1);
    expect(detail.latestJob?.status).toBe('succeeded');
    const parsed = mindMapContentSchema.safeParse(
      detail.latestVersion?.content,
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.root.label : null).toBe('本课思维导图');
  });

  it('Canvas 修改在同一Artifact上追加v2，并拒绝并发任务与过期基线', async () => {
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'mind_map',
      trustTier: 'tier1',
      title: '可迭代导图',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
    });
    await runOnce({ connectionString, taskList });

    await expect(
      repository.createRevisionGenerationJob({
        artifactId: created.artifact.id,
        conversationId: '00000000-0000-4000-8000-000000000001',
        trustedSubjectId: owner,
        baseVersion: 1,
        instruction: '尝试从另一个对话修改',
        taskIdentifier: ARTIFACT_GENERATE_TASK,
      }),
    ).rejects.toBeInstanceOf(ArtifactOwnershipError);

    const revision = await repository.createRevisionGenerationJob({
      artifactId: created.artifact.id,
      conversationId,
      trustedSubjectId: owner,
      baseVersion: 1,
      instruction: '增加一个关于卷积层的分支',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
    });
    expect(revision.job).toMatchObject({
      status: 'queued',
      params: {
        revision: {
          baseVersion: 1,
          instruction: '增加一个关于卷积层的分支',
        },
      },
    });
    await expect(
      repository.createRevisionGenerationJob({
        artifactId: created.artifact.id,
        conversationId,
        trustedSubjectId: owner,
        baseVersion: 1,
        instruction: '并发修改',
        taskIdentifier: ARTIFACT_GENERATE_TASK,
      }),
    ).rejects.toMatchObject({ reason: 'job_in_progress' });

    await runOnce({ connectionString, taskList });
    const detail = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(detail.artifact.latestVersion).toBe(2);
    expect(detail.latestJob?.status).toBe('succeeded');
    const parsed = mindMapContentSchema.parse(detail.latestVersion?.content);
    expect(parsed.root.children).toContainEqual(
      expect.objectContaining({ label: '修改：增加一个关于卷积层的分支' }),
    );
    await expect(
      repository.createRevisionGenerationJob({
        artifactId: created.artifact.id,
        conversationId,
        trustedSubjectId: owner,
        baseVersion: 1,
        instruction: '基于旧版继续修改',
        taskIdentifier: ARTIFACT_GENERATE_TASK,
      }),
    ).rejects.toBeInstanceOf(ArtifactRevisionConflictError);
    await expect(
      repository.listVersions({
        artifactId: created.artifact.id,
        trustedSubjectId: owner,
      }),
    ).resolves.toMatchObject([{ version: 2 }, { version: 1 }]);
  });

  it('不支持的产物类型以 failed+unsupported_kind 记账,不产生版本', async () => {
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'story_book',
      trustTier: 'tier1',
      title: '未支持类型',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
    });

    await runOnce({ connectionString, taskList });

    const detail = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(detail.latestJob?.status).toBe('failed');
    expect(detail.latestJob?.failureCode).toBe('unsupported_kind');
    expect(detail.artifact.latestVersion).toBe(0);
    expect(detail.latestVersion).toBeNull();
  });

  it('勾选来源→脚本→TTS→对象存储→音频版本完整落库', async () => {
    enableFixtureProvider();
    const source = await createReadyDocumentSource();
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'audio_overview',
      trustTier: 'tier2',
      title: '神经网络音频概览',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params: { selectedSources: [source] },
    });

    await runOnce({ connectionString, taskList });

    const detail = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(detail.latestJob?.status).toBe('succeeded');
    expect(detail.artifact).toMatchObject({
      status: 'active',
      latestVersion: 1,
      trustTier: 'tier2',
    });
    expect(detail.latestVersion?.content).toBeNull();
    expect(detail.latestVersion?.objectKey).toContain(created.job.id);
    expect(detail.latestVersion?.checksum).toMatch(/^[a-f0-9]{64}$/);
    const metadata = audioOverviewMetadataSchema.parse(
      detail.latestVersion?.metadata,
    );
    expect(metadata).toMatchObject({
      contentType: 'audio/mpeg',
      sourceCount: 1,
      speech: { resolvedModelId: 'speech-fixture', voice: 'alloy' },
    });
    expect(metadata.transcript).toContain('神经网络');
    expect(speechCalls).toBe(1);
    const stored = await new LocalObjectStorage().readVerified(
      detail.latestVersion!.objectKey!,
      detail.latestVersion!.checksum!,
    );
    expect(stored.byteLength).toBe(metadata.byteSize);
  });

  it('checkpoint 后中断重投只提交版本，不再次调用 TTS', async () => {
    enableFixtureProvider();
    const source = await createReadyDocumentSource();
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'audio_overview',
      trustTier: 'tier2',
      title: '恢复测试音频',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params: { selectedSources: [source] },
    });
    await repository.transitionGenerationJob({
      jobId: created.job.id,
      trustedSubjectId: owner,
      to: 'running',
      progress: 5,
    });
    const stored = await new LocalObjectStorage().put({
      key: `artifacts/${created.artifact.id}/jobs/${created.job.id}/overview.mp3`,
      bytes: new Uint8Array([0x49, 0x44, 0x33, 9]),
      contentType: 'audio/mpeg',
    });
    const metadata = audioOverviewMetadataSchema.parse({
      contentVersion: 1,
      contentType: 'audio/mpeg',
      byteSize: stored.sizeBytes,
      transcript: '这是中断前已经完成的音频文字稿。',
      sourceCount: 1,
      script: {
        generator: 'fixture:checkpoint',
        provider: null,
        resolvedModelId: null,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      },
      speech: {
        provider: 'fixture',
        resolvedModelId: 'speech-fixture',
        voice: 'alloy',
        inputCharacters: 18,
        latencyMs: 1,
      },
    });
    await repository.updateGenerationJobCheckpoint({
      jobId: created.job.id,
      trustedSubjectId: owner,
      checkpoint: {
        kind: 'audio_overview',
        objectKey: stored.key,
        checksum: stored.checksum,
        metadata,
      },
    });

    await runOnce({ connectionString, taskList });

    const detail = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(detail.latestJob?.status).toBe('succeeded');
    expect(detail.artifact.latestVersion).toBe(1);
    expect(detail.latestVersion?.checksum).toBe(stored.checksum);
    expect(speechCalls).toBe(0);
    expect(await countVersions(created.artifact.id)).toBe(1);
  });

  it('版本已落库但 job 仍运行时重投直接收敛,不重复计费且不新增版本', async () => {
    enableFixtureProvider();
    const source = await createReadyDocumentSource();
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'audio_overview',
      trustTier: 'tier2',
      title: '恢复路径验证音频',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params: { selectedSources: [source] },
    });

    await repository.transitionGenerationJob({
      jobId: created.job.id,
      trustedSubjectId: owner,
      to: 'running',
      progress: 5,
    });

    const recovered = await new LocalObjectStorage().put({
      key: `artifacts/${created.artifact.id}/jobs/${created.job.id}/overview.mp3`,
      bytes: new Uint8Array([0x49, 0x44, 0x33, 4, 0]),
      contentType: 'audio/mpeg',
    });
    await repository.appendVersion({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
      objectKey: recovered.key,
      checksum: recovered.checksum,
      metadata: {
        contentVersion: 1,
        contentType: 'audio/mpeg',
        byteSize: recovered.sizeBytes,
        transcript: '既有 checkpoint 对应内容',
        sourceCount: 1,
        script: {
          generator: 'fixture:recovery',
          provider: 'fixture',
          resolvedModelId: null,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
        },
        speech: {
          provider: 'fixture',
          resolvedModelId: 'speech-fixture',
          voice: 'alloy',
          inputCharacters: 8,
          latencyMs: 1,
        },
      },
      generatedBy: 'model:speech.generate:audio-overview-v1',
      generationJobId: created.job.id,
    });

    await runOnce({ connectionString, taskList });

    const detail = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(detail.latestJob?.status).toBe('succeeded');
    expect(detail.artifact.latestVersion).toBe(1);
    expect(await countVersions(created.artifact.id)).toBe(1);
    expect(speechCalls).toBe(0);
  });

  it('图像生成→魔术字节复核→对象存储→tier2 版本完整落库', async () => {
    enableFixtureProvider();
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'generated_image',
      trustTier: 'tier2',
      title: '光合作用示意图',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params: {
        image: { prompt: '一张展示光合作用过程的示意图', size: '1024x1024' },
      },
    });

    await runOnce({ connectionString, taskList });

    const detail = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(detail.latestJob?.status).toBe('succeeded');
    expect(detail.artifact).toMatchObject({
      status: 'active',
      latestVersion: 1,
      trustTier: 'tier2',
    });
    expect(detail.latestVersion?.content).toBeNull();
    expect(detail.latestVersion?.objectKey).toContain(created.job.id);
    expect(detail.latestVersion?.checksum).toMatch(/^[a-f0-9]{64}$/);
    const metadata = generatedImageMetadataSchema.parse(
      detail.latestVersion?.metadata,
    );
    expect(metadata).toMatchObject({
      contentType: 'image/png',
      size: '1024x1024',
      byteSize: PNG_FIXTURE.byteLength,
      image: { resolvedModelId: 'image-fixture' },
    });
    /* 公开元数据不得携带对象键、Prompt 全文或 Provider 响应体。 */
    expect(JSON.stringify(metadata)).not.toContain(
      detail.latestVersion!.objectKey!,
    );
    expect(imageCalls).toBe(1);
    const stored = await new LocalObjectStorage().readVerified(
      detail.latestVersion!.objectKey!,
      detail.latestVersion!.checksum!,
    );
    expect(stored.byteLength).toBe(metadata.byteSize);
  });

  it('未配置图像模型时以 image_not_configured 记账,不产生版本', async () => {
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'generated_image',
      trustTier: 'tier2',
      title: '无网关图像',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params: { image: { prompt: '画一张电路图', size: '512x512' } },
    });

    await runOnce({ connectionString, taskList });

    const detail = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(detail.latestJob?.status).toBe('failed');
    expect(detail.latestJob?.failureCode).toBe('image_not_configured');
    expect(detail.artifact.latestVersion).toBe(0);
    expect(imageCalls).toBe(0);
  });

  it('图像 checkpoint 后重投只提交版本，不再次调用生成接口', async () => {
    enableFixtureProvider();
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'generated_image',
      trustTier: 'tier2',
      title: '恢复测试图像',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params: { image: { prompt: '画一张电路图', size: '512x512' } },
    });
    await repository.transitionGenerationJob({
      jobId: created.job.id,
      trustedSubjectId: owner,
      to: 'running',
      progress: 5,
    });
    const stored = await new LocalObjectStorage().put({
      key: `artifacts/${created.artifact.id}/jobs/${created.job.id}/image.png`,
      bytes: new Uint8Array(PNG_FIXTURE),
      contentType: 'image/png',
    });
    await repository.updateGenerationJobCheckpoint({
      jobId: created.job.id,
      trustedSubjectId: owner,
      checkpoint: {
        kind: 'generated_image',
        objectKey: stored.key,
        checksum: stored.checksum,
        metadata: generatedImageMetadataSchema.parse({
          contentVersion: 1,
          contentType: 'image/png',
          byteSize: stored.sizeBytes,
          size: '512x512',
          image: {
            provider: 'fixture',
            resolvedModelId: 'image-fixture',
            latencyMs: 1,
          },
        }),
      },
    });

    await runOnce({ connectionString, taskList });

    const detail = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(detail.latestJob?.status).toBe('succeeded');
    expect(detail.artifact.latestVersion).toBe(1);
    expect(detail.latestVersion?.checksum).toBe(stored.checksum);
    expect(imageCalls).toBe(0);
    expect(await countVersions(created.artifact.id)).toBe(1);
  });

  it('queued 任务取消后不会触发 Provider 调用', async () => {
    enableFixtureProvider();
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'generated_image',
      trustTier: 'tier2',
      title: 'queued 已取消',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params: { image: { prompt: '不会执行的图像', size: '1024x1024' } },
    });
    await repository.transitionGenerationJob({
      jobId: created.job.id,
      trustedSubjectId: owner,
      to: 'cancelled',
    });

    await runOnce({ connectionString, taskList });

    const detail = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(detail.latestJob?.status).toBe('cancelled');
    expect(await countVersions(created.artifact.id)).toBe(0);
    expect(imageCalls).toBe(0);
  });

  it('running 与 cancel 竞争只能收敛到单一终态，不会出现 succeeded', async () => {
    enableFixtureProvider();
    imageGenerationDelayMs = 120;
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'generated_image',
      trustTier: 'tier2',
      title: 'running 竞争 cancel',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params: { image: { prompt: '并发取消', size: '1024x1024' } },
    });

    const runTask = runOnce({ connectionString, taskList });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await repository.transitionGenerationJob({
      jobId: created.job.id,
      trustedSubjectId: owner,
      to: 'cancelled',
      progress: null,
    });
    await expect(runTask).resolves.toBeUndefined();

    const detail = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(detail.latestJob?.status).toBe('cancelled');
    expect(detail.latestJob?.failureCode).toBeNull();
    expect(detail.latestJob?.status).not.toBe('succeeded');
    expect(await countVersions(created.artifact.id)).toBe(0);

    imageGenerationDelayMs = 0;
  });

  it('终态任务再次投递保持幂等，不新增版本且不重复Provider调用', async () => {
    enableFixtureProvider();
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'generated_image',
      trustTier: 'tier2',
      title: '成功终态重投幂等',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params: { image: { prompt: '测试幂等终态', size: '1024x1024' } },
    });

    await runOnce({ connectionString, taskList });

    const first = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(first.latestJob?.status).toBe('succeeded');
    expect(await countVersions(created.artifact.id)).toBe(1);
    expect(imageCalls).toBe(1);

    await runOnce({ connectionString, taskList });

    const second = await repository.getArtifactDetail({
      artifactId: created.artifact.id,
      trustedSubjectId: owner,
    });
    expect(second.latestJob?.status).toBe('succeeded');
    expect(await countVersions(created.artifact.id)).toBe(1);
    expect(imageCalls).toBe(1);
  });

  it('failed/cancelled 终态重复投递不新增版本', async () => {
    const unsupported = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'story_book',
      trustTier: 'tier1',
      title: '失败重投幂等',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
    });

    await runOnce({ connectionString, taskList });
    const first = await repository.getArtifactDetail({
      artifactId: unsupported.artifact.id,
      trustedSubjectId: owner,
    });
    expect(first.latestJob?.status).toBe('failed');
    expect(first.artifact.latestVersion).toBe(0);
    expect(
      await repository.listVersions({
        artifactId: unsupported.artifact.id,
        trustedSubjectId: owner,
      }),
    ).toHaveLength(0);

    await runOnce({ connectionString, taskList });
    const second = await repository.getArtifactDetail({
      artifactId: unsupported.artifact.id,
      trustedSubjectId: owner,
    });
    expect(second.latestJob?.status).toBe('failed');
    expect(
      await repository.listVersions({
        artifactId: unsupported.artifact.id,
        trustedSubjectId: owner,
      }),
    ).toHaveLength(0);

    const cancelled = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'generated_image',
      trustTier: 'tier2',
      title: '取消重投',
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params: { image: { prompt: '不会执行', size: '1024x1024' } },
    });
    await repository.transitionGenerationJob({
      jobId: cancelled.job.id,
      trustedSubjectId: owner,
      to: 'cancelled',
    });
    await runOnce({ connectionString, taskList });
    const cancelledDetail = await repository.getArtifactDetail({
      artifactId: cancelled.artifact.id,
      trustedSubjectId: owner,
    });
    expect(cancelledDetail.latestJob?.status).toBe('cancelled');
    expect(
      await repository.listVersions({
        artifactId: cancelled.artifact.id,
        trustedSubjectId: owner,
      }),
    ).toHaveLength(0);

    await runOnce({ connectionString, taskList });
    expect(
      await repository.listVersions({
        artifactId: cancelled.artifact.id,
        trustedSubjectId: owner,
      }),
    ).toHaveLength(0);
  });
});
