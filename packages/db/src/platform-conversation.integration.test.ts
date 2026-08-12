import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DrizzlePlatformConversationRepository,
  PlatformConversationOwnershipError,
} from './conversation-platform-repository';
import { DrizzleAssetRepository } from './asset-repository';
import { DrizzlePlatformSourceRepository } from './platform-source-repository';
import {
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayOperationStore,
  GatewayPersistenceError,
} from './gateway-repository';
import {
  DrizzlePlatformTurnRepository,
  PlatformMessageIdConflictError,
} from './platform-turn-repository';
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

describeWithDatabase('通用Space/Conversation骨架', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table security_audit_events, object_deletion_outbox, lesson_sessions, conversation_message_citations, operation_sources, conversation_messages, agent_operations, conversations, spaces, asset_versions, assets
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('不创建lesson session也能持久化并恢复通用对话', async () => {
    const repository = new DrizzlePlatformConversationRepository(getDatabase());
    const conversation = await repository.create({
      ownerSubjectId: 'general-agent-user',
      spaceKind: 'personal',
      spaceTitle: '我的工作区',
      agentProfileId: 'general',
      conversationTitle: '多模态对话',
      now: new Date('2026-07-16T06:00:00.000Z'),
    });
    await repository.appendCompletedMessage({
      conversationId: conversation.id,
      trustedSubjectId: 'general-agent-user',
      role: 'user',
      content: '分析这个项目',
      now: new Date('2026-07-16T06:01:00.000Z'),
    });
    await repository.appendCompletedMessage({
      conversationId: conversation.id,
      trustedSubjectId: 'general-agent-user',
      role: 'assistant',
      content: '先从架构开始。',
      now: new Date('2026-07-16T06:02:00.000Z'),
    });

    expect(
      await repository.listMessages({
        conversationId: conversation.id,
        trustedSubjectId: 'general-agent-user',
      }),
    ).toMatchObject([
      { role: 'user', content: '分析这个项目', status: 'completed' },
      { role: 'assistant', content: '先从架构开始。', status: 'completed' },
    ]);
    expect(await getDatabase().select().from(schema.lessonSessions)).toEqual(
      [],
    );
  });

  it('历史消息limit返回最新窗口且保持正序，当前Turn不会被长会话挤出', async () => {
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const turns = new DrizzlePlatformTurnRepository(getDatabase());
    const conversation = await conversations.create({
      ownerSubjectId: 'latest-window-user',
      spaceKind: 'notebook',
      spaceTitle: '长会话',
    });
    for (let index = 1; index <= 4; index += 1) {
      const turn = await turns.createOrGetTurn({
        conversationId: conversation.id,
        trustedSubjectId: 'latest-window-user',
        clientMessageId: `latest-${index}`,
        text: `消息${index}`,
        now: new Date(`2026-07-16T06:0${index}:00.000Z`),
      });
      await turns.settleTurn({
        conversationId: conversation.id,
        trustedSubjectId: 'latest-window-user',
        turnId: turn.turnId,
        status: 'completed',
        content: `回答${index}`,
        now: new Date(`2026-07-16T06:0${index}:01.000Z`),
      });
    }

    expect(
      await turns.listMessages({
        conversationId: conversation.id,
        trustedSubjectId: 'latest-window-user',
        limit: 2,
      }),
    ).toMatchObject([
      { role: 'user', content: '消息4' },
      { role: 'assistant', content: '回答4' },
    ]);
  });

  it('拒绝跨主体写入和读取', async () => {
    const repository = new DrizzlePlatformConversationRepository(getDatabase());
    const conversation = await repository.create({
      ownerSubjectId: 'owner-a',
      spaceKind: 'notebook',
      spaceTitle: '资料库',
    });
    await expect(
      repository.appendCompletedMessage({
        conversationId: conversation.id,
        trustedSubjectId: 'owner-b',
        role: 'user',
        content: '越权消息',
      }),
    ).rejects.toBeInstanceOf(PlatformConversationOwnershipError);
    await expect(
      repository.listMessages({
        conversationId: conversation.id,
        trustedSubjectId: 'owner-b',
      }),
    ).rejects.toBeInstanceOf(PlatformConversationOwnershipError);
  });

  it('重命名在同一事务同步Notebook和主Conversation且拒绝跨主体', async () => {
    const repository = new DrizzlePlatformConversationRepository(getDatabase());
    const conversation = await repository.create({
      ownerSubjectId: 'rename-owner',
      spaceKind: 'notebook',
      spaceTitle: '未命名笔记本',
      conversationTitle: '未命名笔记本',
    });

    const renamed = await repository.renameOwned({
      conversationId: conversation.id,
      trustedSubjectId: 'rename-owner',
      title: '  分数函数复习  ',
      now: new Date('2026-07-25T08:00:00.000Z'),
    });
    expect(renamed?.title).toBe('分数函数复习');
    const [notebook] = await getDatabase()
      .select({ title: schema.spaces.title })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, conversation.spaceId))
      .limit(1);
    expect(notebook?.title).toBe('分数函数复习');
    await expect(
      getDatabase().select().from(schema.securityAuditEvents),
    ).resolves.toMatchObject([
      {
        actorUserId: 'rename-owner',
        eventType: 'notebook.renamed',
        resourceType: 'notebook',
        resourceId: conversation.spaceId,
        outcome: 'succeeded',
        metadata: { conversation_id: conversation.id },
      },
    ]);

    await expect(
      repository.renameOwned({
        conversationId: conversation.id,
        trustedSubjectId: 'rename-intruder',
        title: '越权改名',
      }),
    ).resolves.toBeNull();
    await expect(
      repository.getOwned({
        conversationId: conversation.id,
        trustedSubjectId: 'rename-owner',
      }),
    ).resolves.toMatchObject({ title: '分数函数复习' });
  });

  it('通用Turn幂等持久化并在终态后恢复，不创建教学Session', async () => {
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const turns = new DrizzlePlatformTurnRepository(getDatabase());
    const conversation = await conversations.create({
      ownerSubjectId: 'general-turn-user',
      spaceKind: 'notebook',
      spaceTitle: '未命名笔记本',
    });
    const started = await turns.createOrGetTurn({
      conversationId: conversation.id,
      trustedSubjectId: 'general-turn-user',
      clientMessageId: 'message-1',
      text: '帮我分析一个想法',
      now: new Date('2026-07-16T07:00:00.000Z'),
    });
    expect(started.replayed).toBe(false);
    expect(started.assistantMessage.status).toBe('streaming');
    const [operationIdentity] = await getDatabase()
      .select({
        actorUserId: schema.agentOperations.actorUserId,
        agentId: schema.agentOperations.agentId,
        notebookId: schema.agentOperations.notebookId,
      })
      .from(schema.agentOperations)
      .where(eq(schema.agentOperations.id, started.turnId))
      .limit(1);
    expect(operationIdentity).toMatchObject({
      actorUserId: 'general-turn-user',
      notebookId: conversation.spaceId,
    });
    expect(operationIdentity?.agentId).toBeTruthy();

    await turns.settleTurn({
      conversationId: conversation.id,
      trustedSubjectId: 'general-turn-user',
      turnId: started.turnId,
      status: 'completed',
      content: '当然，我们先明确目标。',
      now: new Date('2026-07-16T07:00:01.000Z'),
    });
    const replayed = await turns.createOrGetTurn({
      conversationId: conversation.id,
      trustedSubjectId: 'general-turn-user',
      clientMessageId: 'message-1',
      text: '帮我分析一个想法',
    });
    expect(replayed).toMatchObject({
      turnId: started.turnId,
      replayed: true,
      assistantMessage: {
        status: 'completed',
        content: '当然，我们先明确目标。',
      },
    });
    const [notebook] = await getDatabase()
      .select({ title: schema.spaces.title, kind: schema.spaces.kind })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, conversation.spaceId))
      .limit(1);
    expect(notebook).toEqual({
      title: '帮我分析一个想法',
      kind: 'notebook',
    });
    expect(await getDatabase().select().from(schema.lessonSessions)).toEqual(
      [],
    );
  });

  it('网页来源按多轮读取顺序冻结编号，消息只持久化正文实际引用子集', async () => {
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const turns = new DrizzlePlatformTurnRepository(getDatabase());
    const assets = new DrizzleAssetRepository(getDatabase());
    const sources = new DrizzlePlatformSourceRepository(getDatabase());
    const conversation = await conversations.create({
      ownerSubjectId: 'web-source-user',
      spaceKind: 'personal',
      spaceTitle: '网页研究',
    });
    const started = await turns.createOrGetTurn({
      conversationId: conversation.id,
      trustedSubjectId: 'web-source-user',
      clientMessageId: 'web-research-1',
      text: '比较两个网页的结论',
    });
    const firstAsset = await assets.createUploaded({
      ownerSubjectId: 'web-source-user',
      spaceId: conversation.spaceId,
      scope: 'space',
      kind: 'link',
      origin: 'url_import',
      displayName: '网页甲',
      mimeType: 'text/plain',
      byteSize: 6,
      contentHash: 'a'.repeat(64),
      storageKey: 'tests/web-source-a.txt',
      extractedText: '甲正文',
      outcome: { status: 'ready' },
    });
    const secondAsset = await assets.createUploaded({
      ownerSubjectId: 'web-source-user',
      spaceId: conversation.spaceId,
      scope: 'space',
      kind: 'link',
      origin: 'url_import',
      displayName: '网页乙',
      mimeType: 'text/plain',
      byteSize: 6,
      contentHash: 'b'.repeat(64),
      storageKey: 'tests/web-source-b.txt',
      extractedText: '乙正文',
      outcome: { status: 'ready' },
    });
    if (!firstAsset.version || !secondAsset.version) {
      throw new Error('测试网页Asset版本创建失败');
    }
    const first = await sources.createOrGetWebSource({
      conversationId: conversation.id,
      trustedSubjectId: 'web-source-user',
      operationId: started.turnId,
      assetId: firstAsset.descriptor.assetId,
      assetVersionId: firstAsset.version.versionId,
      label: '网页甲',
      url: 'https://example.com/a#section',
    });
    const second = await sources.createOrGetWebSource({
      conversationId: conversation.id,
      trustedSubjectId: 'web-source-user',
      operationId: started.turnId,
      assetId: secondAsset.descriptor.assetId,
      assetVersionId: secondAsset.version.versionId,
      label: '网页乙',
      url: 'https://example.com/b',
    });
    const replayedFirst = await sources.createOrGetWebSource({
      conversationId: conversation.id,
      trustedSubjectId: 'web-source-user',
      operationId: started.turnId,
      assetId: firstAsset.descriptor.assetId,
      assetVersionId: firstAsset.version.versionId,
      label: '网页甲',
      url: 'https://example.com/a',
    });
    expect([first.ordinal, second.ordinal, replayedFirst.ordinal]).toEqual([
      1, 2, 1,
    ]);

    const settledWithCitations = await turns.settleTurn({
      conversationId: conversation.id,
      trustedSubjectId: 'web-source-user',
      turnId: started.turnId,
      status: 'completed',
      content: '最终只采用网页乙的结论 [2]。',
      sourceMarkers: [2],
    });
    expect(settledWithCitations.settledCitations).toMatchObject([
      {
        assistantMessageId: started.assistantMessage.id,
        ordinal: 2,
        assetId: secondAsset.descriptor.assetId,
        assetVersionId: secondAsset.version.versionId,
        label: '网页乙',
        url: 'https://example.com/b',
      },
    ]);
    expect(
      await sources.listOwnedConversationCitations({
        conversationId: conversation.id,
        trustedSubjectId: 'web-source-user',
      }),
    ).toMatchObject([
      {
        assistantMessageId: started.assistantMessage.id,
        ordinal: 2,
        assetId: secondAsset.descriptor.assetId,
        assetVersionId: secondAsset.version.versionId,
        label: '网页乙',
        url: 'https://example.com/b',
      },
    ]);
    expect(
      await assets.listOwnedSpace({
        ownerSubjectId: 'web-source-user',
        spaceId: conversation.spaceId,
      }),
    ).toHaveLength(2);
  });

  it('拒绝相同clientMessageId绑定不同通用消息内容', async () => {
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const turns = new DrizzlePlatformTurnRepository(getDatabase());
    const conversation = await conversations.create({
      ownerSubjectId: 'idempotency-user',
      spaceKind: 'personal',
      spaceTitle: '通用对话',
    });
    await turns.createOrGetTurn({
      conversationId: conversation.id,
      trustedSubjectId: 'idempotency-user',
      clientMessageId: 'stable-id',
      text: '第一条内容',
    });
    await expect(
      turns.createOrGetTurn({
        conversationId: conversation.id,
        trustedSubjectId: 'idempotency-user',
        clientMessageId: 'stable-id',
        text: '不同内容',
      }),
    ).rejects.toBeInstanceOf(PlatformMessageIdConflictError);
  });

  it('通用Turn取消以数据库事实收敛，并拒绝跨主体取消', async () => {
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const turns = new DrizzlePlatformTurnRepository(getDatabase());
    const conversation = await conversations.create({
      ownerSubjectId: 'cancel-owner',
      spaceKind: 'personal',
      spaceTitle: '可取消对话',
    });
    const started = await turns.createOrGetTurn({
      conversationId: conversation.id,
      trustedSubjectId: 'cancel-owner',
      clientMessageId: 'cancel-message',
      text: '生成一个较长回答',
      now: new Date('2026-07-16T08:00:00.000Z'),
    });

    expect(
      await turns.requestTurnCancellation({
        trustedSubjectId: 'other-owner',
        turnId: started.turnId,
      }),
    ).toEqual({ turn: null, accepted: false });
    const requested = await turns.requestTurnCancellation({
      trustedSubjectId: 'cancel-owner',
      turnId: started.turnId,
      now: new Date('2026-07-16T08:00:01.000Z'),
    });
    expect(requested.accepted).toBe(true);
    expect(requested.turn?.cancelRequestedAt).toBe('2026-07-16T08:00:01.000Z');
    expect(
      await turns.isTurnCancellationRequested({
        trustedSubjectId: 'cancel-owner',
        turnId: started.turnId,
      }),
    ).toBe(true);

    const settled = await turns.settleTurn({
      conversationId: conversation.id,
      trustedSubjectId: 'cancel-owner',
      turnId: started.turnId,
      status: 'cancelled',
      content: '部分回答',
      failureCode: 'aborted',
      now: new Date('2026-07-16T08:00:02.000Z'),
    });
    expect(settled.assistantMessage).toMatchObject({
      status: 'cancelled',
      content: '部分回答',
      failureCode: 'aborted',
    });
  });

  it.each([
    {
      name: 'completed',
      terminal: { status: 'completed' as const },
      failureCode: null,
      retryable: undefined,
    },
    {
      name: 'failed',
      terminal: {
        status: 'failed' as const,
        code: 'RUNTIME_FAILED' as const,
        retryable: true,
      },
      failureCode: 'RUNTIME_FAILED',
      retryable: true,
    },
    {
      name: 'cancelled',
      terminal: { status: 'cancelled' as const },
      failureCode: 'CANCELLED',
      retryable: undefined,
    },
  ])(
    'Gateway $name消息结算后的append故障可由begin/listEvents幂等收敛',
    async ({ name, terminal, failureCode, retryable }) => {
      const ownerSubjectId = `gateway-terminal-${name}`;
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const identities = new DrizzleGatewayIdentityRepository(getDatabase());
      const turns = new DrizzlePlatformTurnRepository(getDatabase());
      const firstStore = new DrizzleGatewayOperationStore(getDatabase());
      const assets = new DrizzleAssetRepository(getDatabase());
      const sources = new DrizzlePlatformSourceRepository(getDatabase());
      const conversation = await conversations.create({
        ownerSubjectId,
        spaceKind: 'notebook',
        spaceTitle: `Gateway ${name}`,
      });
      const owner = await identities.getActive(ownerSubjectId);
      if (!owner) throw new Error('Gateway terminal fixture缺少主体');
      const route = {
        actorUserId: owner.userId,
        agentId: owner.agentId,
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
        agentProfileId: 'general',
        membershipRole: 'owner' as const,
      };
      const now = new Date('2026-08-12T10:00:00.000Z');
      const fingerprint =
        name === 'completed' ? 'a' : name === 'failed' ? 'b' : 'c';
      const operation = await firstStore.begin({
        envelopeId: `gateway-terminal:${name}`,
        idempotencyKey: `gateway-terminal:${name}`,
        requestFingerprint: fingerprint.repeat(64),
        route,
        now,
      });
      await firstStore.append(
        operation.operationId,
        { type: 'operation.accepted' },
        now,
      );
      if (terminal.status === 'cancelled') {
        await firstStore.requestCancellation({
          operationId: operation.operationId,
          actorUserId: owner.userId,
          now: new Date(now.getTime() + 1_000),
        });
      }
      let sourceMarkers: number[] = [];
      if (terminal.status === 'completed') {
        const asset = await assets.createUploaded({
          ownerSubjectId: owner.userId,
          spaceId: conversation.spaceId,
          scope: 'space',
          kind: 'link',
          origin: 'url_import',
          displayName: '终态对账来源',
          mimeType: 'text/plain',
          byteSize: 8,
          contentHash: 'd'.repeat(64),
          storageKey: `tests/gateway-terminal-${name}.txt`,
          extractedText: '可信来源',
          outcome: { status: 'ready' },
        });
        if (!asset.version)
          throw new Error('Gateway terminal fixture缺少Asset版本');
        const source = await sources.createOrGetWebSource({
          conversationId: conversation.id,
          trustedSubjectId: owner.userId,
          operationId: operation.operationId,
          assetId: asset.descriptor.assetId,
          assetVersionId: asset.version.versionId,
          label: '终态对账来源',
          url: 'https://example.com/gateway-terminal',
        });
        sourceMarkers = [source.ordinal];
      }
      const turn = await turns.attachGatewayTurn({
        operationId: operation.operationId,
        conversationId: conversation.id,
        trustedSubjectId: owner.userId,
        clientMessageId: `gateway-terminal:${name}`,
        text: `测试 ${name} 终态`,
        now,
      });
      await firstStore.append(
        operation.operationId,
        {
          type: 'message.started',
          userMessageId: turn.studentMessage.id,
          assistantMessageId: turn.assistantMessage.id,
          replayed: false,
        },
        now,
      );
      const gatewayTerminalIntent =
        terminal.status === 'completed'
          ? { ...terminal, messageId: turn.assistantMessage.id }
          : terminal;
      await expect(
        turns.settleTurn({
          conversationId: conversation.id,
          trustedSubjectId: owner.userId,
          turnId: operation.operationId,
          status: terminal.status,
          content:
            terminal.status === 'completed' ? '最终回答' : '安全的部分回答',
          failureCode,
          sourceMarkers,
          now: new Date(now.getTime() + 2_000),
        }),
      ).rejects.toThrow('Gateway附着Turn只能由Gateway写入Operation终态');
      await turns.settleTurn({
        conversationId: conversation.id,
        trustedSubjectId: owner.userId,
        turnId: operation.operationId,
        status: terminal.status,
        content:
          terminal.status === 'completed' ? '最终回答' : '安全的部分回答',
        failureCode,
        sourceMarkers,
        operationTerminalWriter: 'gateway',
        gatewayTerminalIntent,
        now: new Date(now.getTime() + 2_000),
      });
      if (terminal.status === 'cancelled') {
        // Isolate the acknowledgement-gap control-plane assertion from the earlier runtime cancel.
        await getDatabase()
          .update(schema.agentOperations)
          .set({ cancelRequestedAt: null })
          .where(eq(schema.agentOperations.id, operation.operationId));
      }

      const [beforeRecovery] = await getDatabase()
        .select({
          status: schema.agentOperations.status,
          assistantStatus: schema.conversationMessages.status,
        })
        .from(schema.agentOperations)
        .innerJoin(
          schema.conversationMessages,
          eq(
            schema.conversationMessages.operationId,
            schema.agentOperations.id,
          ),
        )
        .where(
          sql`${schema.agentOperations.id} = ${operation.operationId} and ${schema.conversationMessages.role} = 'assistant'`,
        );
      expect(beforeRecovery).toMatchObject({
        status: 'running',
        assistantStatus: terminal.status,
      });
      expect(
        await getDatabase()
          .select()
          .from(schema.gatewayOperationEvents)
          .where(
            sql`${schema.gatewayOperationEvents.operationId} = ${operation.operationId} and ${schema.gatewayOperationEvents.type} like 'operation.%' and ${schema.gatewayOperationEvents.type} <> 'operation.accepted'`,
          ),
      ).toHaveLength(0);

      if (terminal.status === 'completed') {
        const legacyStore = new DrizzleGatewayOperationStore(getDatabase(), {
          terminalReconciliationMode: 'legacy-disabled',
        });
        await expect(
          legacyStore.describe(operation.operationId, owner.userId),
        ).resolves.toMatchObject({ status: 'running' });
        await expect(legacyStore.listRecent(owner.userId)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              operationId: operation.operationId,
              status: 'running',
            }),
          ]),
        );
      }

      // 新Store模拟进程重启；三个控制面入口分别成为各终态的首次收敛触发点。
      const restartedStore = new DrizzleGatewayOperationStore(getDatabase());
      if (terminal.status === 'completed') {
        await expect(
          restartedStore.describe(
            operation.operationId,
            owner.userId,
            new Date(now.getTime() + 3_000),
          ),
        ).resolves.toMatchObject({ status: 'completed' });
      } else if (terminal.status === 'failed') {
        await expect(
          restartedStore.listRecent(
            owner.userId,
            20,
            new Date(now.getTime() + 3_000),
          ),
        ).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              operationId: operation.operationId,
              status: 'failed',
            }),
          ]),
        );
      } else {
        await expect(
          restartedStore.requestCancellation({
            operationId: operation.operationId,
            actorUserId: owner.userId,
            now: new Date(now.getTime() + 3_000),
          }),
        ).resolves.toEqual({ recorded: false, continuation: 'none' });
        const [cancelState] = await getDatabase()
          .select({
            cancelRequestedAt: schema.agentOperations.cancelRequestedAt,
          })
          .from(schema.agentOperations)
          .where(eq(schema.agentOperations.id, operation.operationId));
        expect(cancelState?.cancelRequestedAt).toBeNull();
      }
      await expect(
        restartedStore.begin({
          envelopeId: `gateway-terminal:${name}`,
          idempotencyKey: `gateway-terminal:${name}`,
          requestFingerprint: fingerprint.repeat(64),
          route,
          now: new Date(now.getTime() + 3_000),
        }),
      ).resolves.toMatchObject({
        operationId: operation.operationId,
        status: terminal.status,
        replayed: true,
      });
      const events = await restartedStore.listEvents(
        operation.operationId,
        -1,
        owner.userId,
        new Date(now.getTime() + 4_000),
      );
      const terminalEvents = events.filter((event) =>
        [
          'operation.completed',
          'operation.failed',
          'operation.cancelled',
        ].includes(event.type),
      );
      expect(terminalEvents).toHaveLength(1);
      expect(terminalEvents[0]).toMatchObject({
        type: `operation.${terminal.status}`,
        ...(retryable === undefined ? {} : { retryable }),
      });
      const persistedCitations = await getDatabase()
        .select()
        .from(schema.conversationMessageCitations)
        .where(
          eq(
            schema.conversationMessageCitations.assistantMessageId,
            turn.assistantMessage.id,
          ),
        );
      expect(persistedCitations).toHaveLength(
        terminal.status === 'completed' ? 1 : 0,
      );
      expect(
        await restartedStore.append(
          operation.operationId,
          terminal.status === 'completed'
            ? {
                type: 'operation.completed',
                messageId: turn.assistantMessage.id,
              }
            : terminal.status === 'failed'
              ? {
                  type: 'operation.failed',
                  code: terminal.code,
                  retryable: terminal.retryable,
                }
              : { type: 'operation.cancelled' },
          new Date(now.getTime() + 5_000),
        ),
      ).toEqual(terminalEvents[0]);
      // Terminal append 已提交但响应丢失：新进程的所有控制面读取/取消仍只观察唯一终态。
      const ackLostRestart = new DrizzleGatewayOperationStore(getDatabase());
      await expect(
        ackLostRestart.describe(operation.operationId, owner.userId),
      ).resolves.toMatchObject({ status: terminal.status });
      await expect(ackLostRestart.listRecent(owner.userId)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operationId: operation.operationId,
            status: terminal.status,
          }),
        ]),
      );
      await expect(
        ackLostRestart.requestCancellation({
          operationId: operation.operationId,
          actorUserId: owner.userId,
          now: new Date(now.getTime() + 5_500),
        }),
      ).resolves.toEqual({ recorded: false, continuation: 'none' });
      expect(
        (
          await restartedStore.listEvents(
            operation.operationId,
            -1,
            owner.userId,
            new Date(now.getTime() + 6_000),
          )
        ).filter((event) =>
          [
            'operation.completed',
            'operation.failed',
            'operation.cancelled',
          ].includes(event.type),
        ),
      ).toHaveLength(1);

      const conflictingPayload =
        terminal.status === 'completed'
          ? {
              type: 'operation.completed' as const,
              messageId: '00000000-0000-4000-8000-000000000099',
            }
          : terminal.status === 'failed'
            ? {
                type: 'operation.failed' as const,
                code: terminal.code,
                retryable: !terminal.retryable,
              }
            : {
                type: 'operation.completed' as const,
                messageId: turn.assistantMessage.id,
              };
      await expect(
        restartedStore.append(
          operation.operationId,
          conflictingPayload,
          new Date(now.getTime() + 7_000),
        ),
      ).rejects.toBeInstanceOf(GatewayPersistenceError);
    },
  );

  it('Gateway completed event不能把active assistant猜成已完成正文', async () => {
    const ownerSubjectId = 'gateway-event-first-completed';
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const identities = new DrizzleGatewayIdentityRepository(getDatabase());
    const turns = new DrizzlePlatformTurnRepository(getDatabase());
    const store = new DrizzleGatewayOperationStore(getDatabase());
    const conversation = await conversations.create({
      ownerSubjectId,
      spaceKind: 'notebook',
      spaceTitle: 'Gateway event-first完成',
    });
    const owner = await identities.getActive(ownerSubjectId);
    if (!owner) throw new Error('Gateway completed fixture缺少主体');
    const route = {
      actorUserId: owner.userId,
      agentId: owner.agentId,
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
      agentProfileId: 'general',
      membershipRole: 'owner' as const,
    };
    const now = new Date('2026-08-12T10:30:00.000Z');
    const operation = await store.begin({
      envelopeId: 'gateway-event-first:completed',
      idempotencyKey: 'gateway-event-first:completed',
      requestFingerprint: 'f'.repeat(64),
      route,
      now,
    });
    const turn = await turns.attachGatewayTurn({
      operationId: operation.operationId,
      conversationId: conversation.id,
      trustedSubjectId: owner.userId,
      clientMessageId: 'gateway-event-first:completed',
      text: '不要猜最终正文',
      now,
    });
    await store.append(
      operation.operationId,
      { type: 'operation.accepted' },
      now,
    );
    await store.append(
      operation.operationId,
      {
        type: 'message.started',
        userMessageId: turn.studentMessage.id,
        assistantMessageId: turn.assistantMessage.id,
        replayed: false,
      },
      now,
    );
    await store.append(
      operation.operationId,
      {
        type: 'operation.completed',
        messageId: turn.assistantMessage.id,
      },
      new Date(now.getTime() + 1_000),
    );

    await expect(
      new DrizzleGatewayOperationStore(getDatabase()).begin({
        envelopeId: 'gateway-event-first:completed',
        idempotencyKey: 'gateway-event-first:completed',
        requestFingerprint: 'f'.repeat(64),
        route,
        now: new Date(now.getTime() + 2_000),
      }),
    ).rejects.toBeInstanceOf(GatewayPersistenceError);
    expect(
      await getDatabase()
        .select({
          status: schema.conversationMessages.status,
          content: schema.conversationMessages.content,
        })
        .from(schema.conversationMessages)
        .where(eq(schema.conversationMessages.id, turn.assistantMessage.id)),
    ).toEqual([{ status: 'streaming', content: '' }]);
  });

  it('Gateway取消event先落账时由重启Store补齐assistant且不重跑模型或工具', async () => {
    const ownerSubjectId = 'gateway-event-first-cancel';
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const identities = new DrizzleGatewayIdentityRepository(getDatabase());
    const turns = new DrizzlePlatformTurnRepository(getDatabase());
    const firstStore = new DrizzleGatewayOperationStore(getDatabase());
    const conversation = await conversations.create({
      ownerSubjectId,
      spaceKind: 'notebook',
      spaceTitle: 'Gateway event-first取消',
    });
    const owner = await identities.getActive(ownerSubjectId);
    if (!owner) throw new Error('Gateway event-first fixture缺少主体');
    const route = {
      actorUserId: owner.userId,
      agentId: owner.agentId,
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
      agentProfileId: 'general',
      membershipRole: 'owner' as const,
    };
    const now = new Date('2026-08-12T11:00:00.000Z');
    const operation = await firstStore.begin({
      envelopeId: 'gateway-event-first:cancel',
      idempotencyKey: 'gateway-event-first:cancel',
      requestFingerprint: 'e'.repeat(64),
      route,
      now,
    });
    await firstStore.append(
      operation.operationId,
      { type: 'operation.accepted' },
      now,
    );
    const turn = await turns.attachGatewayTurn({
      operationId: operation.operationId,
      conversationId: conversation.id,
      trustedSubjectId: owner.userId,
      clientMessageId: 'gateway-event-first:cancel',
      text: '取消这个长回答',
      now,
    });
    await firstStore.append(
      operation.operationId,
      {
        type: 'message.started',
        userMessageId: turn.studentMessage.id,
        assistantMessageId: turn.assistantMessage.id,
        replayed: false,
      },
      now,
    );
    await firstStore.requestCancellation({
      operationId: operation.operationId,
      actorUserId: owner.userId,
      now: new Date(now.getTime() + 1_000),
    });
    await firstStore.append(
      operation.operationId,
      { type: 'operation.cancelled' },
      new Date(now.getTime() + 2_000),
    );

    const [beforeRestart] = await getDatabase()
      .select({
        operationStatus: schema.agentOperations.status,
        operationFailureCode: schema.agentOperations.failureCode,
        assistantStatus: schema.conversationMessages.status,
        assistantFailureCode: schema.conversationMessages.failureCode,
        assistantContent: schema.conversationMessages.content,
      })
      .from(schema.agentOperations)
      .innerJoin(
        schema.conversationMessages,
        eq(schema.conversationMessages.operationId, schema.agentOperations.id),
      )
      .where(
        sql`${schema.agentOperations.id} = ${operation.operationId} and ${schema.conversationMessages.role} = 'assistant'`,
      );
    expect(beforeRestart).toEqual({
      operationStatus: 'cancelled',
      operationFailureCode: null,
      assistantStatus: 'streaming',
      assistantFailureCode: null,
      assistantContent: '',
    });
    expect(
      await getDatabase()
        .select()
        .from(schema.modelRuns)
        .where(eq(schema.modelRuns.agentOperationId, operation.operationId)),
    ).toHaveLength(0);
    expect(
      await getDatabase()
        .select()
        .from(schema.toolCalls)
        .where(eq(schema.toolCalls.agentOperationId, operation.operationId)),
    ).toHaveLength(0);

    await getDatabase()
      .update(schema.conversationMessages)
      .set({ content: '未经最终结算的模型片段' })
      .where(eq(schema.conversationMessages.id, turn.assistantMessage.id));
    const unsafeRestart = new DrizzleGatewayOperationStore(getDatabase());
    await expect(
      unsafeRestart.begin({
        envelopeId: 'gateway-event-first:cancel',
        idempotencyKey: 'gateway-event-first:cancel',
        requestFingerprint: 'e'.repeat(64),
        route,
        now: new Date(now.getTime() + 3_000),
      }),
    ).rejects.toBeInstanceOf(GatewayPersistenceError);
    expect(
      await getDatabase()
        .select({
          status: schema.conversationMessages.status,
          content: schema.conversationMessages.content,
        })
        .from(schema.conversationMessages)
        .where(eq(schema.conversationMessages.id, turn.assistantMessage.id)),
    ).toEqual([{ status: 'streaming', content: '未经最终结算的模型片段' }]);
    await getDatabase()
      .update(schema.conversationMessages)
      .set({ content: '' })
      .where(eq(schema.conversationMessages.id, turn.assistantMessage.id));

    const restartedStore = new DrizzleGatewayOperationStore(getDatabase());
    await expect(
      restartedStore.begin({
        envelopeId: 'gateway-event-first:cancel',
        idempotencyKey: 'gateway-event-first:cancel',
        requestFingerprint: 'e'.repeat(64),
        route,
        now: new Date(now.getTime() + 3_000),
      }),
    ).resolves.toMatchObject({
      operationId: operation.operationId,
      status: 'cancelled',
      replayed: true,
    });
    const firstReplay = await restartedStore.listEvents(
      operation.operationId,
      -1,
      owner.userId,
      new Date(now.getTime() + 4_000),
    );
    expect(
      firstReplay.filter((event) => event.type === 'operation.cancelled'),
    ).toHaveLength(1);
    const [afterRestart] = await getDatabase()
      .select({
        status: schema.conversationMessages.status,
        content: schema.conversationMessages.content,
        failureCode: schema.conversationMessages.failureCode,
        completedAt: schema.conversationMessages.completedAt,
      })
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.operationId, operation.operationId),
          eq(schema.conversationMessages.role, 'assistant'),
        ),
      );
    expect(afterRestart).toMatchObject({
      status: 'cancelled',
      content: '',
      failureCode: 'CANCELLED',
    });
    expect(afterRestart?.completedAt).toEqual(new Date(now.getTime() + 3_000));

    const secondRestart = new DrizzleGatewayOperationStore(getDatabase());
    await expect(
      secondRestart.begin({
        envelopeId: 'gateway-event-first:cancel',
        idempotencyKey: 'gateway-event-first:cancel',
        requestFingerprint: 'e'.repeat(64),
        route,
        now: new Date(now.getTime() + 5_000),
      }),
    ).resolves.toMatchObject({ status: 'cancelled', replayed: true });
    const secondReplay = await secondRestart.listEvents(
      operation.operationId,
      -1,
      owner.userId,
      new Date(now.getTime() + 6_000),
    );
    expect(
      secondReplay.filter((event) => event.type === 'operation.cancelled'),
    ).toHaveLength(1);
    expect(
      await getDatabase()
        .select()
        .from(schema.modelRuns)
        .where(eq(schema.modelRuns.agentOperationId, operation.operationId)),
    ).toHaveLength(0);
    expect(
      await getDatabase()
        .select()
        .from(schema.toolCalls)
        .where(eq(schema.toolCalls.agentOperationId, operation.operationId)),
    ).toHaveLength(0);
  });
});
