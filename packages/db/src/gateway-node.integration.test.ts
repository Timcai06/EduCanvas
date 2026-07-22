import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayNodeRepository,
  DrizzleGatewayOperationStore,
} from './gateway-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import {
  closeGatewayConnection,
  describeWithDatabase,
  getDatabase,
  migrateGatewaySchema,
  now,
  truncateGatewayTables,
} from './gateway-repository.integration-support';

describeWithDatabase('Gateway capability-scoped Node lifecycle', () => {
  beforeAll(migrateGatewaySchema);
  beforeEach(truncateGatewayTables);
  afterAll(closeGatewayConnection);

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
    await expect(
      nodes.listAvailableCapabilitiesForOperation({
        operationId: operation.operationId,
        actorId: owner.userId,
        agentId: owner.agentId,
        activeAfter: new Date(now.getTime() - 1_000),
      }),
    ).resolves.toEqual(['device.status']);
    const toolInvocation = await nodes.enqueueForOperation({
      requestId: 'node:tool:request:1',
      operationId: operation.operationId,
      actorId: owner.userId,
      agentId: owner.agentId,
      capability: 'device.status',
      parameters: {},
      nonce: 'node:tool:nonce:1',
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      activeAfter: new Date(now.getTime() - 1_000),
    });
    expect(toolInvocation.nodeId).toBe(pairing.nodeId);
    await expect(
      nodes.readInvocationOutcome({
        operationId: operation.operationId,
        actorId: owner.userId,
        agentId: owner.agentId,
        requestId: toolInvocation.requestId,
        now,
      }),
    ).resolves.toEqual({ status: 'pending' });
    await nodes.settle({
      requestId: toolInvocation.requestId,
      nodeId: pairing.nodeId,
      status: 'completed',
      completedAt: now.toISOString(),
      output: {
        platform: 'test',
        architecture: 'fixture',
        hostname: 'fixture-node',
        uptimeSeconds: 1,
      },
    });
    await expect(
      nodes.readInvocationOutcome({
        operationId: operation.operationId,
        actorId: owner.userId,
        agentId: owner.agentId,
        requestId: toolInvocation.requestId,
        now,
      }),
    ).resolves.toMatchObject({
      status: 'settled',
      result: { status: 'completed', requestId: toolInvocation.requestId },
    });
    await expect(
      nodes.enqueueForOperation({
        requestId: toolInvocation.requestId,
        operationId: operation.operationId,
        actorId: owner.userId,
        agentId: owner.agentId,
        capability: 'device.status',
        parameters: {},
        nonce: 'node:tool:nonce:1',
        issuedAt: new Date(now.getTime() + 1_000),
        expiresAt: new Date(now.getTime() + 61_000),
        activeAfter: new Date(now.getTime() - 1_000),
      }),
    ).resolves.toEqual(toolInvocation);
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
});
