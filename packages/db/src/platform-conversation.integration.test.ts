import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DrizzlePlatformConversationRepository,
  PlatformConversationOwnershipError,
} from './conversation-platform-repository';
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
      truncate table lesson_sessions, conversation_messages, agent_operations, conversations, spaces
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

  it('通用Turn幂等持久化并在终态后恢复，不创建教学Session', async () => {
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const turns = new DrizzlePlatformTurnRepository(getDatabase());
    const conversation = await conversations.create({
      ownerSubjectId: 'general-turn-user',
      spaceKind: 'personal',
      spaceTitle: '通用对话',
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
    expect(await getDatabase().select().from(schema.lessonSessions)).toEqual(
      [],
    );
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
});
