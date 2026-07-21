import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentTurnContextLifecycleError,
  AgentTurnContextOwnershipError,
  DrizzleAgentTurnContextRepository,
} from './agent-turn-context-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import * as schema from './schema';
import { TurnContextConflictError } from './turn-context';

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

interface ContextFixture {
  actorId: string;
  otherActorId: string;
  operationId: string;
  includedMessageIds: string[];
  selectedAssetVersionIds: string[];
  otherConversationMessageId: string;
  otherNotebookAssetVersionId: string;
}

async function createReadyAsset(input: {
  actorId: string;
  spaceId: string;
  label: string;
}): Promise<string> {
  const [asset] = await getDatabase()
    .insert(schema.assets)
    .values({
      ownerSubjectId: input.actorId,
      spaceId: input.spaceId,
      scope: 'space',
      kind: 'document',
      origin: 'upload',
      displayName: `${input.label}.txt`,
      mimeType: 'text/plain',
      status: 'pending',
    })
    .returning({ id: schema.assets.id });
  if (!asset) throw new Error('测试Asset创建失败');
  const [version] = await getDatabase()
    .insert(schema.assetVersions)
    .values({
      assetId: asset.id,
      kind: 'document',
      mimeType: 'text/plain',
      byteSize: 12,
      contentHash: createHash('sha256').update(input.label).digest('hex'),
      status: 'ready',
      storageKey: `test/${asset.id}/${input.label}.txt`,
      extractedText: `正文:${input.label}`,
    })
    .returning({ id: schema.assetVersions.id });
  if (!version) throw new Error('测试AssetVersion创建失败');
  await getDatabase()
    .update(schema.assets)
    .set({ status: 'ready', currentVersionId: version.id })
    .where(eq(schema.assets.id, asset.id));
  return version.id;
}

async function createContextFixture(
  suffix = 'primary',
): Promise<ContextFixture> {
  const actorId = `user:context-owner:${suffix}`;
  const otherActorId = `user:context-other:${suffix}`;
  await getDatabase()
    .insert(schema.platformUsers)
    .values([
      { id: actorId, kind: 'registered' },
      { id: otherActorId, kind: 'registered' },
    ]);
  const [agent] = await getDatabase()
    .insert(schema.personalAgents)
    .values({ userId: actorId })
    .returning();
  if (!agent) throw new Error('测试Agent创建失败');
  const conversations = new DrizzlePlatformConversationRepository(
    getDatabase(),
  );
  const conversation = await conversations.create({
    ownerSubjectId: actorId,
    spaceKind: 'notebook',
    spaceTitle: '上下文账本测试',
  });
  const otherConversation = await conversations.create({
    ownerSubjectId: actorId,
    spaceKind: 'notebook',
    spaceTitle: '另一个Notebook',
  });
  const operationId = randomUUID();
  const now = new Date('2026-07-21T10:00:00.000Z');
  await getDatabase()
    .insert(schema.agentOperations)
    .values({
      id: operationId,
      gatewayEnvelopeId: `envelope:${operationId}`,
      requestFingerprint: 'a'.repeat(64),
      actorUserId: actorId,
      agentId: agent.id,
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
      kind: 'turn',
      idempotencyKey: `idempotency:${operationId}`,
      traceId: `trace:${operationId}`,
      status: 'running',
      createdAt: now,
    });
  const includedMessageIds = [randomUUID(), randomUUID()];
  const otherConversationMessageId = randomUUID();
  await getDatabase()
    .insert(schema.conversationMessages)
    .values([
      {
        id: includedMessageIds[0],
        conversationId: conversation.id,
        role: 'user',
        status: 'completed',
        content: '历史问题',
        parts: [{ type: 'text', text: '历史问题' }],
        createdAt: new Date('2026-07-21T09:59:00.000Z'),
        completedAt: new Date('2026-07-21T09:59:00.000Z'),
      },
      {
        id: includedMessageIds[1],
        conversationId: conversation.id,
        operationId,
        role: 'user',
        status: 'completed',
        content: '本轮问题',
        parts: [{ type: 'text', text: '本轮问题' }],
        createdAt: now,
        completedAt: now,
      },
      {
        id: otherConversationMessageId,
        conversationId: otherConversation.id,
        role: 'user',
        status: 'completed',
        content: '不应进入上下文',
        parts: [{ type: 'text', text: '不应进入上下文' }],
        createdAt: now,
        completedAt: now,
      },
    ]);
  const selectedAssetVersionIds = [
    await createReadyAsset({
      actorId,
      spaceId: conversation.spaceId,
      label: `selected-${suffix}`,
    }),
  ];
  const otherNotebookAssetVersionId = await createReadyAsset({
    actorId,
    spaceId: otherConversation.spaceId,
    label: `foreign-${suffix}`,
  });
  return {
    actorId,
    otherActorId,
    operationId,
    includedMessageIds,
    selectedAssetVersionIds,
    otherConversationMessageId,
    otherNotebookAssetVersionId,
  };
}

describeWithDatabase('统一Agent Context Snapshot账本', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table turn_context_snapshots, asset_versions, assets,
        conversation_messages, agent_operations, conversations, spaces,
        personal_agents, platform_users, lesson_sessions
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('按Operation幂等保存不可变引用且不复制消息或Asset正文', async () => {
    const fixture = await createContextFixture();
    const repository = new DrizzleAgentTurnContextRepository(getDatabase());
    const material = {
      builderVersion: 'agent-context-v2',
      includedMessageIds: fixture.includedMessageIds,
      selectedAssetVersionIds: fixture.selectedAssetVersionIds,
      omittedMessageCount: 3,
      characterCount: 120,
    };
    const created = await repository.createOrGet({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      material,
      now: new Date('2026-07-21T10:00:01.000Z'),
    });
    expect(created).toMatchObject({
      replayed: false,
      snapshot: { operationId: fixture.operationId, ...material },
    });
    const replayed = await repository.createOrGet({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      material,
    });
    expect(replayed).toMatchObject({
      replayed: true,
      snapshot: { id: created.snapshot.id },
    });
    expect(
      await repository.get({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
      }),
    ).toEqual(created.snapshot);

    const [stored] = await getDatabase()
      .select()
      .from(schema.turnContextSnapshots)
      .where(eq(schema.turnContextSnapshots.id, created.snapshot.id));
    expect(stored).toMatchObject({
      sessionId: null,
      turnId: null,
      agentOperationId: fixture.operationId,
    });
    expect(JSON.stringify(stored)).not.toContain('历史问题');
    expect(JSON.stringify(stored)).not.toContain('正文:selected');
  });

  it('拒绝上下文漂移、重复ID和终态后补写', async () => {
    const fixture = await createContextFixture();
    const repository = new DrizzleAgentTurnContextRepository(getDatabase());
    const material = {
      builderVersion: 'agent-context-v2',
      includedMessageIds: fixture.includedMessageIds,
      selectedAssetVersionIds: fixture.selectedAssetVersionIds,
      omittedMessageCount: 0,
      characterCount: 80,
    };
    await repository.createOrGet({
      operationId: fixture.operationId,
      actorId: fixture.actorId,
      material,
    });
    await expect(
      repository.createOrGet({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        material: { ...material, characterCount: 81 },
      }),
    ).rejects.toBeInstanceOf(TurnContextConflictError);
    await expect(
      repository.createOrGet({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        material: {
          ...material,
          includedMessageIds: [
            fixture.includedMessageIds[0]!,
            fixture.includedMessageIds[0]!,
          ],
        },
      }),
    ).rejects.toBeInstanceOf(TurnContextConflictError);

    const secondFixture = await createContextFixture('terminal');
    await getDatabase()
      .update(schema.agentOperations)
      .set({
        status: 'completed',
        completedAt: new Date('2026-07-21T10:01:00.000Z'),
      })
      .where(eq(schema.agentOperations.id, secondFixture.operationId));
    await expect(
      repository.createOrGet({
        operationId: secondFixture.operationId,
        actorId: secondFixture.actorId,
        material: {
          ...material,
          includedMessageIds: secondFixture.includedMessageIds,
          selectedAssetVersionIds: secondFixture.selectedAssetVersionIds,
        },
      }),
    ).rejects.toBeInstanceOf(AgentTurnContextLifecycleError);
  });

  it('拒绝跨Actor、跨Conversation消息与跨Notebook AssetVersion', async () => {
    const fixture = await createContextFixture();
    const repository = new DrizzleAgentTurnContextRepository(getDatabase());
    const base = {
      builderVersion: 'agent-context-v2',
      includedMessageIds: fixture.includedMessageIds,
      selectedAssetVersionIds: fixture.selectedAssetVersionIds,
      omittedMessageCount: 0,
      characterCount: 80,
    };
    await expect(
      repository.createOrGet({
        operationId: fixture.operationId,
        actorId: fixture.otherActorId,
        material: base,
      }),
    ).rejects.toBeInstanceOf(AgentTurnContextOwnershipError);
    await expect(
      repository.createOrGet({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        material: {
          ...base,
          includedMessageIds: [fixture.otherConversationMessageId],
        },
      }),
    ).rejects.toBeInstanceOf(AgentTurnContextOwnershipError);
    await expect(
      repository.createOrGet({
        operationId: fixture.operationId,
        actorId: fixture.actorId,
        material: {
          ...base,
          selectedAssetVersionIds: [fixture.otherNotebookAssetVersionId],
        },
      }),
    ).rejects.toBeInstanceOf(AgentTurnContextOwnershipError);
    await expect(
      repository.get({
        operationId: fixture.operationId,
        actorId: fixture.otherActorId,
      }),
    ).rejects.toBeInstanceOf(AgentTurnContextOwnershipError);
  });
});
