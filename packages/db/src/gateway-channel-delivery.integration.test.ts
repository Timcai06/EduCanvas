import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  DrizzleGatewayChannelBindingRepository,
  DrizzleGatewayDeliveryRepository,
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayOperationStore,
  type GatewayChannelPrivateRoute,
} from './gateway-repository';
import { DrizzleGatewayConnectionRepository } from './gateway-connection-repository';
import { DrizzleGatewayHandoffRepository } from './gateway-handoff-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import {
  closeGatewayConnection,
  describeWithDatabase,
  getDatabase,
  migrateGatewaySchema,
  now,
  truncateGatewayTables,
} from './gateway-repository.integration-support';

describeWithDatabase(
  'Gateway handoff, channel delivery and connection persistence',
  () => {
    beforeAll(migrateGatewaySchema);
    beforeEach(truncateGatewayTables);
    afterAll(closeGatewayConnection);

    it('atomically rejects handoff replay, expiry and a different subject', async () => {
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const handoffs = new DrizzleGatewayHandoffRepository(getDatabase());
      const conversation = await conversations.create({
        ownerSubjectId: 'user:owner',
        spaceKind: 'notebook',
        spaceTitle: '交接测试',
        now,
      });
      const validDigest = 'a'.repeat(64);
      await handoffs.issue({
        tokenDigest: validDigest,
        userId: 'user:owner',
        conversationId: conversation.id,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 120_000),
      });

      expect(
        await handoffs.consume({
          tokenDigest: validDigest,
          trustedSubjectId: 'user:other',
          now: new Date(now.getTime() + 1_000),
        }),
      ).toEqual({ status: 'rejected', reason: 'forbidden' });
      expect(
        await handoffs.consume({
          tokenDigest: validDigest,
          trustedSubjectId: 'user:owner',
          now: new Date(now.getTime() + 2_000),
        }),
      ).toEqual({ status: 'consumed', conversationId: conversation.id });
      expect(
        await handoffs.consume({
          tokenDigest: validDigest,
          trustedSubjectId: 'user:owner',
          now: new Date(now.getTime() + 3_000),
        }),
      ).toEqual({ status: 'rejected', reason: 'replayed' });

      const expiredDigest = 'b'.repeat(64);
      await handoffs.issue({
        tokenDigest: expiredDigest,
        userId: 'user:owner',
        conversationId: conversation.id,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 1_000),
      });
      expect(
        await handoffs.consume({
          tokenDigest: expiredDigest,
          trustedSubjectId: 'user:owner',
          now: new Date(now.getTime() + 1_001),
        }),
      ).toEqual({ status: 'rejected', reason: 'expired' });
    });

    it('deduplicates acknowledged channel delivery and enforces paired private routing', async () => {
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const identities = new DrizzleGatewayIdentityRepository(getDatabase());
      const channels = new DrizzleGatewayChannelBindingRepository(
        getDatabase(),
      );
      const delivery = new DrizzleGatewayDeliveryRepository(getDatabase());
      const store = new DrizzleGatewayOperationStore(getDatabase());
      const conversation = await conversations.create({
        ownerSubjectId: 'user:owner',
        spaceKind: 'notebook',
        spaceTitle: '渠道',
        now,
      });
      const owner = await identities.getActive('user:owner');
      if (!owner) throw new Error('Owner identity missing');
      const binding = await channels.bindPrivate({
        adapterId: 'telegram.bot',
        externalUserId: '42',
        externalThreadId: '42',
        userId: owner.userId,
        conversationId: conversation.id,
        now,
      });
      expect(
        await channels.resolvePrivate({
          adapterId: 'telegram.bot',
          externalUserId: '42',
          externalThreadId: '42',
        }),
      ).toMatchObject({
        conversationId: conversation.id,
        userId: owner.userId,
      });
      const operation = await store.begin({
        envelopeId: 'telegram:update:1',
        idempotencyKey: 'telegram:1',
        requestFingerprint: 'd'.repeat(64),
        route: {
          actorUserId: owner.userId,
          agentId: owner.agentId,
          notebookId: binding.notebookId,
          conversationId: binding.conversationId,
          agentProfileId: 'general',
          membershipRole: 'owner',
        },
        now,
      });
      const first = await delivery.begin({
        operationId: operation.operationId,
        envelopeId: 'telegram:update:1',
        targetKind: 'channel',
        target: { threadId: '42' },
        now,
      });
      await delivery.settle({
        deliveryId: first.deliveryId,
        status: 'acknowledged',
        externalMessageId: '9',
        now,
      });
      await expect(
        delivery.begin({
          operationId: operation.operationId,
          envelopeId: 'telegram:update:1',
          targetKind: 'channel',
          target: { threadId: '42' },
          now,
        }),
      ).resolves.toMatchObject({
        deliveryId: first.deliveryId,
        replayed: true,
      });
    });

    it('keeps connection pending, activation, listing and revoke consistent across users', async () => {
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const connections = new DrizzleGatewayConnectionRepository(getDatabase());
      const bindings = new DrizzleGatewayChannelBindingRepository(
        getDatabase(),
      );
      const ownerConversation = await conversations.create({
        ownerSubjectId: 'user:owner',
        spaceKind: 'notebook',
        spaceTitle: '连接控制面',
        now,
      });
      const otherConversation = await conversations.create({
        ownerSubjectId: 'user:other',
        spaceKind: 'notebook',
        spaceTitle: '其他用户',
        now,
      });
      const pending = await connections.begin({
        provider: 'telegram',
        userId: 'user:owner',
        conversationId: ownerConversation.id,
        now,
        activationExpiresAt: new Date(now.getTime() + 600_000),
      });
      expect(pending).toMatchObject({
        provider: 'telegram',
        status: 'pending',
        conversationId: ownerConversation.id,
      });
      await expect(
        connections.begin({
          provider: 'telegram',
          userId: 'user:owner',
          conversationId: ownerConversation.id,
          now: new Date(now.getTime() + 1),
          activationExpiresAt: new Date(now.getTime() + 600_001),
        }),
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });
      expect(await connections.list('user:other')).toEqual([]);

      const concurrentActivation = await Promise.allSettled([
        connections.activatePending({
          provider: 'telegram',
          connectionId: pending.connectionId,
          externalAccountId: '42',
          externalThreadId: '42',
          now: new Date(now.getTime() + 1_000),
        }),
        connections.activatePending({
          provider: 'telegram',
          connectionId: pending.connectionId,
          externalAccountId: '43',
          externalThreadId: '43',
          now: new Date(now.getTime() + 1_000),
        }),
      ]);
      expect(
        concurrentActivation.map((result) => result.status).sort(),
      ).toEqual(['fulfilled', 'rejected']);
      const activatedResult = concurrentActivation.find(
        (
          result,
        ): result is PromiseFulfilledResult<GatewayChannelPrivateRoute> =>
          result.status === 'fulfilled',
      );
      if (!activatedResult) throw new Error('Connection activation missing');
      const activated = activatedResult.value;
      const activatedExternalId = activated.externalUserId;
      expect(activated).toMatchObject({
        userId: 'user:owner',
        conversationId: ownerConversation.id,
      });
      expect(await connections.list('user:owner')).toMatchObject([
        {
          connectionId: pending.connectionId,
          status: 'active',
          activationExpiresAt: null,
        },
      ]);
      await expect(
        connections.activatePending({
          provider: 'telegram',
          connectionId: pending.connectionId,
          externalAccountId: activatedExternalId,
          externalThreadId: activatedExternalId,
          now: new Date(now.getTime() + 2_000),
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        connections.revoke({
          connectionId: pending.connectionId,
          userId: 'user:other',
          now: new Date(now.getTime() + 3_000),
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      expect(
        await connections.revoke({
          connectionId: pending.connectionId,
          userId: 'user:owner',
          now: new Date(now.getTime() + 4_000),
        }),
      ).toMatchObject({ status: 'revoked' });
      expect(
        await bindings.resolvePrivate({
          adapterId: 'telegram.bot',
          externalUserId: activatedExternalId,
          externalThreadId: activatedExternalId,
        }),
      ).toBeNull();
      await expect(
        bindings.bindPrivate({
          adapterId: 'telegram.bot',
          externalUserId: activatedExternalId,
          externalThreadId: activatedExternalId,
          userId: 'user:other',
          conversationId: otherConversation.id,
          now: new Date(now.getTime() + 5_000),
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });

      const expired = await connections.begin({
        provider: 'telegram',
        userId: 'user:owner',
        conversationId: ownerConversation.id,
        now,
        activationExpiresAt: new Date(now.getTime() + 1_000),
      });
      await expect(
        connections.activatePending({
          provider: 'telegram',
          connectionId: expired.connectionId,
          externalAccountId: '84',
          externalThreadId: '84',
          now: new Date(now.getTime() + 1_001),
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      const replacement = await connections.begin({
        provider: 'telegram',
        userId: 'user:owner',
        conversationId: ownerConversation.id,
        now: new Date(now.getTime() + 2_000),
        activationExpiresAt: new Date(now.getTime() + 602_000),
      });
      expect(replacement).toMatchObject({ status: 'pending' });
      expect(replacement.connectionId).not.toBe(expired.connectionId);
      await expect(
        connections.activatePending({
          provider: 'telegram',
          connectionId: replacement.connectionId,
          externalAccountId: activatedExternalId,
          externalThreadId: activatedExternalId,
          now: new Date(now.getTime() + 3_000),
        }),
      ).resolves.toMatchObject({ userId: 'user:owner' });
    });
  },
);
