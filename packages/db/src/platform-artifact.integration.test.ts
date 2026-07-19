import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ArtifactJobLifecycleError,
  ArtifactOwnershipError,
  DrizzlePlatformArtifactRepository,
} from './platform-artifact-repository';
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
      sql`truncate table artifact_versions, artifact_generation_jobs, artifacts, spaces restart identity cascade`,
    );
    const [space] = await database!
      .insert(schema.spaces)
      .values({ ownerSubjectId: owner, title: '测试空间' })
      .returning();
    spaceId = space!.id;
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

  it('Studio 按 Notebook Space 聚合，不依赖产物是否挂接 Conversation', async () => {
    const first = await createArtifact();
    const [otherSpace] = await database!
      .insert(schema.spaces)
      .values({ ownerSubjectId: owner, title: '另一本笔记本' })
      .returning();
    if (!otherSpace) throw new Error('第二个Space创建失败');
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
    ).resolves.toEqual([]);
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
