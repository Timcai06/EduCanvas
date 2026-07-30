import { afterEach, describe, expect, it } from 'vitest';
import { isK12ConversationDualWriteEnabled } from './k12-conversation-dual-write';
import {
  deterministicConversationMessageId,
  K12ConversationDualWriteInvariantError,
} from './k12-conversation-message-identity';

describe('K12 消息双写', () => {
  describe('deterministicConversationMessageId', () => {
    it('同一 chatMessageId 始终产生相同的 conversationMessageId', () => {
      const id1 = deterministicConversationMessageId(
        '550e8400-e29b-41d4-a716-446655440000',
      );
      const id2 = deterministicConversationMessageId(
        '550e8400-e29b-41d4-a716-446655440000',
      );
      expect(id1).toBe(id2);
    });

    it('不同 chatMessageId 产生不同的 conversationMessageId', () => {
      const id1 = deterministicConversationMessageId(
        '550e8400-e29b-41d4-a716-446655440000',
      );
      const id2 = deterministicConversationMessageId(
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      );
      expect(id1).not.toBe(id2);
    });

    it('生成有效的 UUID 格式', () => {
      const id = deterministicConversationMessageId(
        '550e8400-e29b-41d4-a716-446655440000',
      );
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(id).toMatch(uuidRegex);
    });

    it('拒绝非 UUID 源消息标识', () => {
      expect(() =>
        deterministicConversationMessageId('client-controlled-id'),
      ).toThrow(K12ConversationDualWriteInvariantError);
    });
  });

  describe('isK12ConversationDualWriteEnabled', () => {
    const originalValue = process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;

    afterEach(() => {
      if (originalValue === undefined) {
        delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
      } else {
        process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = originalValue;
      }
    });

    it('默认返回 false', () => {
      delete process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE;
      expect(isK12ConversationDualWriteEnabled()).toBe(false);
    });

    it('显式设置为 true 时返回 true', () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'true';
      expect(isK12ConversationDualWriteEnabled()).toBe(true);
    });

    it('显式设置为 false 时返回 false', () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'false';
      expect(isK12ConversationDualWriteEnabled()).toBe(false);
    });

    it('任何非 "true" 的值都返回 false', () => {
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = '1';
      expect(isK12ConversationDualWriteEnabled()).toBe(false);
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'yes';
      expect(isK12ConversationDualWriteEnabled()).toBe(false);
      process.env.EDUCANVAS_K12_CONVERSATION_DUAL_WRITE = 'TRUE';
      expect(isK12ConversationDualWriteEnabled()).toBe(false);
    });
  });
});
