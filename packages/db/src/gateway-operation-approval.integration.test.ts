import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  DrizzleGatewayApprovalRepository,
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayOperationStore,
} from './gateway-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import { DrizzlePlatformTurnRepository } from './platform-turn-repository';
import {
  closeGatewayConnection,
  describeWithDatabase,
  getDatabase,
  migrateGatewaySchema,
  now,
  truncateGatewayTables,
} from './gateway-repository.integration-support';

describeWithDatabase(
  'Gateway operation events, cancellation and approvals',
  () => {
    beforeAll(migrateGatewaySchema);
    beforeEach(truncateGatewayTables);
    afterAll(closeGatewayConnection);

    it('persists resumable ordered events and enforces actor-scoped idempotency', async () => {
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const identities = new DrizzleGatewayIdentityRepository(getDatabase());
      const store = new DrizzleGatewayOperationStore(getDatabase());
      const conversation = await conversations.create({
        ownerSubjectId: 'user:owner',
        spaceKind: 'notebook',
        spaceTitle: 'Gateway账本',
        now,
      });
      const owner = await identities.getActive('user:owner');
      if (!owner) throw new Error('Owner identity missing');
      const route = {
        actorUserId: owner.userId,
        agentId: owner.agentId,
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
        membershipRole: 'owner' as const,
      };
      const started = await store.begin({
        envelopeId: 'envelope:1',
        idempotencyKey: 'message:1',
        requestFingerprint: 'a'.repeat(64),
        route,
        now,
      });
      expect(started.traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(
        (
          await store.begin({
            envelopeId: 'envelope:1',
            idempotencyKey: 'message:1',
            requestFingerprint: 'a'.repeat(64),
            route,
            now,
          })
        ).traceId,
      ).toBe(started.traceId);
      await store.append(
        started.operationId,
        { type: 'operation.accepted' },
        now,
      );
      await store.append(
        started.operationId,
        { type: 'message.delta', delta: '回答' },
        now,
      );
      await store.append(
        started.operationId,
        { type: 'operation.completed', messageId: 'message:assistant:1' },
        now,
      );

      expect(
        (await store.listEvents(started.operationId, 0, owner.userId)).map(
          (event) => [event.sequence, event.type],
        ),
      ).toEqual([
        [1, 'message.delta'],
        [2, 'operation.completed'],
      ]);
      expect(
        await store.begin({
          envelopeId: 'envelope:1',
          idempotencyKey: 'message:1',
          requestFingerprint: 'a'.repeat(64),
          route,
          now,
        }),
      ).toMatchObject({ operationId: started.operationId, replayed: true });
      await expect(
        store.begin({
          envelopeId: 'envelope:2',
          idempotencyKey: 'message:1',
          requestFingerprint: 'b'.repeat(64),
          route,
          now,
        }),
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });
      await expect(
        store.listEvents(started.operationId, -1, 'user:other'),
      ).rejects.toMatchObject({ code: 'operation_not_found' });
      await expect(
        store.append(started.operationId, { type: 'operation.cancelled' }, now),
      ).rejects.toMatchObject({ code: 'invalid_event_sequence' });

      /* describe：取消鉴权用的归属+终态；未知 id 返回 null */
      expect(await store.describe(started.operationId)).toMatchObject({
        actorUserId: owner.userId,
        status: 'completed',
      });
      expect(
        await store.describe('00000000-0000-0000-0000-000000000000'),
      ).toBeNull();

      /* listRecent：只返回本人的回合操作。本 fixture 只给 Space 命名、
         未给 Conversation 命名，故 conversationTitle 为 null——如实反映。 */
      const recent = await store.listRecent(owner.userId);
      expect(recent).toHaveLength(1);
      expect(recent[0]).toMatchObject({
        operationId: started.operationId,
        conversationId: conversation.id,
        conversationTitle: null,
        status: 'completed',
      });
      expect(await store.listRecent('user:other')).toHaveLength(0);
    });

    it('persists actor-scoped cancellation before the Gateway terminal event', async () => {
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const identities = new DrizzleGatewayIdentityRepository(getDatabase());
      const store = new DrizzleGatewayOperationStore(getDatabase());
      const turns = new DrizzlePlatformTurnRepository(getDatabase());
      const conversation = await conversations.create({
        ownerSubjectId: 'user:owner',
        spaceKind: 'notebook',
        spaceTitle: 'Gateway取消',
        now,
      });
      const owner = await identities.getActive('user:owner');
      if (!owner) throw new Error('Owner identity missing');
      const operation = await store.begin({
        envelopeId: 'cancel:envelope',
        idempotencyKey: 'cancel:message',
        requestFingerprint: '9'.repeat(64),
        route: {
          actorUserId: owner.userId,
          agentId: owner.agentId,
          notebookId: conversation.spaceId,
          conversationId: conversation.id,
          membershipRole: 'owner',
        },
        now,
      });

      await expect(
        store.requestCancellation({
          operationId: operation.operationId,
          actorUserId: 'user:other',
          now,
        }),
      ).resolves.toEqual({ recorded: false, continuation: 'none' });
      await expect(
        store.requestCancellation({
          operationId: operation.operationId,
          actorUserId: owner.userId,
          now: new Date(now.getTime() + 1_000),
        }),
      ).resolves.toEqual({ recorded: true, continuation: 'none' });
      await expect(
        store.requestCancellation({
          operationId: operation.operationId,
          actorUserId: owner.userId,
          now: new Date(now.getTime() + 2_000),
        }),
      ).resolves.toEqual({ recorded: true, continuation: 'none' });
      await expect(
        turns.isTurnCancellationRequested({
          trustedSubjectId: owner.userId,
          turnId: operation.operationId,
        }),
      ).resolves.toBe(true);
      await store.append(
        operation.operationId,
        { type: 'operation.cancelled' },
        new Date(now.getTime() + 3_000),
      );
      await expect(
        store.requestCancellation({
          operationId: operation.operationId,
          actorUserId: owner.userId,
          now: new Date(now.getTime() + 4_000),
        }),
      ).resolves.toEqual({ recorded: false, continuation: 'none' });
    });

    it('persists actor-scoped approvals and records an explicit denial terminal', async () => {
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const identities = new DrizzleGatewayIdentityRepository(getDatabase());
      const store = new DrizzleGatewayOperationStore(getDatabase());
      const approvals = new DrizzleGatewayApprovalRepository(getDatabase());
      const conversation = await conversations.create({
        ownerSubjectId: 'user:owner',
        spaceKind: 'notebook',
        spaceTitle: '审批',
        now,
      });
      const owner = await identities.getActive('user:owner');
      if (!owner) throw new Error('Owner identity missing');
      const operation = await store.begin({
        envelopeId: 'approval:envelope',
        idempotencyKey: 'approval:message',
        requestFingerprint: 'c'.repeat(64),
        route: {
          actorUserId: owner.userId,
          agentId: owner.agentId,
          notebookId: conversation.spaceId,
          conversationId: conversation.id,
          membershipRole: 'owner',
        },
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
          type: 'approval.required',
          approval: {
            approvalId: 'approval:1',
            operationId: operation.operationId,
            actorUserId: owner.userId,
            capability: 'filesystem.read_allowlisted',
            risk: 'l2',
            summary: '读取本地学习资料',
            requestedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 60_000).toISOString(),
          },
        },
        now,
      );
      expect(await approvals.listPending(owner.userId, now)).toHaveLength(1);
      await expect(
        store.resolveApproval({
          approvalId: 'approval:1',
          actorUserId: 'user:other',
          status: 'denied',
          now,
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      const resolved = await store.resolveApproval({
        approvalId: 'approval:1',
        actorUserId: owner.userId,
        status: 'denied',
        reason: '不允许',
        now,
      });
      expect(resolved).toMatchObject({
        operationId: operation.operationId,
        continuationId: null,
        decision: { status: 'denied', reason: '不允许' },
      });
      expect(await approvals.listPending(owner.userId, now)).toHaveLength(0);
      expect(
        await store.listEvents(operation.operationId, -1, owner.userId),
      ).toMatchObject([
        { type: 'operation.accepted' },
        { type: 'approval.required' },
        { type: 'approval.resolved' },
        { type: 'operation.failed', code: 'APPROVAL_DENIED' },
      ]);
    });
  },
);
