import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayApprovalRepository,
  DrizzleGatewayChannelBindingRepository,
  DrizzleGatewayDeliveryRepository,
  DrizzleGatewayDirectoryRepository,
  DrizzleGatewayNodeRepository,
  DrizzleGatewayOperationStore,
  DrizzleGatewayRouteResolver,
  GatewayPersistenceError,
  type GatewayChannelPrivateRoute,
} from './gateway-repository';
import { DrizzleGatewayHandoffRepository } from './gateway-handoff-repository';
import { DrizzleGatewayConnectionRepository } from './gateway-connection-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import { DrizzlePlatformTurnRepository } from './platform-turn-repository';
import { notebookMemberships } from './schema';
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

const now = new Date('2026-07-19T04:00:00.000Z');

describeWithDatabase(
  'Gateway identity, routing and operation persistence',
  () => {
    beforeAll(async () => {
      await migrate(getDatabase(), {
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      });
    });

    beforeEach(async () => {
      await getDatabase().execute(sql`
      truncate table
        gateway_handoff_tokens,
        gateway_approvals,
        gateway_operation_events,
        gateway_deliveries,
        gateway_node_invocations,
        gateway_node_pairings,
        gateway_channel_thread_bindings,
        gateway_channel_account_bindings,
        agent_operations,
        conversation_messages,
        conversations,
        notebook_memberships,
        spaces,
        personal_agents,
        platform_users
      restart identity cascade
    `);
    });

    afterAll(async () => {
      await connection?.end({ timeout: 5 });
    });

    it('creates one personal Agent and owner membership with a Notebook', async () => {
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const identity = new DrizzleGatewayIdentityRepository(getDatabase());
      const conversation = await conversations.create({
        ownerSubjectId: 'user:owner',
        spaceKind: 'notebook',
        spaceTitle: '个人笔记本',
        now,
      });

      const owner = await identity.getActive('user:owner');
      expect(owner).toMatchObject({
        userId: 'user:owner',
        kind: 'registered',
      });
      expect(owner?.agentId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(
        await getDatabase().select().from(notebookMemberships),
      ).toMatchObject([
        {
          notebookId: conversation.spaceId,
          userId: 'user:owner',
          role: 'owner',
          grantedByUserId: 'user:owner',
        },
      ]);
    });

    it('idempotently ensures one default personal workspace under concurrent onboarding', async () => {
      const directory = new DrizzleGatewayDirectoryRepository(getDatabase());
      const [left, right] = await Promise.all([
        directory.ensurePersonalWorkspace({ userId: 'local:owner', now }),
        directory.ensurePersonalWorkspace({ userId: 'local:owner', now }),
      ]);
      expect(left).toEqual(right);
      expect(await directory.listConversations('local:owner', now)).toEqual([
        left,
      ]);
      expect(left).toMatchObject({
        title: '我的学习笔记本',
        agentProfileId: 'general',
        membershipRole: 'owner',
      });
    });

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

    it('allows a contributor to use a shared Notebook without sharing Agent identity', async () => {
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const identities = new DrizzleGatewayIdentityRepository(getDatabase());
      const routeResolver = new DrizzleGatewayRouteResolver(getDatabase());
      const conversation = await conversations.create({
        ownerSubjectId: 'user:owner',
        spaceKind: 'notebook',
        spaceTitle: '班级笔记本',
        now,
      });
      const member = await identities.ensureAnonymousCompatibility({
        trustedSubjectId: 'user:student',
        now,
      });
      await getDatabase().insert(notebookMemberships).values({
        notebookId: conversation.spaceId,
        userId: member.userId,
        role: 'contributor',
        grantedByUserId: 'user:owner',
        grantedAt: now,
      });

      const resolved = await routeResolver.resolve({
        principal: {
          subjectId: member.userId,
          userId: member.userId,
          agentId: member.agentId,
          kind: 'anonymous_compat',
          authenticationMethod: 'fixture',
          authenticatedAt: now.toISOString(),
        },
        routeHint: {
          notebookId: conversation.spaceId,
          conversationId: conversation.id,
        },
        requiredPermission: 'conversation.reply',
        now,
      });

      expect(resolved).toEqual({
        actorUserId: member.userId,
        agentId: member.agentId,
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
        membershipRole: 'contributor',
      });
      expect(resolved.agentId).not.toBe(
        (await identities.getActive('user:owner'))?.agentId,
      );

      const store = new DrizzleGatewayOperationStore(getDatabase());
      const turns = new DrizzlePlatformTurnRepository(getDatabase());
      const operation = await store.begin({
        envelopeId: 'shared:envelope',
        idempotencyKey: 'shared:message',
        requestFingerprint: 'f'.repeat(64),
        route: resolved,
        now,
      });
      await store.append(
        operation.operationId,
        { type: 'operation.accepted' },
        now,
      );
      const turn = await turns.attachGatewayTurn({
        operationId: operation.operationId,
        conversationId: conversation.id,
        trustedSubjectId: member.userId,
        clientMessageId: 'shared:message',
        text: '共享笔记本中的问题',
        now,
      });
      await store.append(
        operation.operationId,
        {
          type: 'message.started',
          userMessageId: turn.studentMessage.id,
          assistantMessageId: turn.assistantMessage.id,
          replayed: false,
        },
        now,
      );
      await turns.settleTurn({
        conversationId: conversation.id,
        trustedSubjectId: member.userId,
        turnId: operation.operationId,
        status: 'completed',
        content: '回答',
        operationTerminalWriter: 'gateway',
        now,
      });
      expect(await store.describe(operation.operationId)).toMatchObject({
        status: 'running',
      });
      await store.append(
        operation.operationId,
        {
          type: 'operation.completed',
          messageId: turn.assistantMessage.id,
        },
        now,
      );
      expect(
        (await store.listEvents(operation.operationId, -1, member.userId)).map(
          (event) => event.type,
        ),
      ).toEqual([
        'operation.accepted',
        'message.started',
        'operation.completed',
      ]);
    });

    it('denies viewer replies and users without membership', async () => {
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const identities = new DrizzleGatewayIdentityRepository(getDatabase());
      const resolver = new DrizzleGatewayRouteResolver(getDatabase());
      const conversation = await conversations.create({
        ownerSubjectId: 'user:owner',
        spaceKind: 'notebook',
        spaceTitle: '只读资料',
        now,
      });
      const viewer = await identities.ensureAnonymousCompatibility({
        trustedSubjectId: 'user:viewer',
        now,
      });
      const outsider = await identities.ensureAnonymousCompatibility({
        trustedSubjectId: 'user:outsider',
        now,
      });
      await getDatabase().insert(notebookMemberships).values({
        notebookId: conversation.spaceId,
        userId: viewer.userId,
        role: 'viewer',
        grantedByUserId: 'user:owner',
        grantedAt: now,
      });

      const routeHint = {
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
      };
      await expect(
        resolver.resolve({
          principal: {
            subjectId: viewer.userId,
            userId: viewer.userId,
            agentId: viewer.agentId,
            kind: 'anonymous_compat',
            authenticationMethod: 'fixture',
            authenticatedAt: now.toISOString(),
          },
          routeHint,
          requiredPermission: 'conversation.reply',
          now,
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        resolver.resolve({
          principal: {
            subjectId: outsider.userId,
            userId: outsider.userId,
            agentId: outsider.agentId,
            kind: 'anonymous_compat',
            authenticationMethod: 'fixture',
            authenticatedAt: now.toISOString(),
          },
          routeHint,
          requiredPermission: 'notebook.read',
          now,
        }),
      ).rejects.toBeInstanceOf(GatewayPersistenceError);
    });

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

    it('pairs, heartbeats, invokes and revokes a capability-scoped Node', async () => {
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const identities = new DrizzleGatewayIdentityRepository(getDatabase());
      const store = new DrizzleGatewayOperationStore(getDatabase());
      const nodes = new DrizzleGatewayNodeRepository(getDatabase());
      const conversation = await conversations.create({
        ownerSubjectId: 'user:owner',
        spaceKind: 'notebook',
        spaceTitle: '节点',
        now,
      });
      const owner = await identities.getActive('user:owner');
      if (!owner) throw new Error('Owner identity missing');
      const operation = await store.begin({
        envelopeId: 'node:envelope',
        idempotencyKey: 'node:message',
        requestFingerprint: 'e'.repeat(64),
        route: {
          actorUserId: owner.userId,
          agentId: owner.agentId,
          notebookId: conversation.spaceId,
          conversationId: conversation.id,
          membershipRole: 'owner',
        },
        now,
      });
      const manifest = {
        manifestId: 'node:manifest',
        issuedAt: now.toISOString(),
        capabilities: [
          {
            name: 'device.status' as const,
            risk: 'l0' as const,
            version: '1',
            constraints: {},
          },
        ],
      };
      const pairing = await nodes.pair({
        userId: owner.userId,
        request: {
          pairingRequestId: 'pairing:1',
          displayName: 'Test Node',
          devicePublicKey: 'public-key-material'.repeat(4),
          nonce: 'pairing:nonce',
          requestedCapabilities: manifest,
          requestedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        },
        now,
      });
      await nodes.heartbeat(
        {
          nodeId: pairing.nodeId,
          sessionId: 'node:session',
          sequence: 0,
          occurredAt: now.toISOString(),
          capabilities: manifest,
        },
        now,
      );
      const invocation = {
        requestId: 'node:request:1',
        operationId: operation.operationId,
        nodeId: pairing.nodeId,
        capability: 'device.status',
        parameters: {},
        nonce: 'node:nonce:1',
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      };
      await nodes.enqueue(invocation);
      expect(await nodes.poll(pairing.nodeId, now)).toHaveLength(1);
      await nodes.settle({
        requestId: invocation.requestId,
        nodeId: pairing.nodeId,
        status: 'completed',
        completedAt: now.toISOString(),
        output: { platform: 'test' },
      });
      await expect(
        nodes.settle({
          requestId: invocation.requestId,
          nodeId: pairing.nodeId,
          status: 'completed',
          completedAt: now.toISOString(),
          output: {},
        }),
      ).rejects.toMatchObject({ code: 'invalid_event_sequence' });
      await nodes.revoke(pairing.nodeId, now);
      await expect(nodes.poll(pairing.nodeId, now)).rejects.toMatchObject({
        code: 'forbidden',
      });
    });
  },
);
