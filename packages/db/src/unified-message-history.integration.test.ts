import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import * as schema from './schema';
import { createUnifiedMessageHistoryFixture } from './unified-message-history.integration-fixture';
import { DrizzleUnifiedMessageHistoryRepository } from './unified-message-history';

const fixture = createUnifiedMessageHistoryFixture();
const {
  createConversationWithMembership,
  createK12Session,
  describeWithDatabase,
  getDatabase,
  insertK12Message,
  installDatabaseHooks,
  ownerUserId,
  seedK12Messages,
  seedOwnerIdentity,
} = fixture;

describeWithDatabase('统一消息历史投影', () => {
  installDatabaseHooks();

  describe('只有 conversation_messages', () => {
    it('返回通用平台消息且 role 保持不变', async () => {
      await seedOwnerIdentity();
      const conv = await createConversationWithMembership(ownerUserId);
      const convRepo = new DrizzlePlatformConversationRepository(getDatabase());
      const userMessage = await convRepo.appendCompletedMessage({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        role: 'user',
        content: '你好',
        now: new Date('2026-07-20T02:00:00.000Z'),
      });
      await getDatabase()
        .update(schema.conversationMessages)
        .set({ parts: [{ type: 'text', text: '结构化你好' }] })
        .where(eq(schema.conversationMessages.id, userMessage.id));
      await convRepo.appendCompletedMessage({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        role: 'assistant',
        content: '你好！',
        now: new Date('2026-07-20T02:01:00.000Z'),
      });

      const repo = new DrizzleUnifiedMessageHistoryRepository(getDatabase());
      const page = await repo.listHistory({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
      });

      expect(page.messages).toHaveLength(2);
      expect(page.messages[0]).toMatchObject({
        source: 'conversation',
        role: 'user',
        content: '你好',
        status: 'completed',
      });
      expect(page.messages[0]?.parts).toEqual([
        { type: 'text', text: '结构化你好' },
      ]);
      expect(page.messages[1]).toMatchObject({
        source: 'conversation',
        role: 'assistant',
        content: '你好！',
        status: 'completed',
      });
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('只有 chat_messages', () => {
    it('返回 K12 消息且 student 映射为 user', async () => {
      await seedOwnerIdentity();
      const conv = await createConversationWithMembership(ownerUserId);
      await seedK12Messages(conv.id);

      const repo = new DrizzleUnifiedMessageHistoryRepository(getDatabase());
      const page = await repo.listHistory({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
      });

      expect(page.messages).toHaveLength(4);
      // student -> user
      expect(page.messages[0]).toMatchObject({
        source: 'k12',
        role: 'user',
        content: 'K12问题一',
      });
      expect(page.messages[1]).toMatchObject({
        source: 'k12',
        role: 'assistant',
      });
      expect(page.messages[2]).toMatchObject({
        source: 'k12',
        role: 'user',
        content: 'K12问题二',
      });
      expect(page.messages[3]).toMatchObject({
        source: 'k12',
        role: 'assistant',
      });
    });

    it('保留 K12 结构化消息 Part', async () => {
      await seedOwnerIdentity();
      const conv = await createConversationWithMembership(ownerUserId);
      const sessionId = await createK12Session(conv.id);
      const messageId = await insertK12Message(
        sessionId,
        crypto.randomUUID(),
        'student',
        '带结构化正文',
        'completed',
        new Date('2026-07-20T02:00:00.000Z'),
      );
      await getDatabase().insert(schema.agentMessageParts).values({
        messageId,
        partIndex: 0,
        partType: 'text',
        textContent: '结构化正文',
      });

      const page = await new DrizzleUnifiedMessageHistoryRepository(
        getDatabase(),
      ).listHistory({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
      });

      expect(page.messages[0]?.parts).toEqual([
        { type: 'text', text: '结构化正文' },
      ]);
    });
  });

  describe('混合消息混排', () => {
    it('按 createdAt 升序合并两类消息', async () => {
      await seedOwnerIdentity();
      const conv = await createConversationWithMembership(ownerUserId);
      const convRepo = new DrizzlePlatformConversationRepository(getDatabase());

      // conversation message at T1
      await convRepo.appendCompletedMessage({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        role: 'user',
        content: '通用消息',
        now: new Date('2026-07-20T01:00:00.000Z'),
      });

      // K12 messages at T2
      await seedK12Messages(conv.id);

      // conversation message at T3
      await convRepo.appendCompletedMessage({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        role: 'assistant',
        content: '后续通用',
        now: new Date('2026-07-20T04:00:00.000Z'),
      });

      const repo = new DrizzleUnifiedMessageHistoryRepository(getDatabase());
      const page = await repo.listHistory({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
      });

      const timestamps = page.messages.map((m) =>
        new Date(m.createdAt).getTime(),
      );
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
      expect(page.messages).toHaveLength(6);
      expect(page.messages[0]).toMatchObject({
        source: 'conversation',
        content: '通用消息',
      });
      expect(page.messages[5]).toMatchObject({
        source: 'conversation',
        content: '后续通用',
      });
    });
  });

  describe('相同时间戳确定顺序', () => {
    it('conversation 消息在 k12 消息之前，同 source 按 messageId 排序', async () => {
      await seedOwnerIdentity();
      const conv = await createConversationWithMembership(ownerUserId);
      const convRepo = new DrizzlePlatformConversationRepository(getDatabase());
      const sameTime = new Date('2026-07-20T05:00:00.000Z');

      // Create conversation messages at the same time
      await convRepo.appendCompletedMessage({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        role: 'user',
        content: '通用A',
        now: sameTime,
      });

      // Create K12 session and messages at the same time
      const sessionId = await createK12Session(conv.id);
      await insertK12Message(
        sessionId,
        crypto.randomUUID(),
        'student',
        'K12同时',
        'completed',
        sameTime,
      );

      const repo = new DrizzleUnifiedMessageHistoryRepository(getDatabase());
      const page = await repo.listHistory({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
      });

      expect(page.messages).toHaveLength(2);
      // conversation messages come before k12 messages at the same timestamp
      const firstMsg = page.messages[0];
      const secondMsg = page.messages[1];
      expect(firstMsg?.source).toBe('conversation');
      expect(secondMsg?.source).toBe('k12');
    });
  });

  describe('failed/cancelled/interrupted 状态诚实保留', () => {
    it('保留所有原始终态不掩盖', async () => {
      await seedOwnerIdentity();
      const conv = await createConversationWithMembership(ownerUserId);
      const convRepo = new DrizzlePlatformConversationRepository(getDatabase());

      // Add a failed conversation message
      await convRepo.appendCompletedMessage({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        role: 'user',
        content: '触发失败',
        now: new Date('2026-07-20T01:00:00.000Z'),
      });

      // Create K12 session with failed and interrupted messages
      const sessionId = await createK12Session(conv.id);
      const failedTurnId = crypto.randomUUID();
      const interruptedTurnId = crypto.randomUUID();
      const cancelledTurnId = crypto.randomUUID();

      await insertK12Message(
        sessionId,
        failedTurnId,
        'student',
        '测试failed',
        'completed',
        new Date('2026-07-20T02:00:00.000Z'),
      );
      await insertK12Message(
        sessionId,
        failedTurnId,
        'assistant',
        '失败回答',
        'failed',
        new Date('2026-07-20T02:00:01.000Z'),
        { failureCode: 'test_failure' },
      );

      await insertK12Message(
        sessionId,
        interruptedTurnId,
        'student',
        '测试interrupted',
        'completed',
        new Date('2026-07-20T03:00:00.000Z'),
      );
      await insertK12Message(
        sessionId,
        interruptedTurnId,
        'assistant',
        '中断回答',
        'interrupted',
        new Date('2026-07-20T03:00:01.000Z'),
        { failureCode: 'test_interrupt' },
      );
      await insertK12Message(
        sessionId,
        cancelledTurnId,
        'student',
        '测试cancelled',
        'completed',
        new Date('2026-07-20T04:00:00.000Z'),
      );
      const cancelledAt = new Date('2026-07-20T04:00:01.000Z');
      await insertK12Message(
        sessionId,
        cancelledTurnId,
        'assistant',
        '取消回答',
        'cancelled',
        cancelledAt,
        {
          failureCode: 'test_cancel',
          cancelRequestedAt: cancelledAt,
          cancelledAt,
        },
      );

      const repo = new DrizzleUnifiedMessageHistoryRepository(getDatabase());
      const page = await repo.listHistory({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
      });

      const assistantMessages = page.messages.filter(
        (m) => m.role === 'assistant',
      );
      const statuses = assistantMessages.map((m) => m.status);
      expect(statuses).toContain('failed');
      expect(statuses).toContain('cancelled');
      expect(statuses).toContain('interrupted');

      const failedMsg = assistantMessages.find((m) => m.status === 'failed');
      expect(failedMsg?.failureCode).toBe('test_failure');
      const interruptedMsg = assistantMessages.find(
        (m) => m.status === 'interrupted',
      );
      expect(interruptedMsg?.failureCode).toBe('test_interrupt');
    });
  });
});
