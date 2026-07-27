import { describe, expect, it } from 'vitest';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import { createUnifiedMessageHistoryFixture } from './unified-message-history.integration-fixture';
import {
  DrizzleUnifiedMessageHistoryRepository,
  MessageHistoryAccessError,
} from './unified-message-history';

const fixture = createUnifiedMessageHistoryFixture();
const {
  createConversationWithMembership,
  createK12Session,
  describeWithDatabase,
  getDatabase,
  insertK12Message,
  installDatabaseHooks,
  otherUserId,
  ownerUserId,
  seedOtherIdentity,
  seedOwnerIdentity,
} = fixture;

describeWithDatabase('统一消息历史访问与分页', () => {
  installDatabaseHooks();

  describe('跨用户、跨 Notebook 拒绝', () => {
    it('无 Notebook 访问权限时抛出统一错误', async () => {
      await seedOwnerIdentity();
      await seedOtherIdentity();
      const conv = await createConversationWithMembership(ownerUserId);
      await new DrizzlePlatformConversationRepository(
        getDatabase(),
      ).appendCompletedMessage({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        role: 'user',
        content: '私有消息',
        now: new Date('2026-07-20T01:00:00.000Z'),
      });

      await expect(
        new DrizzleUnifiedMessageHistoryRepository(getDatabase()).listHistory({
          conversationId: conv.id,
          trustedSubjectId: otherUserId,
        }),
      ).rejects.toBeInstanceOf(MessageHistoryAccessError);
    });

    it('不存在的 conversationId 抛出统一错误', async () => {
      await expect(
        new DrizzleUnifiedMessageHistoryRepository(getDatabase()).listHistory({
          conversationId: '00000000-0000-0000-0000-000000000000',
          trustedSubjectId: ownerUserId,
        }),
      ).rejects.toBeInstanceOf(MessageHistoryAccessError);
    });

    it('已有其他 Notebook 访问权也不能读取目标 Notebook', async () => {
      await seedOwnerIdentity();
      await seedOtherIdentity();
      await createConversationWithMembership(ownerUserId, 'Owner Notebook');
      const otherConversation = await createConversationWithMembership(
        otherUserId,
        'Other Notebook',
      );

      await expect(
        new DrizzleUnifiedMessageHistoryRepository(getDatabase()).listHistory({
          conversationId: otherConversation.id,
          trustedSubjectId: ownerUserId,
        }),
      ).rejects.toBeInstanceOf(MessageHistoryAccessError);
    });
  });

  describe('分页无重复无遗漏', () => {
    it('游标分页返回不重叠的完整消息集', async () => {
      await seedOwnerIdentity();
      const conv = await createConversationWithMembership(ownerUserId);
      const convRepo = new DrizzlePlatformConversationRepository(getDatabase());
      for (let i = 1; i <= 5; i++) {
        await convRepo.appendCompletedMessage({
          conversationId: conv.id,
          trustedSubjectId: ownerUserId,
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `消息${i}`,
          now: new Date(`2026-07-20T0${i}:00:00.000Z`),
        });
      }

      const repo = new DrizzleUnifiedMessageHistoryRepository(getDatabase());
      const first = await repo.listHistory({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        limit: 3,
      });
      const second = await repo.listHistory({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        after: first.nextCursor,
        limit: 3,
      });

      expect(first.messages).toHaveLength(3);
      expect(second.messages).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      const messages = [...first.messages, ...second.messages];
      expect(new Set(messages.map((message) => message.id)).size).toBe(
        messages.length,
      );
      expect(new Set(messages.map((message) => message.content))).toEqual(
        new Set(['消息1', '消息2', '消息3', '消息4', '消息5']),
      );
    });

    it('游标无效时抛出错误', async () => {
      await seedOwnerIdentity();
      const conv = await createConversationWithMembership(ownerUserId);
      const repo = new DrizzleUnifiedMessageHistoryRepository(getDatabase());
      await expect(
        repo.listHistory({
          conversationId: conv.id,
          trustedSubjectId: ownerUserId,
          after: {
            createdAt: 'not-a-date',
            source: 'conversation',
            messageId: '00000000-0000-0000-0000-000000000000',
          },
        }),
      ).rejects.toBeInstanceOf(MessageHistoryAccessError);
      await expect(
        repo.listHistory({
          conversationId: conv.id,
          trustedSubjectId: ownerUserId,
          after: {
            createdAt: '2026-07-20T01:00:00.000Z',
            source: 'conversation',
            messageId: 'not-a-uuid',
          },
        }),
      ).rejects.toBeInstanceOf(MessageHistoryAccessError);
    });

    it('页边界落在 K12 消息时不重复同时间戳的通用消息', async () => {
      await seedOwnerIdentity();
      const conv = await createConversationWithMembership(ownerUserId);
      const sameTime = new Date('2026-07-20T05:00:00.000Z');
      await new DrizzlePlatformConversationRepository(
        getDatabase(),
      ).appendCompletedMessage({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        role: 'user',
        content: '同时间通用消息',
        now: sameTime,
      });
      const sessionId = await createK12Session(conv.id);
      await insertK12Message(
        sessionId,
        crypto.randomUUID(),
        'student',
        '同时间K12消息',
        'completed',
        sameTime,
      );
      await insertK12Message(
        sessionId,
        crypto.randomUUID(),
        'student',
        '稍后K12消息',
        'completed',
        new Date('2026-07-20T05:00:01.000Z'),
      );
      const repo = new DrizzleUnifiedMessageHistoryRepository(getDatabase());
      const first = await repo.listHistory({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        limit: 2,
      });
      const second = await repo.listHistory({
        conversationId: conv.id,
        trustedSubjectId: ownerUserId,
        after: first.nextCursor,
        limit: 2,
      });

      expect(first.messages.map((message) => message.content)).toEqual([
        '同时间通用消息',
        '同时间K12消息',
      ]);
      expect(second.messages.map((message) => message.content)).toEqual([
        '稍后K12消息',
      ]);
    });
  });
});
