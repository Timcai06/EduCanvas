import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ArtifactJobLifecycleError,
  ArtifactIdempotencyConflictError,
  ArtifactOwnershipError,
  DrizzlePlatformArtifactRepository,
} from './platform-artifact-repository';
import { DrizzleManualArtifactRepository } from './manual-artifact-repository';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error(
      '集成测试数据库名必须以_integration或_test结尾，拒绝清空非测试数据库',
    );
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();

const expectConstraint = async (
  promise: Promise<unknown>,
  constraintName: string,
) => {
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    const err = error as Error & { cause?: Error };
    const text = `${err.message} ${err.cause?.message ?? ''}`;
    return text.includes(constraintName);
  });
};

const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 10 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

describeWithDatabase('平台 Artifact 仓储', () => {
  const repository = new DrizzlePlatformArtifactRepository(
    database as NonNullable<typeof database>,
  );
  const manualRepository = new DrizzleManualArtifactRepository(
    database as NonNullable<typeof database>,
  );
  const owner = 'subject-owner-1';
  const stranger = 'subject-stranger-1';
  let spaceId = '';

  beforeAll(async () => {
    await migrate(database!, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await database!.execute(
      sql`truncate table object_deletion_outbox, artifact_versions, artifact_generation_jobs, artifacts, notebook_memberships, spaces, personal_agents, platform_users restart identity cascade`,
    );
    await database!.insert(schema.platformUsers).values([
      { id: owner, kind: 'registered', status: 'active' },
      { id: stranger, kind: 'registered', status: 'active' },
    ]);
    const [space] = await database!
      .insert(schema.spaces)
      .values({ ownerSubjectId: owner, title: '测试空间' })
      .returning();
    spaceId = space!.id;
    await database!.insert(schema.notebookMemberships).values({
      notebookId: spaceId,
      userId: owner,
      role: 'owner',
      grantedByUserId: owner,
    });
  });

  afterAll(async () => {
    await connection?.end();
  });

  const createArtifact = () =>
    repository.createArtifact({
      spaceId,
      trustedSubjectId: owner,
      kind: 'mind_map',
      trustTier: 'tier1',
      title: '思维导图',
    });

  it('创建产物要求主体拥有 Space,越权与不存在同错', async () => {
    await expect(
      repository.createArtifact({
        spaceId,
        trustedSubjectId: stranger,
        kind: 'mind_map',
        trustTier: 'tier2',
        title: '越权产物',
      }),
    ).rejects.toBeInstanceOf(ArtifactOwnershipError);

    const artifact = await createArtifact();
    expect(artifact.status).toBe('proposed');
    expect(artifact.latestVersion).toBe(0);

    await expect(
      repository.getArtifact({
        artifactId: artifact.id,
        trustedSubjectId: stranger,
      }),
    ).rejects.toBeInstanceOf(ArtifactOwnershipError);
  });

  it('Notebook协作者按角色共享产物且viewer保持只读', async () => {
    const editor = 'subject-editor-1';
    const viewer = 'subject-viewer-1';
    await database!.insert(schema.platformUsers).values([
      { id: editor, kind: 'registered', status: 'active' },
      { id: viewer, kind: 'registered', status: 'active' },
    ]);
    await database!.insert(schema.notebookMemberships).values([
      {
        notebookId: spaceId,
        userId: editor,
        role: 'editor',
        grantedByUserId: owner,
      },
      {
        notebookId: spaceId,
        userId: viewer,
        role: 'viewer',
        grantedByUserId: owner,
      },
    ]);

    const created = await repository.createArtifact({
      spaceId,
      trustedSubjectId: editor,
      kind: 'mind_map',
      trustTier: 'tier1',
      title: '协作产物',
    });
    await expect(
      repository.getArtifact({
        artifactId: created.id,
        trustedSubjectId: viewer,
      }),
    ).resolves.toMatchObject({ id: created.id });
    await expect(
      repository.createArtifact({
        spaceId,
        trustedSubjectId: viewer,
        kind: 'mind_map',
        trustTier: 'tier1',
        title: '越权创建',
      }),
    ).rejects.toBeInstanceOf(ArtifactOwnershipError);
  });

  it('原子生成拒绝把其他 Notebook 的 Conversation 挂到目标 Space', async () => {
    const [conversationSpace] = await database!
      .insert(schema.spaces)
      .values({ ownerSubjectId: owner, title: '其他笔记本' })
      .returning();
    const [foreignConversation] = await database!
      .insert(schema.conversations)
      .values({
        spaceId: conversationSpace!.id,
        ownerSubjectId: owner,
        title: '其他会话',
      })
      .returning();

    await expect(
      repository.createArtifactWithGenerationJob({
        spaceId,
        conversationId: foreignConversation!.id,
        trustedSubjectId: owner,
        kind: 'mind_map',
        trustTier: 'tier1',
        title: '错误归属的思维导图',
        taskIdentifier: 'artifact:generate',
      }),
    ).rejects.toBeInstanceOf(ArtifactOwnershipError);

    await expect(database!.select().from(schema.artifacts)).resolves.toEqual(
      [],
    );
  });

  it('手动内容以 active Artifact 与 v1 原子创建且不伪造生成任务', async () => {
    const created = await manualRepository.createWithInitialVersion({
      spaceId,
      trustedSubjectId: owner,
      kind: 'note',
      trustTier: 'tier1',
      title: '课堂笔记',
      content: {
        contentVersion: 1,
        markdown: '# 二次函数',
        generatedByModel: false,
      },
      generatedBy: 'user:manual',
    });

    expect(created.artifact).toMatchObject({
      kind: 'note',
      status: 'active',
      latestVersion: 1,
    });
    expect(created.version).toMatchObject({
      artifactId: created.artifact.id,
      version: 1,
      generatedBy: 'user:manual',
    });
    const jobs = await database!.select().from(schema.artifactGenerationJobs);
    expect(jobs).toEqual([]);

    await expect(
      manualRepository.createWithInitialVersion({
        spaceId,
        trustedSubjectId: stranger,
        kind: 'note',
        trustTier: 'tier1',
        title: '越权笔记',
        content: {
          contentVersion: 1,
          markdown: '',
          generatedByModel: false,
        },
        generatedBy: 'user:manual',
      }),
    ).rejects.toBeInstanceOf(ArtifactOwnershipError);
  });

  it('手动产物创建使用服务端指纹安全重放', async () => {
    const input = {
      spaceId,
      trustedSubjectId: owner,
      kind: 'note',
      trustTier: 'tier1' as const,
      title: '幂等笔记',
      content: { contentVersion: 1, markdown: '# 同一份' },
      generatedBy: 'user:manual',
      idempotencyKey: 'manual-note-1',
      requestFingerprint: 'a'.repeat(64),
    };
    const first = await manualRepository.createWithInitialVersion(input);
    const replay = await manualRepository.createWithInitialVersion(input);

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({
      replayed: true,
      artifact: { id: first.artifact.id },
      version: { id: first.version.id },
    });
    await expect(
      manualRepository.createWithInitialVersion({
        ...input,
        requestFingerprint: 'b'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(ArtifactIdempotencyConflictError);
  });

  it('Studio 按 Notebook Space 聚合，不依赖产物是否挂接 Conversation', async () => {
    const first = await createArtifact();
    const [otherSpace] = await database!
      .insert(schema.spaces)
      .values({ ownerSubjectId: owner, title: '另一本笔记本' })
      .returning();
    if (!otherSpace) throw new Error('第二个Space创建失败');
    await database!.insert(schema.notebookMemberships).values({
      notebookId: otherSpace.id,
      userId: owner,
      role: 'owner',
      grantedByUserId: owner,
    });
    await repository.createArtifact({
      spaceId: otherSpace.id,
      trustedSubjectId: owner,
      kind: 'slides',
      trustTier: 'tier1',
      title: '另一本的 Slides',
    });

    await expect(
      repository.listSpaceArtifacts({
        spaceId,
        trustedSubjectId: owner,
      }),
    ).resolves.toMatchObject([{ id: first.id, title: '思维导图' }]);
    await expect(
      repository.listSpaceArtifacts({
        spaceId,
        trustedSubjectId: stranger,
      }),
    ).rejects.toBeInstanceOf(ArtifactOwnershipError);
  });

  it('归档媒体产物与对象删除意图原子落库且不再出现在 Studio', async () => {
    const artifact = await repository.createArtifact({
      spaceId,
      trustedSubjectId: owner,
      kind: 'generated_image',
      trustTier: 'tier2',
      title: '待删除图像',
      status: 'active',
    });
    const version = await repository.appendVersion({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      objectKey: `artifacts/${artifact.id}/image.png`,
      checksum: 'a'.repeat(64),
      metadata: {
        contentVersion: 1,
        contentType: 'image/png',
        byteSize: 4,
        size: '1024x1024',
        image: {
          provider: 'fixture',
          resolvedModelId: 'image-v1',
          latencyMs: 10,
        },
      },
    });

    await expect(
      repository.archiveOwnedArtifact({
        artifactId: artifact.id,
        trustedSubjectId: owner,
        notebookId: spaceId,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.archiveOwnedArtifact({
        artifactId: artifact.id,
        trustedSubjectId: owner,
        notebookId: spaceId,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.listSpaceArtifacts({
        spaceId,
        trustedSubjectId: owner,
      }),
    ).resolves.toEqual([]);

    const entries = await database!.select().from(schema.objectDeletionOutbox);
    expect(entries).toMatchObject([
      {
        objectKind: 'artifact',
        sourceType: 'artifact_version',
        sourceId: version.id,
        storageKey: `artifacts/${artifact.id}/image.png`,
        status: 'pending',
      },
    ]);
  });

  it('版本单调递增,首个版本使产物转为 active,版本列表按新到旧', async () => {
    const artifact = await createArtifact();
    const v1 = await repository.appendVersion({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      content: { nodes: [{ id: 'root', label: 'AI' }] },
    });
    const v2 = await repository.appendVersion({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      content: { nodes: [{ id: 'root', label: 'AI 通识' }] },
    });
    expect([v1.version, v2.version]).toEqual([1, 2]);

    const refreshed = await repository.getArtifact({
      artifactId: artifact.id,
      trustedSubjectId: owner,
    });
    expect(refreshed.status).toBe('active');
    expect(refreshed.latestVersion).toBe(2);

    const versions = await repository.listVersions({
      artifactId: artifact.id,
      trustedSubjectId: owner,
    });
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
  });

  it('版本溯源还原每版来历:初始生成与共创修改要求', async () => {
    const artifact = await createArtifact();
    await repository.appendVersion({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      content: { nodes: [{ id: 'root', label: 'AI' }] },
      generatedBy: 'rule:outline-v1',
    });
    const reviseJob = await repository.createGenerationJob({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      params: { revision: { baseVersion: 1, instruction: '把根节点改成蓝色' } },
    });
    await repository.appendVersion({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      content: { nodes: [{ id: 'root', label: 'AI（蓝）' }] },
      generatedBy: 'model:artifact.revise:v1',
      generationJobId: reviseJob.id,
    });

    const provenance = await repository.listVersionProvenance({
      artifactId: artifact.id,
      trustedSubjectId: owner,
    });
    expect(provenance).toEqual([
      {
        version: 2,
        generatedBy: 'model:artifact.revise:v1',
        revisionInstruction: '把根节点改成蓝色',
        createdAt: expect.any(String),
      },
      {
        version: 1,
        generatedBy: 'rule:outline-v1',
        revisionInstruction: null,
        createdAt: expect.any(String),
      },
    ]);
  });

  it('数据库形状约束拒绝\"内容与对象引用同时缺失或同时存在\"', async () => {
    const artifact = await createArtifact();
    await expectConstraint(
      database!.insert(schema.artifactVersions).values({
        artifactId: artifact.id,
        version: 1,
        content: null,
        objectKey: null,
        checksum: null,
      }),
      'artifact_versions_content_shape_check',
    );

    await expectConstraint(
      database!.insert(schema.artifactVersions).values({
        artifactId: artifact.id,
        version: 1,
        content: { a: 1 },
        objectKey: 'artifacts/a.mp3',
        checksum: 'f'.repeat(64),
      }),
      'artifact_versions_content_shape_check',
    );
  });

  it('媒体版本要求 sha-256 校验和形状', async () => {
    const artifact = await createArtifact();
    await expectConstraint(
      repository.appendVersion({
        artifactId: artifact.id,
        trustedSubjectId: owner,
        objectKey: 'artifacts/audio.mp3',
        checksum: 'not-a-sha',
      }),
      'artifact_versions_object_key_check',
    );

    const version = await repository.appendVersion({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      objectKey: 'artifacts/audio.mp3',
      checksum: 'a'.repeat(64),
    });
    expect(version.objectKey).toBe('artifacts/audio.mp3');
    expect(version.content).toBeNull();
  });

  it('生成任务状态机:合法链路通过,非法转移与越权被拒绝', async () => {
    const artifact = await createArtifact();
    const job = await repository.createGenerationJob({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      params: { kind: 'mind_map' },
      queueJobKey: `artifact:${artifact.id}:1`,
    });
    expect(job.status).toBe('queued');

    await expect(
      repository.transitionGenerationJob({
        jobId: job.id,
        trustedSubjectId: stranger,
        to: 'running',
      }),
    ).rejects.toBeInstanceOf(ArtifactOwnershipError);

    /* queued 不能直接 succeeded */
    await expect(
      repository.transitionGenerationJob({
        jobId: job.id,
        trustedSubjectId: owner,
        to: 'succeeded',
      }),
    ).rejects.toBeInstanceOf(ArtifactJobLifecycleError);

    const running = await repository.transitionGenerationJob({
      jobId: job.id,
      trustedSubjectId: owner,
      to: 'running',
      progress: 10,
    });
    expect(running.status).toBe('running');

    const resumed = await repository.transitionGenerationJob({
      jobId: job.id,
      trustedSubjectId: owner,
      to: 'running',
      progress: 15,
    });
    expect(resumed).toMatchObject({ status: 'running', progress: 15 });
    await repository.updateGenerationJobCheckpoint({
      jobId: job.id,
      trustedSubjectId: owner,
      checkpoint: { stage: 'object_stored' },
    });
    await expect(
      repository.getGenerationJob({
        jobId: job.id,
        trustedSubjectId: owner,
      }),
    ).resolves.toMatchObject({
      params: { kind: 'mind_map' },
      checkpoint: { stage: 'object_stored' },
    });

    const done = await repository.transitionGenerationJob({
      jobId: job.id,
      trustedSubjectId: owner,
      to: 'succeeded',
      progress: 100,
    });
    expect(done.status).toBe('succeeded');

    /* terminal 无出边 */
    await expect(
      repository.transitionGenerationJob({
        jobId: job.id,
        trustedSubjectId: owner,
        to: 'cancelled',
      }),
    ).rejects.toBeInstanceOf(ArtifactJobLifecycleError);
  });

  it('失败转移必须携带 failureCode(数据库形状约束兜底)', async () => {
    const artifact = await createArtifact();
    const job = await repository.createGenerationJob({
      artifactId: artifact.id,
      trustedSubjectId: owner,
    });
    await repository.transitionGenerationJob({
      jobId: job.id,
      trustedSubjectId: owner,
      to: 'running',
    });
    await expectConstraint(
      repository.transitionGenerationJob({
        jobId: job.id,
        trustedSubjectId: owner,
        to: 'failed',
      }),
      'artifact_generation_jobs_failure_shape_check',
    );

    const failed = await repository.transitionGenerationJob({
      jobId: job.id,
      trustedSubjectId: owner,
      to: 'failed',
      failureCode: 'provider_timeout',
    });
    expect(failed.failureCode).toBe('provider_timeout');
  });
});
