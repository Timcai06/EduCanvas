import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { representationIdentitySchema } from '@educanvas/agent-core';
import { DrizzleAssetRepresentationRepository } from './index';
import * as schema from './schema';

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
  ? postgres(testDatabaseUrl, { max: 2 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

const repository = () =>
  new DrizzleAssetRepresentationRepository(getDatabase() as never);

/**
 * D04 最低集成测试（docs/04-data/08-D04）：
 * 同一 AssetVersion 下 Local/Cloud 转录并存、幂等契约、确定性默认读取、
 * 显式 identity 读取、compatibility read、删除契约、job 重试不产生平行事实。
 */
describeWithDatabase('D04 派生表示多版本并存', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await getDatabase().execute(
      `truncate table
        object_deletion_outbox,
        asset_representations,
        asset_processing_jobs,
        asset_versions,
        assets,
        spaces,
        platform_users
      restart identity cascade`,
    );
  });

  async function seedAudioVersion(): Promise<string> {
    const owner = `user:${randomUUID()}`;
    await getDatabase()
      .insert(schema.platformUsers)
      .values({ id: owner, kind: 'registered', status: 'active' });
    const [space] = await getDatabase()
      .insert(schema.spaces)
      .values({
        ownerSubjectId: owner,
        kind: 'notebook',
        title: 'D04 空间',
        status: 'active',
      })
      .returning({ id: schema.spaces.id });
    const [asset] = await getDatabase()
      .insert(schema.assets)
      .values({
        ownerSubjectId: owner,
        spaceId: space!.id,
        scope: 'space',
        kind: 'audio',
        origin: 'upload',
        displayName: '音频',
        status: 'processing',
      })
      .returning({ id: schema.assets.id });
    const [version] = await getDatabase()
      .insert(schema.assetVersions)
      .values({
        assetId: asset!.id,
        kind: 'audio',
        mimeType: 'audio/wav',
        byteSize: 1024,
        contentHash: 'c'.repeat(64),
        status: 'ready',
        storageKey: `uploads/d04-${randomUUID()}`,
      })
      .returning({ id: schema.assetVersions.id });
    await getDatabase()
      .update(schema.assets)
      .set({ status: 'ready', currentVersionId: version!.id })
      .where(eq(schema.assets.id, asset!.id));
    return version!.id;
  }

  it('Local 与 Cloud transcription 在同一 AssetVersion 并存且互不覆盖', async () => {
    const versionId = await seedAudioVersion();
    const local = await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription' as const,
      variant: 'default',
      producer: 'local',
      producerVersion: 'sherpa.v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'derived/transcription/local.txt',
      checksum: 'a'.repeat(64),
      byteSize: 10,
    });
    const cloud = await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      variant: 'default',
      producer: 'cloud',
      producerVersion: 'provider-a.v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'derived/transcription/cloud.txt',
      checksum: 'b'.repeat(64),
      byteSize: 20,
    });

    /* 两条并存，内容身份各自独立。 */
    const all = await repository().listRepresentations({
      assetVersionId: versionId,
      kind: 'transcription',
    });
    expect(all).toHaveLength(2);
    const byKey = new Map(all.map((row) => [row.derivedStorageKey, row]));
    expect(byKey.get('derived/transcription/local.txt')?.checksum).toBe(
      'a'.repeat(64),
    );
    expect(byKey.get('derived/transcription/cloud.txt')?.checksum).toBe(
      'b'.repeat(64),
    );
    expect(local.id).not.toBe(cloud.id);
  });

  it('同一 producer 不同 producerVersion 可以并存', async () => {
    const versionId = await seedAudioVersion();
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'text',
      variant: 'default',
      producer: 'provider-b',
      producerVersion: 'v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'derived/ocr/v1.txt',
      checksum: 'a'.repeat(64),
      byteSize: 5,
    });
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'text',
      variant: 'default',
      producer: 'provider-b',
      producerVersion: 'v2',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'derived/ocr/v2.txt',
      checksum: 'b'.repeat(64),
      byteSize: 6,
    });
    expect(
      await repository().listRepresentations({
        assetVersionId: versionId,
        kind: 'text',
      }),
    ).toHaveLength(2);
  });

  it('相同完整 identity 重复写遵循幂等 upsert（更新不新增行）', async () => {
    const versionId = await seedAudioVersion();
    const first = await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      producer: 'local',
      producerVersion: 'sherpa.v1',
      mimeType: 'text/plain',
      status: 'processing',
    });
    const second = await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      producer: 'local',
      producerVersion: 'sherpa.v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'derived/transcription/sherpa.txt',
      checksum: 'c'.repeat(64),
      byteSize: 30,
    });
    expect(second.id).toBe(first.id);
    const all = await repository().listRepresentations({
      assetVersionId: versionId,
      kind: 'transcription',
    });
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe('ready');
    expect(all[0]!.derivedStorageKey).toBe('derived/transcription/sherpa.txt');
  });

  it('非法 kind/producer/variant/producer_version 被拒绝（应用层 zod + DB 格式 CHECK）', async () => {
    const versionId = await seedAudioVersion();
    const base = {
      assetVersionId: versionId,
      kind: 'transcription' as const,
      mimeType: 'text/plain',
      status: 'ready' as const,
    };
    /* 应用层（Repository 入口）zod 拒绝格式非法值。 */
    await expect(
      repository().upsertRepresentation({ ...base, kind: 'BAD-KIND' as never }),
    ).rejects.toThrow();
    await expect(
      repository().upsertRepresentation({
        ...base,
        kind: 'denoised' as never,
      }),
    ).rejects.toThrow();
    await expect(
      repository().upsertRepresentation({ ...base, producer: 'UPPER' }),
    ).rejects.toThrow();
    await expect(
      repository().upsertRepresentation({ ...base, variant: 'low-res' }),
    ).rejects.toThrow();
    await expect(
      repository().upsertRepresentation({ ...base, producerVersion: 'V1' }),
    ).rejects.toThrow();
    /* 绕过应用层（直接 SQL）时 DB 格式 CHECK 仍拒绝（23514）。 */
    await expect(
      getDatabase().insert(schema.assetRepresentations).values({
        assetVersionId: versionId,
        kind: 'BAD-KIND',
        variant: 'default',
        producer: 'default',
        producerVersion: 'v1',
        mimeType: 'text/plain',
        status: 'ready',
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      getDatabase().insert(schema.assetRepresentations).values({
        assetVersionId: versionId,
        kind: 'transcription',
        variant: 'default',
        producer: 'default',
        producerVersion: 'UPPER-CASE',
        mimeType: 'text/plain',
        status: 'ready',
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('默认读取选择具有确定性：ready 优先 → default 优先 → 版本字典序', async () => {
    const versionId = await seedAudioVersion();
    /* 三个 ready 版本：producer 字典序应选 'cloud'；再注入 default 应选 default。 */
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      producer: 'cloud',
      producerVersion: 'provider-a.v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'k1',
      checksum: 'a'.repeat(64),
      byteSize: 1,
    });
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      producer: 'local',
      producerVersion: 'sherpa.v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'k2',
      checksum: 'b'.repeat(64),
      byteSize: 2,
    });
    /* producer 字典序：cloud < local → 默认选 cloud。 */
    const firstDefault = await repository().selectDefaultRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
    });
    expect(firstDefault?.producer).toBe('cloud');
    /* 注入 producer='default'（系统默认）后应被优先选中。 */
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      producer: 'default',
      producerVersion: 'v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'k0',
      checksum: 'c'.repeat(64),
      byteSize: 3,
    });
    const secondDefault = await repository().selectDefaultRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
    });
    expect(secondDefault?.producer).toBe('default');
    /* ready 优先于 failed/processing。 */
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'preview',
      producer: 'renderer-a',
      producerVersion: 'v1',
      mimeType: 'image/png',
      status: 'failed',
      failureCode: 'render_failed',
    });
    const failedFirst = await repository().selectDefaultRepresentation({
      assetVersionId: versionId,
      kind: 'preview',
    });
    expect(failedFirst?.status).toBe('failed');
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'preview',
      producer: 'renderer-a',
      producerVersion: 'v1',
      mimeType: 'image/png',
      status: 'ready',
      derivedStorageKey: 'k3',
      checksum: 'd'.repeat(64),
      byteSize: 4,
    });
    const readyFirst = await repository().selectDefaultRepresentation({
      assetVersionId: versionId,
      kind: 'preview',
    });
    expect(readyFirst?.status).toBe('ready');
  });

  it('显式 identity 读取返回准确版本', async () => {
    const versionId = await seedAudioVersion();
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      producer: 'cloud',
      producerVersion: 'provider-a.v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'cloud.txt',
      checksum: 'a'.repeat(64),
      byteSize: 1,
    });
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      producer: 'local',
      producerVersion: 'sherpa.v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'local.txt',
      checksum: 'b'.repeat(64),
      byteSize: 2,
    });
    const local = await repository().getRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      identity: { producer: 'local', producerVersion: 'sherpa.v1' },
    });
    expect(local?.derivedStorageKey).toBe('local.txt');
    const cloud = await repository().getRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      identity: { producer: 'cloud', producerVersion: 'provider-a.v1' },
    });
    expect(cloud?.derivedStorageKey).toBe('cloud.txt');
    /* 不存在的 identity 返回 null。 */
    expect(
      await repository().getRepresentation({
        assetVersionId: versionId,
        kind: 'transcription',
        identity: { producer: 'cloud', producerVersion: 'v9' },
      }),
    ).toBeNull();
  });

  it('同 identity 替换对象时把旧 key 写入删除 Outbox', async () => {
    const versionId = await seedAudioVersion();
    const first = await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      producer: 'cloud',
      producerVersion: 'provider-a.v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'derived/transcription/old.txt',
      checksum: 'a'.repeat(64),
      byteSize: 1,
    });
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      producer: 'cloud',
      producerVersion: 'provider-a.v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'derived/transcription/new.txt',
      checksum: 'b'.repeat(64),
      byteSize: 2,
    });

    await expect(
      getDatabase()
        .select()
        .from(schema.objectDeletionOutbox)
        .where(eq(schema.objectDeletionOutbox.sourceId, first.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        storageKey: 'derived/transcription/old.txt',
        sourceType: 'asset_representation',
      }),
    ]);
  });

  it('删除 AssetVersion 时 representation 随 cascade 删除（D01 契约）', async () => {
    const versionId = await seedAudioVersion();
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      producer: 'local',
      producerVersion: 'sherpa.v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'k',
      checksum: 'a'.repeat(64),
      byteSize: 1,
    });
    /* D01 契约：当前版本的物理删除前必须先 tombstone asset
       （current_version_id 的 set null 在 ready 形状下会被拒绝）。 */
    await getDatabase()
      .update(schema.assets)
      .set({
        status: 'tombstoned',
        tombstonedAt: new Date(),
      })
      .where(
        sql`${schema.assets.id} = (select asset_id from asset_versions where id = ${versionId})`,
      );
    await getDatabase()
      .delete(schema.assetVersions)
      .where(eq(schema.assetVersions.id, versionId));
    expect(
      await repository().listRepresentations({ assetVersionId: versionId }),
    ).toEqual([]);
  });

  it('job 唯一约束防止同一 identity 平行事实（重试不产生第二个 job）', async () => {
    const versionId = await seedAudioVersion();
    const [first] = await getDatabase()
      .insert(schema.assetProcessingJobs)
      .values({
        assetVersionId: versionId,
        kind: 'transcribe_audio',
        variant: 'default',
        producer: 'default',
        producerVersion: 'v1',
        status: 'queued',
        attempts: 0,
        queueJobKey: `asset-transcribe_audio:${randomUUID()}`,
      })
      .returning({ id: schema.assetProcessingJobs.id });
    /* 同一 identity 再入队被唯一约束拒绝（应用层应 onConflictDoNothing 幂等返回）。 */
    await expect(
      getDatabase()
        .insert(schema.assetProcessingJobs)
        .values({
          assetVersionId: versionId,
          kind: 'transcribe_audio',
          variant: 'default',
          producer: 'default',
          producerVersion: 'v1',
          status: 'queued',
          attempts: 0,
          queueJobKey: `asset-transcribe_audio:${randomUUID()}`,
        }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    /* 不同 identity（如 cloud 转录）可以有自己的 job——不互相覆盖。 */
    await getDatabase()
      .insert(schema.assetProcessingJobs)
      .values({
        assetVersionId: versionId,
        kind: 'transcribe_audio',
        variant: 'default',
        producer: 'cloud',
        producerVersion: 'provider-a.v1',
        status: 'queued',
        attempts: 0,
        queueJobKey: `asset-transcribe_audio:${randomUUID()}`,
      });
    const jobs = await getDatabase()
      .select({ kind: schema.assetProcessingJobs.kind })
      .from(schema.assetProcessingJobs)
      .where(eq(schema.assetProcessingJobs.assetVersionId, versionId));
    expect(jobs).toHaveLength(2);
    expect(first?.id).toBeTruthy();
  });

  it('compatibility read：新写入进入 representation 权威并同事务镜像旧字段', async () => {
    const versionId = await seedAudioVersion();
    /* 新权威写入：transcription representation（内容身份 = 对象）。 */
    await repository().upsertRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
      producer: 'local',
      producerVersion: 'sherpa.v1',
      mimeType: 'text/plain',
      status: 'ready',
      derivedStorageKey: 'derived/transcription/sherpa.txt',
      checksum: 'a'.repeat(64),
      byteSize: 30,
    });
    /* representation 是权威（可查询/并存）；旧字段未由本写入路径触碰。 */
    const representation = await repository().selectDefaultRepresentation({
      assetVersionId: versionId,
      kind: 'transcription',
    });
    expect(representation?.derivedStorageKey).toBe(
      'derived/transcription/sherpa.txt',
    );
    /* 旧字段回退路径（读取层冻结规则）：仅有旧字段时读取端回退 transcriptionText。 */
    await getDatabase()
      .update(schema.assetVersions)
      .set({ transcriptionText: '旧转录文本' })
      .where(eq(schema.assetVersions.id, versionId));
    const [version] = await getDatabase()
      .select({ transcriptionText: schema.assetVersions.transcriptionText })
      .from(schema.assetVersions)
      .where(eq(schema.assetVersions.id, versionId));
    expect(version?.transcriptionText).toBe('旧转录文本');
    /* 无 representation 时默认读取返回 null（读取层按冻结规则回退旧字段）。 */
    await getDatabase()
      .delete(schema.assetRepresentations)
      .where(eq(schema.assetRepresentations.assetVersionId, versionId));
    expect(
      await repository().selectDefaultRepresentation({
        assetVersionId: versionId,
        kind: 'transcription',
      }),
    ).toBeNull();
  });
});
