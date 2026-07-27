import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  DrizzleGatewayDirectoryRepository,
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayOperationStore,
  DrizzleGatewayRouteResolver,
  GatewayPersistenceError,
} from './gateway-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import { DrizzlePlatformTurnRepository } from './platform-turn-repository';
import { notebookMemberships } from './schema';
import {
  closeGatewayConnection,
  describeWithDatabase,
  getDatabase,
  migrateGatewaySchema,
  now,
  truncateGatewayTables,
} from './gateway-repository.integration-support';

describeWithDatabase(
  'Gateway identity, routing and directory persistence',
  () => {
    beforeAll(migrateGatewaySchema);
    beforeEach(truncateGatewayTables);
    afterAll(closeGatewayConnection);

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
        agentProfileId: 'k12.teacher',
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
        agentProfileId: 'k12.teacher',
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
      expect(
        await store.describe(operation.operationId, member.userId, now),
      ).toMatchObject({
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
  },
);
