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
import { DrizzleK12ConversationBackfillRepository } from './k12-conversation-backfill-repository';
import {
  dualWriteBeginMessages,
  isK12ConversationDualWriteEnabled,
} from './k12-conversation-dual-write';
import {
  deterministicConversationMessageId,
  K12ConversationDualWriteInvariantError,
} from './k12-conversation-message-identity';
import {
  auditK12Parity,
  type K12ParityAuditCursor,
} from './k12-conversation-parity';
import { DrizzleModelRunRepository } from './model-run-repository';
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
  // D02 FK：student_id 必须指向真实 platform_users 主体。
  await getDatabase()
    .insert(schema.platformUsers)
    .values({ id: studentId, kind: 'registered', status: 'active' })
    .onConflictDoNothing();
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

type CreatedTurn = Awaited<ReturnType<typeof createTurn>>;

function modelRunInput(
  turn: CreatedTurn,
  phase: 'answer' | 'synthesis' = 'answer',
) {
  return {
    sessionId,
    trustedStudentId: studentId,
    operationId: turn.turnId,
    assistantMessageId: turn.assistantMessage.id,
    turnId: turn.turnId,
    phase,
    traceId:
      phase === 'answer'
        ? turn.answerRun.traceId
        : `trace-${turn.turnId}-${phase}`,
    taskAlias: 'teaching.turn' as const,
    modelAlias: 'primary',
    promptVersion: 'turn-v1',
    promptHash: 'a'.repeat(64),
    provider: 'fixture',
  };
}

/**
 * 把 assistant 结算为 failed 释放同一 session 的 turn 锁（无需 leaseId/正文）。
 * 连续创建多个 turn 前必须先释放，否则 beginTeachingMessages 拒绝 TurnInProgress。
 */
async function settleAssistantFailed(turn: CreatedTurn): Promise<void> {
  await new DrizzleChatRepository(getDatabase()).settleAssistantMessage({
    sessionId,
    trustedStudentId: studentId,
    assistantMessageId: turn.assistantMessage.id,
    status: 'failed',
    failureCode: 'test_free_turn',
  });
}

/** 走完 answer run succeeded → streaming → delta → completed 的完整生命周期。 */
async function settleAssistantCompleted(turn: CreatedTurn): Promise<void> {
  const chat = new DrizzleChatRepository(getDatabase());
  const runs = new DrizzleModelRunRepository(getDatabase());
  const answer = await runs.createOrGetTeachingRun(modelRunInput(turn));
  await runs.markRunning({
    sessionId,
    trustedStudentId: studentId,
    runId: answer.run.id,
  });
  await runs.settle({
    sessionId,
    trustedStudentId: studentId,
    runId: answer.run.id,
    status: 'succeeded',
    providerResult: { finishReason: 'stop' },
  });
  const leaseId = turn.assistantMessage.leaseId;
  if (!leaseId) throw new Error('assistant leaseId 缺失');
  // createTurn 用固定时间窗创建 lease，settle 阶段必须用同一时间窗，否则 lease 过期被拒
  const now = new Date('2026-07-15T02:01:01.000Z');
  await chat.markAssistantStreaming({
    sessionId,
    trustedStudentId: studentId,
    assistantMessageId: turn.assistantMessage.id,
    leaseId,
    now,
  });
  await chat.appendAssistantDelta({
    sessionId,
    trustedStudentId: studentId,
    assistantMessageId: turn.assistantMessage.id,
    leaseId,
    delta: '最终回答',
    now: new Date('2026-07-15T02:01:02.000Z'),
  });
  await chat.settleAssistantMessage({
    sessionId,
    trustedStudentId: studentId,
    assistantMessageId: turn.assistantMessage.id,
    status: 'completed',
    leaseId,
  });
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
      // D02 FK：student_id 必须指向真实 platform_users 主体。
      await getDatabase()
        .insert(schema.platformUsers)
        .values({ id: studentId, kind: 'registered', status: 'active' })
        .onConflictDoNothing();
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

  describe('关闭前后计数对账（R05 收口）', () => {
    it('开关开→关→开，副本计数精确对应开关状态', async () => {
      // 第一轮：开关开，应有副本
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';
      await seedSessionWithConversation();
      const turn1 = await createTurn(
        'dual-write-msg-pre-1',
        '开关开启时的问题',
      );
      await settleAssistantFailed(turn1);

      const parityOn = await auditK12Parity(getDatabase(), {
        conversationId,
      });
      expect(parityOn.scannedMessageCount).toBe(2);
      expect(parityOn.dualWrittenCount).toBe(2);
      expect(parityOn.missingInConversation).toBe(0);

      // 第二轮：开关关，不应有新副本
      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
      const turn2 = await createTurn(
        'dual-write-msg-off-1',
        '开关关闭时的问题',
      );
      await settleAssistantFailed(turn2);

      const parityOff = await auditK12Parity(getDatabase(), {
        conversationId,
      });
      expect(parityOff.scannedMessageCount).toBe(4);
      // 前 2 条已双写，后 2 条未双写
      expect(parityOff.dualWrittenCount).toBe(2);
      expect(parityOff.missingInConversation).toBe(2);

      // 第三轮：开关再开，新消息恢复双写
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';
      const turn3 = await createTurn(
        'dual-write-msg-on-2',
        '开关再次开启时的问题',
      );
      await settleAssistantFailed(turn3);

      const parityOnAgain = await auditK12Parity(getDatabase(), {
        conversationId,
      });
      expect(parityOnAgain.scannedMessageCount).toBe(6);
      // 前 2 + 后 2 = 4 条有副本，中间 2 条缺失
      expect(parityOnAgain.dualWrittenCount).toBe(4);
      expect(parityOnAgain.missingInConversation).toBe(2);

      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
    });

    it('对账游标边界：limit=2 时逐页扫描无差异', async () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';
      await seedSessionWithConversation();
      // 创建 3 个 Turn（6 条消息），每轮之间释放 turn 锁
      const turn1 = await createTurn('dual-write-batch-1', '问题1');
      await settleAssistantFailed(turn1);
      const turn2 = await createTurn('dual-write-batch-2', '问题2');
      await settleAssistantFailed(turn2);
      const turn3 = await createTurn('dual-write-batch-3', '问题3');
      await settleAssistantFailed(turn3);

      let cursor: K12ParityAuditCursor | null = null;
      let totalScanned = 0;
      let totalDualWritten = 0;
      let totalMissing = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await auditK12Parity(getDatabase(), {
          conversationId,
          after: cursor,
          limit: 2,
        });
        totalScanned += page.scannedMessageCount;
        totalDualWritten += page.dualWrittenCount;
        totalMissing += page.missingInConversation;
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
        if (totalScanned > 100) throw new Error('对账游标未终止');
      }

      expect(totalScanned).toBe(6);
      expect(totalDualWritten).toBe(6);
      expect(totalMissing).toBe(0);

      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
    });
  });

  describe('关闭前零差异基线（R05 收口 — 关闭前置条件）', () => {
    // R05 退出条件要求关闭前对账零差异。本组测试验证：
    // begin + streaming settle → 对账零差异 → 开关关闭不再创建新副本。
    // Owner: R 线负责人。截止日期: R08 收口完成后删除双写代码。
    it('连续 begin→streaming→completed settle 后对账零差异', async () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';
      await seedSessionWithConversation();

      // 完整生命周期：begin（两侧写入）→ answer run succeeded → streaming → delta → completed
      const turn = await createTurn('dual-write-zero-diff', '零差异基线测试');
      await settleAssistantCompleted(turn);

      // 对账：必须零差异
      const parity = await auditK12Parity(getDatabase(), { conversationId });
      expect(parity.scannedMessageCount).toBe(2);
      expect(parity.dualWrittenCount).toBe(2);
      expect(parity.missingInConversation).toBe(0);
      expect(parity.mismatchedInConversation).toBe(0);

      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
    });

    it.each(['failed', 'cancelled', 'interrupted'] as const)(
      'begin→streaming→%s settle 后对账仍零差异',
      async (status) => {
        process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';
        await seedSessionWithConversation();
        const chat = new DrizzleChatRepository(getDatabase());

        const turn = await createTurn(
          `dual-write-${status}`,
          `${status} 终态对账测试`,
        );
        // cancelled 必须先显式请求取消，否则 settle 被状态机拒绝
        if (status === 'cancelled') {
          await chat.requestAssistantCancellation({
            sessionId,
            trustedStudentId: studentId,
            assistantMessageId: turn.assistantMessage.id,
          });
        }
        await chat.settleAssistantMessage({
          sessionId,
          trustedStudentId: studentId,
          assistantMessageId: turn.assistantMessage.id,
          status,
          failureCode: status === 'failed' ? `test_${status}` : null,
        });

        const parity = await auditK12Parity(getDatabase(), { conversationId });
        expect(parity.dualWrittenCount).toBe(2);
        expect(parity.missingInConversation).toBe(0);
        expect(parity.mismatchedInConversation).toBe(0);

        delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
      },
    );
  });

  describe('历史副本回填（R05 backfill）', () => {
    it('默认关闭双写时可 dry-run、显式 apply，并在重跑时保持幂等', async () => {
      await seedSessionWithConversation();
      const turn = await createTurn('backfill-missing-1', '历史问题');
      await settleAssistantFailed(turn);
      const repository = new DrizzleK12ConversationBackfillRepository(
        getDatabase(),
      );

      const preview = await repository.previewPage({ limit: 100 });
      expect(preview).toMatchObject({
        mode: 'dry-run',
        scannedMessageCount: 2,
        missingBeforeCount: 2,
        matchedBeforeCount: 0,
        mismatchedBeforeCount: 0,
        insertedCount: 0,
        nextCursor: null,
      });
      expect(
        await getDatabase().select().from(schema.conversationMessages),
      ).toHaveLength(0);

      const applied = await repository.applyPage({ limit: 100 });
      expect(applied).toMatchObject({
        mode: 'apply',
        scannedMessageCount: 2,
        missingBeforeCount: 2,
        mismatchedBeforeCount: 0,
        insertedCount: 2,
      });
      const replay = await repository.applyPage({ limit: 100 });
      expect(replay).toMatchObject({
        missingBeforeCount: 0,
        matchedBeforeCount: 2,
        mismatchedBeforeCount: 0,
        insertedCount: 0,
      });
      const parity = await auditK12Parity(getDatabase(), { conversationId });
      expect(parity).toMatchObject({
        scannedMessageCount: 2,
        missingInConversation: 0,
        mismatchedInConversation: 0,
      });
    });

    it('以稳定游标限批续跑，发现既有不一致时整页零写入', async () => {
      await seedSessionWithConversation();
      const turn = await createTurn('backfill-cursor-1', '游标问题');
      await settleAssistantFailed(turn);
      const repository = new DrizzleK12ConversationBackfillRepository(
        getDatabase(),
      );

      const first = await repository.applyPage({ limit: 1 });
      expect(first.insertedCount).toBe(1);
      expect(first.nextCursor).not.toBeNull();
      const second = await repository.applyPage({
        limit: 1,
        after: first.nextCursor,
      });
      expect(second.insertedCount).toBe(1);
      expect(second.nextCursor).toBeNull();

      const studentReplicaId = deterministicConversationMessageId(
        turn.studentMessage.id,
      );
      await getDatabase()
        .update(schema.conversationMessages)
        .set({ content: '被篡改的副本' })
        .where(eq(schema.conversationMessages.id, studentReplicaId));
      await getDatabase()
        .delete(schema.conversationMessages)
        .where(
          eq(
            schema.conversationMessages.id,
            deterministicConversationMessageId(turn.assistantMessage.id),
          ),
        );

      const guarded = await repository.applyPage({ limit: 100 });
      expect(guarded).toMatchObject({
        missingBeforeCount: 1,
        mismatchedBeforeCount: 1,
        insertedCount: 0,
      });
      expect(
        await getDatabase().select().from(schema.conversationMessages),
      ).toHaveLength(1);
    });
  });

  describe('稳定键/哈希对账（R05 收口）', () => {
    it('同一 chatMessageId 的派生 conversationMessageId 在开关关→开间保持不变', async () => {
      // 开关开，建立副本
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';
      await seedSessionWithConversation();
      const turn1 = await createTurn('dual-write-stable-1', '稳定键测试');

      const cmIdAfterWrite = deterministicConversationMessageId(
        turn1.studentMessage.id,
      );

      // 开关关
      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;

      // 再次计算应保持不变（确定性哈希不依赖开关状态）
      const cmIdAfterOff = deterministicConversationMessageId(
        turn1.studentMessage.id,
      );
      expect(cmIdAfterOff).toBe(cmIdAfterWrite);

      // 验证副本 ID 确实存储在数据库中
      const convRows = await getDatabase()
        .select({ id: schema.conversationMessages.id })
        .from(schema.conversationMessages)
        .where(eq(schema.conversationMessages.id, cmIdAfterWrite));
      expect(convRows).toHaveLength(1);

      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
    });

    it('不同 chatMessageId 产生不同稳定键且不会碰撞', async () => {
      const id1 = deterministicConversationMessageId(
        'a0000000-0000-4000-8000-000000000001',
      );
      const id2 = deterministicConversationMessageId(
        'a0000000-0000-4000-8000-000000000002',
      );
      expect(id1).not.toBe(id2);

      // 同一源 ID 的派生键完全确定性
      const id3 = deterministicConversationMessageId(
        'a0000000-0000-4000-8000-000000000001',
      );
      expect(id3).toBe(id1);
    });
  });
});
