import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import {
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayNodeRepository,
  DrizzleGatewayOperationStore,
  DrizzleGatewayRouteResolver,
} from './gateway-repository';
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
    throw new Error('Notebook隐私夹具拒绝使用非隔离数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 2 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

const now = new Date('2026-07-21T06:00:00.000Z');

describeWithDatabase('Notebook privacy research fixture', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table
        gateway_approvals,
        gateway_operation_events,
        gateway_node_invocations,
        gateway_node_pairings,
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

  it('shares a Notebook without replacing the contributor personal Agent', async () => {
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const identities = new DrizzleGatewayIdentityRepository(getDatabase());
    const resolver = new DrizzleGatewayRouteResolver(getDatabase());
    const conversation = await conversations.create({
      ownerSubjectId: 'privacy:owner',
      spaceKind: 'notebook',
      spaceTitle: '共享学习笔记本',
      now,
    });
    const owner = await identities.getActive('privacy:owner');
    const contributor = await identities.ensureRegistered({
      trustedSubjectId: 'privacy:contributor',
      now,
    });
    if (!owner) throw new Error('Owner identity missing');

    await getDatabase().insert(notebookMemberships).values({
      notebookId: conversation.spaceId,
      userId: contributor.userId,
      role: 'contributor',
      grantedByUserId: owner.userId,
      grantedAt: now,
    });

    await expect(
      resolver.resolve({
        principal: {
          subjectId: contributor.userId,
          userId: contributor.userId,
          agentId: contributor.agentId,
          kind: 'user',
          authenticationMethod: 'fixture',
          authenticatedAt: now.toISOString(),
        },
        routeHint: {
          notebookId: conversation.spaceId,
          conversationId: conversation.id,
        },
        requiredPermission: 'conversation.reply',
        now,
      }),
    ).resolves.toEqual({
      actorUserId: contributor.userId,
      agentId: contributor.agentId,
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
      membershipRole: 'contributor',
    });
    expect(contributor.agentId).not.toBe(owner.agentId);
  });

  it.fails(
    'rejects a contributor Operation invoking the Notebook owner private Node',
    async () => {
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const identities = new DrizzleGatewayIdentityRepository(getDatabase());
      const resolver = new DrizzleGatewayRouteResolver(getDatabase());
      const operations = new DrizzleGatewayOperationStore(getDatabase());
      const nodes = new DrizzleGatewayNodeRepository(getDatabase());
      const conversation = await conversations.create({
        ownerSubjectId: 'privacy:owner',
        spaceKind: 'notebook',
        spaceTitle: '共享学习笔记本',
        now,
      });
      const owner = await identities.getActive('privacy:owner');
      const contributor = await identities.ensureRegistered({
        trustedSubjectId: 'privacy:contributor',
        now,
      });
      if (!owner) throw new Error('Owner identity missing');

      await getDatabase().insert(notebookMemberships).values({
        notebookId: conversation.spaceId,
        userId: contributor.userId,
        role: 'contributor',
        grantedByUserId: owner.userId,
        grantedAt: now,
      });
      const contributorRoute = await resolver.resolve({
        principal: {
          subjectId: contributor.userId,
          userId: contributor.userId,
          agentId: contributor.agentId,
          kind: 'user',
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
      const operation = await operations.begin({
        envelopeId: 'privacy:contributor:envelope',
        idempotencyKey: 'privacy:contributor:turn',
        requestFingerprint: 'a'.repeat(64),
        route: contributorRoute,
        now,
      });
      const manifest = {
        manifestId: 'privacy:owner:node-manifest',
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
      const ownerNode = await nodes.pair({
        userId: owner.userId,
        request: {
          pairingRequestId: 'privacy:owner:pairing',
          displayName: 'Owner private Node',
          devicePublicKey: 'owner-public-key-material'.repeat(4),
          nonce: 'privacy:owner:pairing:nonce',
          requestedCapabilities: manifest,
          requestedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        },
        now,
      });

      expect(ownerNode.agentId).toBe(owner.agentId);
      expect(contributorRoute.agentId).not.toBe(ownerNode.agentId);
      await expect(
        nodes.enqueue({
          requestId: 'privacy:cross-actor:request',
          operationId: operation.operationId,
          nodeId: ownerNode.nodeId,
          capability: 'device.status',
          parameters: {},
          nonce: 'privacy:cross-actor:nonce',
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    },
  );
});
