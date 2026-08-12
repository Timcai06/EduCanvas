import { afterEach, describe, expect, it } from 'vitest';
import {
  K12_CONVERSATION_AUTHORITY_STAGE_ENV,
  K12ConversationAuthorityConfigurationError,
  isK12ConversationDualWriteEnabled,
  resolveK12ConversationAuthorityContract,
} from './k12-conversation-dual-write';
import {
  deterministicConversationMessageId,
  K12ConversationDualWriteInvariantError,
} from './k12-conversation-message-identity';
import { DrizzleK12ConversationBackfillRepository } from './k12-conversation-backfill-repository';

describe('K12 消息双写', () => {
  describe('CA08A authority与rollback契约', () => {
    it('未配置时默认legacy且可见消息/运行态都保持chat_messages权威', () => {
      expect(resolveK12ConversationAuthorityContract({})).toEqual({
        stage: 'legacy',
        currentVisibleAuthority: 'chat_messages',
        runtimeAuthority: 'chat_messages',
        longTermTarget: 'conversation_messages',
        productionReadSource: 'chat_messages',
        rollback: {
          stage: 'legacy',
          visibleAuthority: 'chat_messages',
          runtimeAuthority: 'chat_messages',
          dualWriteEnabled: false,
        },
      });
    });

    it.each(['legacy', 'observe'] as const)(
      '%s阶段不切生产读且回退固定为legacy加关闭双写',
      (stage) => {
        const contract = resolveK12ConversationAuthorityContract({
          [K12_CONVERSATION_AUTHORITY_STAGE_ENV]: stage,
          EDUCANVAS_K12_CONVERSATION_DUAL_WRITE: 'true',
        });

        expect(contract).toMatchObject({
          stage,
          currentVisibleAuthority: 'chat_messages',
          runtimeAuthority: 'chat_messages',
          longTermTarget: 'conversation_messages',
          productionReadSource: 'chat_messages',
          rollback: {
            stage: 'legacy',
            visibleAuthority: 'chat_messages',
            runtimeAuthority: 'chat_messages',
            dualWriteEnabled: false,
          },
        });
        expect(Object.isFrozen(contract)).toBe(true);
        expect(Object.isFrozen(contract.rollback)).toBe(true);
      },
    );

    it.each(['platform', '', 'OBSERVE', 'legacy ', 'secret=provider-key'])(
      '明确拒绝platform或非法stage且错误不回显原值：%s',
      (stage) => {
        let error: unknown;
        try {
          resolveK12ConversationAuthorityContract({
            [K12_CONVERSATION_AUTHORITY_STAGE_ENV]: stage,
          });
        } catch (caught) {
          error = caught;
        }

        expect(error).toBeInstanceOf(
          K12ConversationAuthorityConfigurationError,
        );
        expect(error).toMatchObject({
          code: 'invalid_k12_conversation_authority_stage',
          message: 'K12 conversation authority stage is invalid',
        });
        if (stage.startsWith('secret=')) {
          expect(String(error)).not.toContain(stage);
        }
      },
    );
  });

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

  describe('K12历史回填', () => {
    it('并发写者触发onConflictDoNothing少插入时fail closed', async () => {
      const createdAt = new Date('2026-08-12T00:00:00.000Z');
      const completedAt = new Date('2026-08-12T00:00:01.000Z');
      const sourceRow = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        role: 'student',
        status: 'completed',
        content: '不得进入错误响应的私密正文',
        failureCode: null,
        createdAt,
        completedAt,
        conversationId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
        operationId: null,
      };
      let selectCall = 0;
      const selectedPages = [[sourceRow], [], []] as const;
      const transaction = {
        select() {
          const rows = selectedPages[selectCall++] ?? [];
          const builder = {
            from: () => builder,
            innerJoin: () => builder,
            leftJoin: () => builder,
            where: () => builder,
            orderBy: () => builder,
            limit: async () => rows,
            then: (
              resolve: (value: readonly unknown[]) => unknown,
              reject: (reason: unknown) => unknown,
            ) => Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        },
        insert() {
          const builder = {
            values: () => builder,
            onConflictDoNothing: () => builder,
            // Simulate another transaction winning the deterministic ID race
            // after this transaction's repeatable-read snapshot.
            returning: async () => [],
          };
          return builder;
        },
      };
      const database = {
        transaction: async (
          callback: (executor: typeof transaction) => Promise<unknown>,
          options: unknown,
        ) => {
          expect(options).toEqual({
            isolationLevel: 'repeatable read',
            accessMode: 'read write',
          });
          return callback(transaction);
        },
      };
      const repository = new DrizzleK12ConversationBackfillRepository(
        database as never,
      );

      const result = repository.applyPage({ limit: 100 });
      await expect(result).rejects.toMatchObject({
        name: 'K12ConversationDualWriteInvariantError',
        code: 'k12_dual_write_invariant_failed',
        message: 'K12 message dual-write invariant failed',
      });
      await expect(result).rejects.not.toThrow('不得进入错误响应的私密正文');
    });
  });
});
