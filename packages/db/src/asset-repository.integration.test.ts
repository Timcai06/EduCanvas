import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AssetAccessError, DrizzleAssetRepository } from './asset-repository';
import { DrizzleChatRepository } from './chat-repository';
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
  ? postgres(testDatabaseUrl, { max: 8 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;
const ownerSubjectId = `anon:v1:${'a'.repeat(64)}`;
const otherSubjectId = `anon:v1:${'b'.repeat(64)}`;
const spaceId = '91000000-0000-4000-8000-000000000001';

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
        agent_message_parts,
        chat_messages,
        asset_versions,
        assets,
        lesson_sessions
      restart identity cascade
    `);
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
    const chat = new DrizzleChatRepository(getDatabase());
    const turn = await chat.createOrGetTurn({
      sessionId: spaceId,
      trustedStudentId: ownerSubjectId,
      clientMessageId: 'asset-message-1',
      parts,
    });
    expect(turn.studentMessage.parts).toEqual(parts);
    const history = await chat.listHistory({
      sessionId: spaceId,
      trustedStudentId: ownerSubjectId,
    });
    expect(
      history.messages.find((message) => message.role === 'student')?.parts,
    ).toEqual(parts);
  });
});
