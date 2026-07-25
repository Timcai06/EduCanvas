import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import { DrizzlePlatformArtifactRepository } from './platform-artifact-repository';
import { DrizzlePlatformArtifactTurnReferenceRepository } from './platform-artifact-turn-reference-repository';
import { DrizzlePlatformTurnRepository } from './platform-turn-repository';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('集成测试拒绝使用非隔离数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 4 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

describeWithDatabase('Agent Turn 产物引用', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table artifact_versions, artifact_generation_jobs, artifacts,
        conversation_messages, agent_operations, conversations, spaces
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('只把同一主体和Conversation的生成任务恢复到对应Turn', async () => {
    const owner = 'artifact-turn-owner';
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const turns = new DrizzlePlatformTurnRepository(getDatabase());
    const artifacts = new DrizzlePlatformArtifactRepository(getDatabase());
    const references = new DrizzlePlatformArtifactTurnReferenceRepository(
      getDatabase(),
    );
    const conversation = await conversations.create({
      ownerSubjectId: owner,
      spaceKind: 'notebook',
      spaceTitle: '函数笔记本',
    });
    const turn = await turns.createOrGetTurn({
      conversationId: conversation.id,
      trustedSubjectId: owner,
      clientMessageId: 'artifact-turn-1',
      text: '生成函数思维导图',
    });
    const artifact = await artifacts.createArtifact({
      spaceId: conversation.spaceId,
      conversationId: conversation.id,
      trustedSubjectId: owner,
      kind: 'mind_map',
      trustTier: 'tier1',
      title: '函数思维导图',
    });
    await artifacts.createGenerationJob({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      operationId: turn.turnId,
    });

    await expect(
      references.listForOperations({
        conversationId: conversation.id,
        trustedSubjectId: owner,
        operationIds: [turn.turnId],
      }),
    ).resolves.toMatchObject([
      {
        operationId: turn.turnId,
        artifact: {
          id: artifact.id,
          title: '函数思维导图',
          latestVersion: 0,
        },
      },
    ]);
    await expect(
      references.listForOperations({
        conversationId: conversation.id,
        trustedSubjectId: 'another-owner',
        operationIds: [turn.turnId],
      }),
    ).resolves.toEqual([]);
  });

  it('限制一次历史投影最多读取100个Operation', async () => {
    const references = new DrizzlePlatformArtifactTurnReferenceRepository(
      getDatabase(),
    );
    await expect(
      references.listForOperations({
        conversationId: crypto.randomUUID(),
        trustedSubjectId: 'owner',
        operationIds: Array.from(
          { length: 101 },
          (_, index) => `turn-${index}`,
        ),
      }),
    ).rejects.toThrow('artifact_turn_reference_operation_limit_exceeded');
  });
});
