import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { DrizzleChatRepository } from './chat-repository';
import {
  dualWriteBeginMessages,
  isK12ConversationDualWriteEnabled,
} from './k12-conversation-dual-write';
import {
  deterministicConversationMessageId,
  K12ConversationDualWriteInvariantError,
} from './k12-conversation-message-identity';
import { auditK12Parity } from './k12-conversation-parity';
import * as schema from './schema';
import { DrizzleTeachingTurnLedger } from './turn-ledger-repository';

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
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 10, onnotice: () => undefined })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

const studentId = 'dual-write-student';
const sessionId = '60000000-0000-4000-8000-000000000001';
const conversationId = '60000000-0000-4000-8000-000000000010';
const knowledgeNodeId = 'dual-write-cat-dog';

const scope = {
  studentId,
  gradeBand: 'middle_school',
  courseSlug: 'dual-write-ai',
  knowledgeNodeId,
};

async function seedSessionWithConversation() {
  const now = new Date('2026-07-15T02:00:00.000Z');
  const [space] = await getDatabase()
    .insert(schema.spaces)
    .values({
      ownerSubjectId: studentId,
      kind: 'personal',
      title: '双写测试空间',
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.spaces.id });
  if (!space) throw new Error('Space 创建失败');
  await getDatabase().insert(schema.conversations).values({
    id: conversationId,
    spaceId: space.id,
    ownerSubjectId: studentId,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await getDatabase()
    .insert(schema.lessonSessions)
    .values({
      id: sessionId,
      conversationId,
      ...scope,
      state: 'EXPLAIN',
      status: 'active',
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
}

async function createTurn(
  clientMessageId = 'dual-write-msg-1',
  text = '猫和狗的图像特征有什么不同？',
  now = new Date('2026-07-15T02:01:00.000Z'),
) {
  const ledger = await new DrizzleTeachingTurnLedger(
    getDatabase(),
  ).beginOrReplay({
    sessionId,
    trustedStudentId: studentId,
    clientMessageId,
    text,
    traceId: `trace-${clientMessageId}`,
    modelAlias: 'primary',
    promptVersion: 'turn-v1',
    promptHash: 'a'.repeat(64),
    provider: 'fixture',
    now,
  });
  return {
    ...ledger.turn,
    replayed: ledger.replayed,
    answerRun: ledger.answerRun,
  };
}

describeWithDatabase('K12 消息双写', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table
        conversation_messages,
        model_runs,
        chat_messages,
        agent_message_parts,
        canvas_artifact_grading_keys,
        canvas_artifacts,
        learning_events,
        mastery_states,
        turn_context_snapshots,
        lesson_sessions,
        agent_operations,
        conversations,
        spaces
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  afterEach(() => {
    delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
  });

  describe('正常双写', () => {
    it('student/assistant 消息同时写入 chat_messages 和 conversation_messages', async () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';

      await seedSessionWithConversation();
      const turn = await createTurn();

      const chatRows = await getDatabase()
        .select()
        .from(schema.chatMessages)
        .where(sql`${schema.chatMessages.sessionId} = ${sessionId}`);
      expect(chatRows.length).toBe(2);

      const convRows = await getDatabase()
        .select()
        .from(schema.conversationMessages)
        .where(
          sql`${schema.conversationMessages.conversationId} = ${conversationId}`,
        );
      expect(convRows.length).toBe(2);

      const studentConv = convRows.find(
        (r) => r.role === 'user' && r.status === 'completed',
      );
      expect(studentConv).toBeDefined();
      expect(studentConv!.content).toBe('猫和狗的图像特征有什么不同？');

      const assistantConv = convRows.find(
        (r) => r.role === 'assistant' && r.status === 'pending',
      );
      expect(assistantConv).toBeDefined();
      expect(assistantConv!.content).toBe('');
      expect(assistantConv!.parts).toEqual([]);

      expect(studentConv).not.toHaveProperty('leaseId');
      expect(studentConv).not.toHaveProperty('cancelRequestedAt');
      expect(studentConv).not.toHaveProperty('heartbeatAt');
      expect(assistantConv).not.toHaveProperty('leaseId');
      expect(assistantConv).not.toHaveProperty('cancelRequestedAt');
      expect(assistantConv).not.toHaveProperty('heartbeatAt');

      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
    });
  });

  describe('重试幂等', () => {
    it('同一 Turn 重复创建不产生重复 conversation_messages', async () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';

      await seedSessionWithConversation();
      const turn1 = await createTurn();

      // 第二次创建（幂等）
      const turn2 = await createTurn();

      // 验证 chat_messages 幂等（replayed）
      expect(turn2.replayed).toBe(true);
      expect(turn2.turnId).toBe(turn1.turnId);

      await getDatabase().transaction(async (transaction) => {
        const input = {
          transaction,
          sessionId,
          conversationId,
          operationId: null,
          studentChatMessageId: turn1.studentMessage.id,
          assistantChatMessageId: turn1.assistantMessage.id,
        };
        await dualWriteBeginMessages(input);
        await dualWriteBeginMessages(input);
      });

      // 验证 conversation_messages 仍然只有 2 条
      const convRows = await getDatabase()
        .select()
        .from(schema.conversationMessages)
        .where(
          sql`${schema.conversationMessages.conversationId} = ${conversationId}`,
        );
      expect(convRows.length).toBe(2);

      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
    });
  });

  describe('开关关闭', () => {
    it('开关关闭时不写入 conversation_messages', async () => {
      // 确保开关关闭
      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;

      await seedSessionWithConversation();
      await createTurn();

      // 验证 chat_messages 已创建
      const chatRows = await getDatabase()
        .select()
        .from(schema.chatMessages)
        .where(sql`${schema.chatMessages.sessionId} = ${sessionId}`);
      expect(chatRows.length).toBe(2);

      // 验证 conversation_messages 为空
      const convRows = await getDatabase()
        .select()
        .from(schema.conversationMessages)
        .where(
          sql`${schema.conversationMessages.conversationId} = ${conversationId}`,
        );
      expect(convRows.length).toBe(0);
    });
  });

  describe('无 conversation_id 的 session', () => {
    it('session 无 conversation_id 时不写入 conversation_messages', async () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';

      // 创建没有 conversation_id 的 session
      const now = new Date('2026-07-15T02:00:00.000Z');
      const noConvoSessionId = '60000000-0000-4000-8000-000000000099';
      await getDatabase().insert(schema.lessonSessions).values({
        id: noConvoSessionId,
        studentId,
        gradeBand: 'middle_school',
        courseSlug: 'no-convo',
        knowledgeNodeId: 'test',
        state: 'EXPLAIN',
        status: 'active',
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const ledger = await new DrizzleTeachingTurnLedger(
        getDatabase(),
      ).beginOrReplay({
        sessionId: noConvoSessionId,
        trustedStudentId: studentId,
        clientMessageId: 'no-convo-msg-1',
        text: '测试消息',
        traceId: 'trace-no-convo',
        modelAlias: 'primary',
        promptVersion: 'turn-v1',
        promptHash: 'a'.repeat(64),
        provider: 'fixture',
        now,
      });

      // 验证 chat_messages 已创建
      const chatRows = await getDatabase()
        .select()
        .from(schema.chatMessages)
        .where(sql`${schema.chatMessages.sessionId} = ${noConvoSessionId}`);
      expect(chatRows.length).toBe(2);

      // 验证 conversation_messages 为空（因为没有 conversation_id）
      const convRows = await getDatabase()
        .select()
        .from(schema.conversationMessages);
      expect(convRows.length).toBe(0);

      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
    });
  });

  describe('状态收敛', () => {
    it('开关关闭后，已创建副本仍收敛到 cancelled', async () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';

      await seedSessionWithConversation();
      const turn = await createTurn();
      const chat = new DrizzleChatRepository(getDatabase());
      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;

      // 取消请求
      await chat.requestAssistantCancellation({
        sessionId,
        trustedStudentId: studentId,
        assistantMessageId: turn.assistantMessage.id,
      });

      // 结算为 cancelled
      await chat.settleAssistantMessage({
        sessionId,
        trustedStudentId: studentId,
        assistantMessageId: turn.assistantMessage.id,
        status: 'cancelled',
        failureCode: null,
      });

      // 验证 conversation_messages 中 assistant 状态为 cancelled
      const convRows = await getDatabase()
        .select()
        .from(schema.conversationMessages)
        .where(
          sql`${schema.conversationMessages.conversationId} = ${conversationId}`,
        );

      const assistantConv = convRows.find((r) => r.role === 'assistant');
      expect(assistantConv).toBeDefined();
      expect(assistantConv!.status).toBe('cancelled');
      expect(assistantConv!.completedAt).not.toBeNull();

      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
    });

    it.each(['failed', 'interrupted'] as const)(
      '%s 终态同步到平台副本',
      async (status) => {
        process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';
        await seedSessionWithConversation();
        const turn = await createTurn();
        await new DrizzleChatRepository(getDatabase()).settleAssistantMessage({
          sessionId,
          trustedStudentId: studentId,
          assistantMessageId: turn.assistantMessage.id,
          status,
          failureCode: `test_${status}`,
        });

        const [platform] = await getDatabase()
          .select()
          .from(schema.conversationMessages)
          .where(
            eq(
              schema.conversationMessages.id,
              deterministicConversationMessageId(turn.assistantMessage.id),
            ),
          );
        expect(platform?.status).toBe(status);
        expect(platform?.failureCode).toBe(`test_${status}`);
      },
    );
  });

  describe('事务与归属边界', () => {
    it('双写冲突会回滚同事务内两侧写入', async () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';
      await seedSessionWithConversation();
      const now = new Date('2026-07-15T03:00:00.000Z');
      const turnId = '60000000-0000-4000-8000-000000000100';
      const studentMessageId = '60000000-0000-4000-8000-000000000101';
      const assistantMessageId = '60000000-0000-4000-8000-000000000102';

      await expect(
        getDatabase().transaction(async (transaction) => {
          await transaction.insert(schema.chatMessages).values([
            {
              id: studentMessageId,
              sessionId,
              turnId,
              clientMessageId: 'rollback-student',
              requestHash: 'b'.repeat(64),
              role: 'student',
              status: 'completed',
              content: '应整体回滚',
              createdAt: now,
              completedAt: now,
            },
            {
              id: assistantMessageId,
              sessionId,
              turnId,
              role: 'assistant',
              status: 'pending',
              content: '',
              leaseId: '60000000-0000-4000-8000-000000000103',
              leaseExpiresAt: new Date(now.getTime() + 30_000),
              heartbeatAt: now,
              createdAt: now,
            },
          ]);
          await transaction.insert(schema.conversationMessages).values({
            id: deterministicConversationMessageId(studentMessageId),
            conversationId,
            role: 'tool',
            status: 'completed',
            content: 'conflict',
            createdAt: now,
            completedAt: now,
          });
          await dualWriteBeginMessages({
            transaction,
            sessionId,
            conversationId,
            operationId: null,
            studentChatMessageId: studentMessageId,
            assistantChatMessageId: assistantMessageId,
          });
        }),
      ).rejects.toBeInstanceOf(K12ConversationDualWriteInvariantError);

      const chatRows = await getDatabase().select().from(schema.chatMessages);
      const platformRows = await getDatabase()
        .select()
        .from(schema.conversationMessages);
      expect(chatRows).toHaveLength(0);
      expect(platformRows).toHaveLength(0);
    });

    it('拒绝把源消息投影到其他 Conversation', async () => {
      await seedSessionWithConversation();
      const turn = await createTurn();
      const otherConversationId = '60000000-0000-4000-8000-000000000011';
      const [space] = await getDatabase()
        .select({ id: schema.spaces.id })
        .from(schema.spaces);
      if (!space) throw new Error('测试 Space 不存在');
      await getDatabase().insert(schema.conversations).values({
        id: otherConversationId,
        spaceId: space.id,
        ownerSubjectId: studentId,
        lastActivityAt: new Date(),
      });

      await expect(
        getDatabase().transaction((transaction) =>
          dualWriteBeginMessages({
            transaction,
            sessionId,
            conversationId: otherConversationId,
            operationId: null,
            studentChatMessageId: turn.studentMessage.id,
            assistantChatMessageId: turn.assistantMessage.id,
          }),
        ),
      ).rejects.toBeInstanceOf(K12ConversationDualWriteInvariantError);
    });
  });

  describe('对账查询', () => {
    it('auditK12Parity 返回计数和稳定标识，不泄露正文', async () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';

      await seedSessionWithConversation();
      await createTurn();

      const result = await auditK12Parity(getDatabase(), {
        conversationId,
      });

      // 验证返回结构
      expect(result).toHaveProperty('conversationId', conversationId);
      expect(result).toHaveProperty('sessionCount');
      expect(result).toHaveProperty('scannedMessageCount');
      expect(result).toHaveProperty('dualWrittenCount');
      expect(result).toHaveProperty('missingInConversation');
      expect(result).toHaveProperty('mismatchedInConversation');
      expect(result).toHaveProperty('orphanedConversationMessages', null);
      expect(result).toHaveProperty('nextCursor');

      // 验证计数正确
      expect(result.sessionCount).toBe(1);
      expect(result.scannedMessageCount).toBe(2);
      expect(result.dualWrittenCount).toBe(2);
      expect(result.missingInConversation).toBe(0);
      expect(result.mismatchedInConversation).toBe(0);

      // 验证不包含任何消息内容
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain('猫和狗');
      expect(resultStr).not.toContain('学生消息');
      expect(resultStr).not.toContain('老师回复');

      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
    });

    it('检测不一致且按稳定游标有界扫描', async () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';
      await seedSessionWithConversation();
      const turn = await createTurn();
      await getDatabase()
        .update(schema.conversationMessages)
        .set({ content: 'tampered projection' })
        .where(
          eq(
            schema.conversationMessages.id,
            deterministicConversationMessageId(turn.studentMessage.id),
          ),
        );

      const first = await auditK12Parity(getDatabase(), {
        conversationId,
        limit: 1,
      });
      const second = await auditK12Parity(getDatabase(), {
        conversationId,
        after: first.nextCursor,
        limit: 1,
      });

      expect(first.scannedMessageCount).toBe(1);
      expect(first.nextCursor).not.toBeNull();
      expect(second.scannedMessageCount).toBe(1);
      expect(
        first.mismatchedInConversation + second.mismatchedInConversation,
      ).toBe(1);
      expect(second.nextCursor).toBeNull();
      expect(JSON.stringify(first)).not.toContain('tampered projection');
    });
  });

  describe('幂等键一致性', () => {
    it('deterministicConversationMessageId 与 chat_messages.id 的映射关系', async () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';

      await seedSessionWithConversation();
      const turn = await createTurn();

      // 计算预期的 conversation_message_id
      const expectedStudentCmId = deterministicConversationMessageId(
        turn.studentMessage.id,
      );
      const expectedAssistantCmId = deterministicConversationMessageId(
        turn.assistantMessage.id,
      );

      // 验证 conversation_messages 中的 ID 匹配
      const convRows = await getDatabase()
        .select()
        .from(schema.conversationMessages)
        .where(
          sql`${schema.conversationMessages.conversationId} = ${conversationId}`,
        );

      const studentConv = convRows.find((r) => r.role === 'user');
      const assistantConv = convRows.find((r) => r.role === 'assistant');

      expect(studentConv?.id).toBe(expectedStudentCmId);
      expect(assistantConv?.id).toBe(expectedAssistantCmId);

      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
    });
  });
});
