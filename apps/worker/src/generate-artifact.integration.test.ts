/* worker 任务处理器默认经 getDb() 连接 DATABASE_URL;集成测试统一指到隔离库。 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { fileURLToPath } from 'node:url';
import { mindMapContentSchema } from '@educanvas/canvas-protocol';
import {
  ARTIFACT_GENERATE_TASK,
  DrizzlePlatformArtifactRepository,
  getDb,
  spaces,
  conversations,
} from '@educanvas/db';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { runOnce } from 'graphile-worker';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { taskList } from './tasks/index.js';

const connectionString = process.env.TEST_DATABASE_URL!;

describe('产物生成后端全链路(创建→原子入队→worker 消费→版本落库)', () => {
  const database = getDb();
  const repository = new DrizzlePlatformArtifactRepository();
  const owner = 'subject-artifact-chain';
  let spaceId = '';
  let conversationId = '';

  beforeAll(async () => {
    await migrate(database, {
      migrationsFolder: fileURLToPath(
        new URL('../../../packages/db/drizzle', import.meta.url),
      ),
    });
    /* 首次 runOnce 触发 graphile 自迁移 */
    await runOnce({ connectionString, taskList: { noop: async () => {} } });
  });

  beforeEach(async () => {
    await database.execute(
      sql`truncate table artifact_versions, artifact_generation_jobs, artifacts, conversations, spaces restart identity cascade`,
    );
    await database.execute(sql`delete from graphile_worker._private_jobs`);
    const [space] = await database
      .insert(spaces)
      .values({ ownerSubjectId: owner, title: '链路测试空间' })
      .returning();
    spaceId = space!.id;
    const [conversation] = await database
      .insert(conversations)
      .values({ spaceId, ownerSubjectId: owner })
      .returning();
    conversationId = conversation!.id;
  });

  afterAll(async () => {
    /* getDb 是进程级单例,由 vitest 进程退出回收 */
  });

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
    const parsed = mindMapContentSchema.safeParse(detail.latestVersion?.content);
    expect(parsed.success).toBe(true);
    expect(
      parsed.success ? parsed.data.root.label : null,
    ).toBe('本课思维导图');
  });

  it('不支持的产物类型以 failed+unsupported_kind 记账,不产生版本', async () => {
    const created = await repository.createArtifactWithGenerationJob({
      spaceId,
      conversationId,
      trustedSubjectId: owner,
      kind: 'slides',
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
});
