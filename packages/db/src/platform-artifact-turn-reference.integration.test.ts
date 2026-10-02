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
    const job = await artifacts.createGenerationJob({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      operationId: turn.turnId,
    });
    await artifacts.transitionGenerationJob({
      jobId: job.id,
      trustedSubjectId: owner,
      to: 'cancelled',
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
        generationStatus: 'cancelled',
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

  it('按主体、Notebook、Conversation 共同收紧 job 回执，并返回实时提交状态', async () => {
    const owner = 'artifact-receipt-owner';
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const artifacts = new DrizzlePlatformArtifactRepository(getDatabase());
    const receipts = new DrizzlePlatformArtifactRepository(getDatabase());
    const conversation = await conversations.create({
      ownerSubjectId: owner,
      spaceKind: 'notebook',
      spaceTitle: '回执笔记本',
    });
    const artifact = await artifacts.createArtifact({
      spaceId: conversation.spaceId,
      conversationId: conversation.id,
      trustedSubjectId: owner,
      kind: 'mind_map',
      trustTier: 'tier1',
      title: '真实生成回执',
    });
    const job = await artifacts.createGenerationJob({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      operationId: null,
    });
    const scope = {
      artifactId: artifact.id,
      spaceId: conversation.spaceId,
      conversationId: conversation.id,
      trustedSubjectId: owner,
    };

    await expect(receipts.getGenerationReceipt(scope)).resolves.toMatchObject({
      jobId: job.id,
      artifactId: artifact.id,
      jobStatus: 'queued',
      artifactStatus: 'proposed',
      committedVersion: null,
    });
    await expect(
      receipts.getGenerationReceipt({ ...scope, trustedSubjectId: 'stranger' }),
    ).resolves.toBeNull();
    await expect(
      receipts.getGenerationReceipt({
        ...scope,
        spaceId: crypto.randomUUID(),
      }),
    ).resolves.toBeNull();
    await expect(
      receipts.getGenerationReceipt({
        ...scope,
        conversationId: crypto.randomUUID(),
      }),
    ).resolves.toBeNull();
    await expect(
      receipts.getGenerationReceipt({
        ...scope,
        artifactId: crypto.randomUUID(),
      }),
    ).resolves.toBeNull();

    await artifacts.transitionGenerationJob({
      jobId: job.id,
      trustedSubjectId: owner,
      to: 'running',
      progress: 45,
    });
    await expect(receipts.getGenerationReceipt(scope)).resolves.toMatchObject({
      jobStatus: 'running',
      progress: 45,
      committedVersion: null,
    });

    await artifacts.appendVersionAndCompleteGenerationJob({
      artifactId: artifact.id,
      jobId: job.id,
      trustedSubjectId: owner,
      content: { nodes: [{ id: 'root', label: '真实服务端版本' }] },
    });
    await expect(receipts.getGenerationReceipt(scope)).resolves.toMatchObject({
      jobStatus: 'succeeded',
      artifactStatus: 'active',
      committedVersion: { version: 1 },
    });
    const successReceipt = await receipts.getGenerationReceipt(scope);
    expect(successReceipt).not.toHaveProperty('params');
    expect(successReceipt).not.toHaveProperty('checkpoint');
    expect(successReceipt).not.toHaveProperty('failureCode');

    const retryJob = await artifacts.createGenerationJob({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      operationId: null,
    });
    await artifacts.transitionGenerationJob({
      jobId: retryJob.id,
      trustedSubjectId: owner,
      to: 'running',
      progress: 10,
    });
    await expect(receipts.getGenerationReceipt(scope)).resolves.toMatchObject({
      jobId: retryJob.id,
      jobStatus: 'running',
      committedVersion: null,
    });

    await artifacts.appendVersion({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      generationJobId: retryJob.id,
      content: { nodes: [{ id: 'root', label: '不一致的提交版本' }] },
    });
    await expect(receipts.getGenerationReceipt(scope)).resolves.toMatchObject({
      jobId: retryJob.id,
      jobStatus: 'running',
      committedVersion: { version: 2 },
    });

    const failedArtifact = await artifacts.createArtifact({
      spaceId: conversation.spaceId,
      conversationId: conversation.id,
      trustedSubjectId: owner,
      kind: 'note',
      trustTier: 'tier1',
      title: '失败回执',
    });
    const failedJob = await artifacts.createGenerationJob({
      artifactId: failedArtifact.id,
      trustedSubjectId: owner,
      operationId: null,
    });
    await artifacts.transitionGenerationJob({
      jobId: failedJob.id,
      trustedSubjectId: owner,
      to: 'running',
    });
    await artifacts.transitionGenerationJob({
      jobId: failedJob.id,
      trustedSubjectId: owner,
      to: 'failed',
      failureCode: 'safe_test_failure',
    });
    await expect(
      receipts.getGenerationReceipt({
        ...scope,
        artifactId: failedArtifact.id,
      }),
    ).resolves.toMatchObject({
      jobId: failedJob.id,
      jobStatus: 'failed',
      committedVersion: null,
    });

    const cancelledArtifact = await artifacts.createArtifact({
      spaceId: conversation.spaceId,
      conversationId: conversation.id,
      trustedSubjectId: owner,
      kind: 'note',
      trustTier: 'tier1',
      title: '取消回执',
    });
    const cancelledJob = await artifacts.createGenerationJob({
      artifactId: cancelledArtifact.id,
      trustedSubjectId: owner,
      operationId: null,
    });
    await artifacts.transitionGenerationJob({
      jobId: cancelledJob.id,
      trustedSubjectId: owner,
      to: 'cancelled',
    });
    await expect(
      receipts.getGenerationReceipt({
        ...scope,
        artifactId: cancelledArtifact.id,
      }),
    ).resolves.toMatchObject({
      jobId: cancelledJob.id,
      jobStatus: 'cancelled',
      committedVersion: null,
    });
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

  it('历史引用读取当前最新job，手动重试不被原Turn的失败态覆盖', async () => {
    const owner = 'artifact-retry-owner';
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
      spaceTitle: '重试笔记本',
    });
    const turn = await turns.createOrGetTurn({
      conversationId: conversation.id,
      trustedSubjectId: owner,
      clientMessageId: 'retry-turn',
      text: '生成笔记',
    });
    const artifact = await artifacts.createArtifact({
      spaceId: conversation.spaceId,
      conversationId: conversation.id,
      trustedSubjectId: owner,
      kind: 'note',
      trustTier: 'tier1',
      title: '笔记',
    });
    const oldJob = await artifacts.createGenerationJob({
      artifactId: artifact.id,
      trustedSubjectId: owner,
      operationId: turn.turnId,
    });
    await artifacts.transitionGenerationJob({
      jobId: oldJob.id,
      trustedSubjectId: owner,
      to: 'running',
    });
    await artifacts.transitionGenerationJob({
      jobId: oldJob.id,
      trustedSubjectId: owner,
      to: 'failed',
      failureCode: 'model_output_limit',
    });
    const retry = await artifacts.createGenerationJob({
      artifactId: artifact.id,
      trustedSubjectId: owner,
    });
    await artifacts.transitionGenerationJob({
      jobId: retry.id,
      trustedSubjectId: owner,
      to: 'running',
    });
    const input = {
      conversationId: conversation.id,
      trustedSubjectId: owner,
      operationIds: [turn.turnId],
    };
    await expect(references.listForOperations(input)).resolves.toMatchObject([
      { operationId: turn.turnId, generationStatus: 'running' },
    ]);
    await artifacts.transitionGenerationJob({
      jobId: retry.id,
      trustedSubjectId: owner,
      to: 'cancelled',
    });
    await expect(references.listForOperations(input)).resolves.toMatchObject([
      { operationId: turn.turnId, generationStatus: 'cancelled' },
    ]);
    await expect(
      references.listForOperations({
        ...input,
        conversationId: crypto.randomUUID(),
      }),
    ).resolves.toEqual([]);
  });
});
