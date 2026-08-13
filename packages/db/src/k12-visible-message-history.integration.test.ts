import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleChatRepository } from './chat-repository';
import { DrizzleKnowledgeRetrievalRepository } from './knowledge-retrieval-repository';
import {
  resolveK12ConversationAuthorityContract,
  type K12ConversationAuthorityStage,
} from './k12-conversation-dual-write';
import { deterministicConversationMessageId } from './k12-conversation-message-identity';
import {
  DrizzleK12VisibleMessageHistoryRepository,
  K12VisibleHistoryConsistencyError,
} from './k12-visible-message-history';
import * as schema from './schema';

function resolveTestDatabaseUrl(value = process.env.TEST_DATABASE_URL) {
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
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 10, onnotice: () => undefined })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

const id = (value: number) =>
  `71000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const studentId = 'visible-history-student';
const otherStudentId = 'visible-history-other-student';
const sessionId = id(1);
const conversationId = id(2);
const secretBody = '不可泄露的消息正文';
const baseTime = new Date('2026-08-13T06:00:00.000Z');

describe('K12 可见历史集成测试数据库门禁', () => {
  it('拒绝非 integration/test 数据库名', () => {
    expect(() =>
      resolveTestDatabaseUrl(
        'postgresql://fixture:fixture@127.0.0.1:5434/educanvas',
      ),
    ).toThrow('拒绝清空非测试数据库');
  });
});

function authority(stage: K12ConversationAuthorityStage) {
  return resolveK12ConversationAuthorityContract({
    EDUCANVAS_K12_CONVERSATION_AUTHORITY_STAGE: stage,
  });
}

function repository(stage: K12ConversationAuthorityStage) {
  return new DrizzleK12VisibleMessageHistoryRepository({
    database: getDatabase(),
    authority: authority(stage),
  });
}

async function seedScope() {
  await getDatabase()
    .insert(schema.platformUsers)
    .values([
      { id: studentId, kind: 'registered', status: 'active' },
      { id: otherStudentId, kind: 'registered', status: 'active' },
    ]);
  const [space] = await getDatabase()
    .insert(schema.spaces)
    .values({
      ownerSubjectId: studentId,
      kind: 'personal',
      title: '可见历史测试空间',
      createdAt: baseTime,
      updatedAt: baseTime,
    })
    .returning({ id: schema.spaces.id });
  if (!space) throw new Error('测试空间创建失败');
  await getDatabase().insert(schema.conversations).values({
    id: conversationId,
    spaceId: space.id,
    ownerSubjectId: studentId,
    lastActivityAt: baseTime,
    createdAt: baseTime,
    updatedAt: baseTime,
  });
  await getDatabase().insert(schema.lessonSessions).values({
    id: sessionId,
    conversationId,
    studentId,
    gradeBand: 'middle_school',
    courseSlug: 'visible-history',
    knowledgeNodeId: 'projection',
    state: 'EXPLAIN',
    status: 'active',
    lastActivityAt: baseTime,
    createdAt: baseTime,
    updatedAt: baseTime,
  });
}

type SeedMessage = {
  sequence: number;
  role: 'student' | 'assistant';
  status?:
    | 'pending'
    | 'streaming'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  content?: string;
  createdAt?: Date;
};

async function seedProjectedMessage(input: SeedMessage) {
  const messageId = id(100 + input.sequence);
  const platformMessageId = deterministicConversationMessageId(messageId);
  const turnId = id(300 + input.sequence);
  const status = input.status ?? 'completed';
  const content = input.content ?? `message-${input.sequence}`;
  const createdAt =
    input.createdAt ?? new Date(baseTime.getTime() + input.sequence);
  const terminal = !['pending', 'streaming'].includes(status);
  const completedAt = terminal ? createdAt : null;
  const cancelledAt = status === 'cancelled' ? createdAt : null;
  const leaseId =
    terminal || input.role === 'student' ? null : id(400 + input.sequence);

  await getDatabase()
    .insert(schema.chatMessages)
    .values({
      id: messageId,
      sessionId,
      turnId,
      clientMessageId:
        input.role === 'student' ? `client-${input.sequence}` : null,
      requestHash: input.role === 'student' ? 'a'.repeat(64) : null,
      role: input.role,
      status,
      content,
      failureCode: status === 'failed' ? 'fixture_failed' : null,
      createdAt,
      completedAt,
      cancelRequestedAt: cancelledAt,
      cancelledAt,
      leaseId,
      leaseExpiresAt: leaseId ? new Date(createdAt.getTime() + 60_000) : null,
      heartbeatAt: leaseId ? createdAt : null,
    });
  await getDatabase()
    .insert(schema.conversationMessages)
    .values({
      id: platformMessageId,
      conversationId,
      operationId: null,
      role: input.role === 'student' ? 'user' : 'assistant',
      status,
      content,
      parts: content.trim() ? [{ type: 'text', text: content }] : [],
      failureCode: status === 'failed' ? 'fixture_failed' : null,
      createdAt,
      completedAt,
    });
  await getDatabase().insert(schema.k12ConversationMessageProjections).values({
    sourceChatMessageId: messageId,
    conversationMessageId: platformMessageId,
    sessionId,
    conversationId,
    createdAt,
  });
  return { messageId, platformMessageId, turnId };
}

async function expectConsistencyFailure(action: () => Promise<unknown>) {
  let failure: unknown;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(K12VisibleHistoryConsistencyError);
  expect(failure).toMatchObject({
    code: 'k12_message_projection_inconsistent',
  });
  expect(String(failure)).not.toContain(secretBody);
}

describeWithDatabase('K12 platform 可见消息历史', () => {
  // begin/backfill 的重复执行幂等已由
  // k12-conversation-dual-write.integration.test.ts 负责；本套件只固定切读契约。
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table
        platform_users,
        knowledge_sources,
        k12_conversation_message_projections,
        conversation_messages,
        chat_messages,
        lesson_sessions,
        conversations,
        spaces
      restart identity cascade
    `);
    await seedScope();
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('legacy 与 platform 保持公开身份、turn、client、顺序、cursor 和最近历史完全一致', async () => {
    const sameTimestamp = new Date('2026-08-13T06:01:00.000Z');
    await seedProjectedMessage({
      sequence: 1,
      role: 'student',
      createdAt: sameTimestamp,
    });
    await seedProjectedMessage({
      sequence: 2,
      role: 'assistant',
      createdAt: sameTimestamp,
    });
    await seedProjectedMessage({ sequence: 3, role: 'student' });
    await seedProjectedMessage({ sequence: 4, role: 'assistant' });

    const legacy = repository('legacy');
    const platform = repository('platform');
    const legacyFirst = await legacy.listHistory({
      sessionId,
      trustedStudentId: studentId,
      limit: 2,
    });
    const platformFirst = await platform.listHistory({
      sessionId,
      trustedStudentId: studentId,
      limit: 2,
    });
    expect(platformFirst).toEqual(legacyFirst);

    const legacySecond = await legacy.listHistory({
      sessionId,
      trustedStudentId: studentId,
      after: legacyFirst.nextCursor,
      limit: 2,
    });
    const platformSecond = await platform.listHistory({
      sessionId,
      trustedStudentId: studentId,
      after: platformFirst.nextCursor,
      limit: 2,
    });
    expect(platformSecond).toEqual(legacySecond);
    expect(
      [...platformFirst.messages, ...platformSecond.messages].map((row) => ({
        id: row.id,
        turnId: row.turnId,
        clientMessageId: row.clientMessageId,
      })),
    ).toEqual(
      [...legacyFirst.messages, ...legacySecond.messages].map((row) => ({
        id: row.id,
        turnId: row.turnId,
        clientMessageId: row.clientMessageId,
      })),
    );
    await expect(
      platform.listRecentHistory({
        sessionId,
        trustedStudentId: studentId,
        limit: 3,
      }),
    ).resolves.toEqual(
      await legacy.listRecentHistory({
        sessionId,
        trustedStudentId: studentId,
        limit: 3,
      }),
    );
  });

  it.each([
    'completed',
    'failed',
    'cancelled',
    'interrupted',
    'pending',
    'streaming',
  ] as const)('从平台字段投影 %s 状态', async (status) => {
    await seedProjectedMessage({ sequence: 10, role: 'assistant', status });
    const page = await repository('platform').listHistory({
      sessionId,
      trustedStudentId: studentId,
    });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.status).toBe(status);
  });

  it('0/1/N citation 都继续关联 legacy assistant message id', async () => {
    const zero = await seedProjectedMessage({
      sequence: 20,
      role: 'assistant',
    });
    const one = await seedProjectedMessage({ sequence: 21, role: 'assistant' });
    const many = await seedProjectedMessage({
      sequence: 22,
      role: 'assistant',
    });
    const sources = [1, 2, 3].map((n) => ({
      id: id(500 + n),
      gradeBand: 'middle_school',
      courseSlug: 'visible-history',
      sourceKey: `source-${n}`,
      title: `Source ${n}`,
      sourceType: 'fixture',
    }));
    await getDatabase().insert(schema.knowledgeSources).values(sources);
    for (const [index, source] of sources.entries()) {
      const n = index + 1;
      const documentId = id(600 + n);
      const chunkId = id(700 + n);
      const snapshotId = id(800 + n);
      const candidateId = id(900 + n);
      await getDatabase()
        .insert(schema.knowledgeDocuments)
        .values({
          id: documentId,
          sourceId: source.id,
          version: 1,
          contentHash: String(n).repeat(64),
          objectKey: `fixture/${n}`,
          parserVersion: 'fixture-v1',
          parseStatus: 'ready',
          parsedAt: baseTime,
        });
      await getDatabase()
        .insert(schema.knowledgeChunks)
        .values({
          id: chunkId,
          documentId,
          chunkIndex: 0,
          contentHash: String(n).repeat(64),
          content: `chunk-${n}`,
        });
      await getDatabase()
        .insert(schema.turnSourceVersions)
        .values({
          id: snapshotId,
          sessionId,
          turnId: n === 1 ? one.turnId : many.turnId,
          sourceId: source.id,
          documentId,
          documentVersion: 1,
          contentHash: String(n).repeat(64),
        });
      await getDatabase()
        .insert(schema.retrievalCandidates)
        .values({
          id: candidateId,
          sessionId,
          turnId: n === 1 ? one.turnId : many.turnId,
          turnSourceVersionId: snapshotId,
          chunkId,
          documentId,
          retriever: 'fixture',
          retrieverVersion: 'v1',
          rank: n,
          score: 0.9,
          queryHash: String(n).repeat(64),
          traceId: `trace-${n}`,
        });
      await getDatabase()
        .insert(schema.messageCitations)
        .values({
          sessionId,
          turnId: n === 1 ? one.turnId : many.turnId,
          assistantMessageId: n === 1 ? one.messageId : many.messageId,
          retrievalCandidateId: candidateId,
          ordinal: n === 1 ? 1 : n - 1,
        });
    }
    const counts = await getDatabase()
      .select({
        assistantMessageId: schema.chatMessages.id,
        count: sql<number>`count(${schema.messageCitations.id})::int`,
      })
      .from(schema.chatMessages)
      .leftJoin(
        schema.messageCitations,
        eq(schema.messageCitations.assistantMessageId, schema.chatMessages.id),
      )
      .where(
        sql`${schema.chatMessages.id} in (${zero.messageId}, ${one.messageId}, ${many.messageId})`,
      )
      .groupBy(schema.chatMessages.id);
    expect(
      Object.fromEntries(
        counts.map((row) => [row.assistantMessageId, row.count]),
      ),
    ).toEqual({
      [zero.messageId]: 0,
      [one.messageId]: 1,
      [many.messageId]: 2,
    });
    expect(counts.map((row) => row.assistantMessageId)).not.toContain(
      many.platformMessageId,
    );
    const visible = await repository('platform').listHistory({
      sessionId,
      trustedStudentId: studentId,
    });
    const visibleById = new Map(
      visible.messages.map((message) => [message.id, message]),
    );
    const citations = new DrizzleKnowledgeRetrievalRepository(getDatabase());
    await expect(
      Promise.all(
        [zero, one, many].map(async (message) => ({
          id: message.messageId,
          count: (
            await citations.listOwnedMessageCitations({
              trustedStudentId: studentId,
              sessionId,
              turnId: visibleById.get(message.messageId)?.turnId ?? '',
              assistantMessageId: visibleById.get(message.messageId)?.id ?? '',
            })
          ).length,
        })),
      ),
    ).resolves.toEqual([
      { id: zero.messageId, count: 0 },
      { id: one.messageId, count: 1 },
      { id: many.messageId, count: 2 },
    ]);
  });

  it.each(['missing mapping', 'missing platform', 'mapping orphan'] as const)(
    '%s 时 fail-closed 且不泄露正文',
    async (fault) => {
      const projected = await seedProjectedMessage({
        sequence: 30,
        role: 'assistant',
        content: secretBody,
      });
      if (fault === 'missing mapping') {
        await getDatabase()
          .delete(schema.k12ConversationMessageProjections)
          .where(
            eq(
              schema.k12ConversationMessageProjections.sourceChatMessageId,
              projected.messageId,
            ),
          );
      } else if (fault === 'missing platform') {
        await getDatabase()
          .delete(schema.conversationMessages)
          .where(
            eq(schema.conversationMessages.id, projected.platformMessageId),
          );
      } else {
        const orphanPlatformId = id(998);
        await getDatabase()
          .insert(schema.conversationMessages)
          .values({
            id: orphanPlatformId,
            conversationId,
            role: 'assistant',
            status: 'completed',
            content: 'orphan platform row',
            parts: [{ type: 'text', text: 'orphan platform row' }],
            createdAt: baseTime,
            completedAt: baseTime,
          });
        await getDatabase()
          .insert(schema.k12ConversationMessageProjections)
          .values({
            sourceChatMessageId: id(999),
            conversationMessageId: orphanPlatformId,
            sessionId,
            conversationId,
          });
      }
      await expectConsistencyFailure(() =>
        repository('platform').listHistory({
          sessionId,
          trustedStudentId: studentId,
        }),
      );
    },
  );

  it.each(['content', 'parts'] as const)(
    '%s mismatch 时抛稳定错误且 legacy rollback 仍可读',
    async (field) => {
      const projected = await seedProjectedMessage({
        sequence: 40,
        role: 'assistant',
        content: secretBody,
      });
      await getDatabase()
        .update(schema.conversationMessages)
        .set(
          field === 'content'
            ? { content: 'tampered' }
            : { parts: [{ type: 'text', text: 'tampered' }] },
        )
        .where(eq(schema.conversationMessages.id, projected.platformMessageId));
      await expectConsistencyFailure(() =>
        repository('platform').listHistory({
          sessionId,
          trustedStudentId: studentId,
        }),
      );
      const legacy = await repository('legacy').listHistory({
        sessionId,
        trustedStudentId: studentId,
      });
      expect(legacy.messages[0]?.content).toBe(secretBody);
    },
  );

  it('原生 conversation row 无 mapping 不误报', async () => {
    await seedProjectedMessage({ sequence: 50, role: 'assistant' });
    await getDatabase()
      .insert(schema.conversationMessages)
      .values({
        id: id(950),
        conversationId,
        role: 'assistant',
        status: 'completed',
        content: 'native platform message',
        parts: [{ type: 'text', text: 'native platform message' }],
        createdAt: baseTime,
        completedAt: baseTime,
      });
    await expect(
      repository('platform').listHistory({
        sessionId,
        trustedStudentId: studentId,
      }),
    ).resolves.toMatchObject({ messages: [{ id: id(150) }] });
  });

  it('拒绝跨 student 读取', async () => {
    await seedProjectedMessage({ sequence: 60, role: 'assistant' });
    await expect(
      repository('platform').listHistory({
        sessionId,
        trustedStudentId: otherStudentId,
      }),
    ).rejects.toMatchObject({ code: 'session_not_found' });
  });

  it('conversation owner与session主体漂移时按同一不可枚举边界拒绝', async () => {
    await seedProjectedMessage({ sequence: 61, role: 'assistant' });
    await getDatabase()
      .update(schema.conversations)
      .set({ ownerSubjectId: otherStudentId })
      .where(eq(schema.conversations.id, conversationId));
    await expect(
      repository('platform').listHistory({
        sessionId,
        trustedStudentId: studentId,
      }),
    ).rejects.toMatchObject({ code: 'session_not_found' });
  });

  it('authority在仓储构造时冻结，回退必须新建进程组合实例', async () => {
    await seedProjectedMessage({ sequence: 62, role: 'assistant' });
    const original = process.env.EDUCANVAS_K12_CONVERSATION_AUTHORITY_STAGE;
    try {
      process.env.EDUCANVAS_K12_CONVERSATION_AUTHORITY_STAGE = 'platform';
      const frozenPlatform = new DrizzleK12VisibleMessageHistoryRepository({
        database: getDatabase(),
      });
      process.env.EDUCANVAS_K12_CONVERSATION_AUTHORITY_STAGE = 'legacy';
      await getDatabase()
        .update(schema.conversationMessages)
        .set({ content: 'tampered after construction' })
        .where(
          eq(
            schema.conversationMessages.id,
            deterministicConversationMessageId(id(162)),
          ),
        );
      await expectConsistencyFailure(() =>
        frozenPlatform.listHistory({ sessionId, trustedStudentId: studentId }),
      );
      const restartedLegacy = new DrizzleK12VisibleMessageHistoryRepository({
        database: getDatabase(),
      });
      await expect(
        restartedLegacy.listHistory({
          sessionId,
          trustedStudentId: studentId,
        }),
      ).resolves.toMatchObject({ messages: [{ id: id(162) }] });
    } finally {
      if (original === undefined) {
        delete process.env.EDUCANVAS_K12_CONVERSATION_AUTHORITY_STAGE;
      } else {
        process.env.EDUCANVAS_K12_CONVERSATION_AUTHORITY_STAGE = original;
      }
    }
  });

  it('相同 timestamp 分页按公开 legacy id 前进且不重复', async () => {
    const timestamp = new Date('2026-08-13T06:30:00.000Z');
    for (const sequence of [70, 71, 72, 73]) {
      await seedProjectedMessage({
        sequence,
        role: 'assistant',
        createdAt: timestamp,
      });
    }
    const first = await repository('platform').listHistory({
      sessionId,
      trustedStudentId: studentId,
      limit: 2,
    });
    const second = await repository('platform').listHistory({
      sessionId,
      trustedStudentId: studentId,
      after: first.nextCursor,
      limit: 2,
    });
    const ids = [...first.messages, ...second.messages].map((row) => row.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(second.nextCursor).toBeNull();
  });
});
