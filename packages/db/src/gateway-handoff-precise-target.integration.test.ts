import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { DrizzleGatewayHandoffRepository } from './gateway-handoff-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import { artifactVersions, artifacts, assetVersions, assets } from './schema';
import {
  closeGatewayConnection,
  describeWithDatabase,
  getDatabase,
  migrateGatewaySchema,
  now,
  truncateGatewayTables,
} from './gateway-repository.integration-support';

describeWithDatabase('Gateway handoff precise target persistence', () => {
  beforeAll(migrateGatewaySchema);
  beforeEach(truncateGatewayTables);
  afterAll(closeGatewayConnection);

  async function seedConversation() {
    const conversations = new DrizzlePlatformConversationRepository(
      getDatabase(),
    );
    const conversation = await conversations.create({
      ownerSubjectId: 'user:owner',
      spaceKind: 'notebook',
      spaceTitle: 'DP08 精确交接',
      now,
    });
    return conversation;
  }

  async function seedArtifact(spaceId: string) {
    const database = getDatabase();
    const [artifact] = await database
      .insert(artifacts)
      .values({
        spaceId,
        ownerSubjectId: 'user:owner',
        kind: 'mindmap',
        trustTier: 'tier1',
        title: 'DP08 artifact',
        status: 'active',
      })
      .returning();
    const [version] = await database
      .insert(artifactVersions)
      .values({
        artifactId: artifact!.id,
        version: 1,
        content: { nodes: [] },
      })
      .returning();
    return { artifact: artifact!, version: version! };
  }

  async function seedSource(spaceId: string) {
    const database = getDatabase();
    const [asset] = await database
      .insert(assets)
      .values({
        ownerSubjectId: 'user:owner',
        spaceId,
        scope: 'space',
        kind: 'source',
        origin: 'upload',
        displayName: 'DP08 source.pdf',
        mimeType: 'application/pdf',
        status: 'processing',
      })
      .returning();
    const [version] = await database
      .insert(assetVersions)
      .values({
        assetId: asset!.id,
        kind: 'document',
        mimeType: 'application/pdf',
        byteSize: 1024,
        contentHash: 'a'.repeat(64),
        status: 'ready',
        storageKey: 'dp08/source.pdf',
      })
      .returning();
    return { asset: asset!, version: version! };
  }

  it('stores conversation-only handoff with target null (backward compatible)', async () => {
    const handoffs = new DrizzleGatewayHandoffRepository(getDatabase());
    const conversation = await seedConversation();
    await handoffs.issue({
      tokenDigest: 'a'.repeat(64),
      userId: 'user:owner',
      conversationId: conversation.id,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 120_000),
    });
    expect(
      await handoffs.consume({
        tokenDigest: 'a'.repeat(64),
        trustedSubjectId: 'user:owner',
        now: new Date(now.getTime() + 1_000),
      }),
    ).toEqual({
      status: 'consumed',
      conversationId: conversation.id,
      target: null,
    });
  });

  it('persists and returns an artifact target', async () => {
    const handoffs = new DrizzleGatewayHandoffRepository(getDatabase());
    const conversation = await seedConversation();
    const { artifact, version } = await seedArtifact(conversation.spaceId);
    await handoffs.issue({
      tokenDigest: 'b'.repeat(64),
      userId: 'user:owner',
      conversationId: conversation.id,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 120_000),
      target: {
        kind: 'artifact',
        artifactId: artifact.id,
        versionId: version.id,
      },
    });
    expect(
      await handoffs.consume({
        tokenDigest: 'b'.repeat(64),
        trustedSubjectId: 'user:owner',
        now: new Date(now.getTime() + 1_000),
      }),
    ).toEqual({
      status: 'consumed',
      conversationId: conversation.id,
      target: {
        kind: 'artifact',
        artifactId: artifact.id,
        versionId: version.id,
      },
    });
  });

  it('persists and returns a source resource target', async () => {
    const handoffs = new DrizzleGatewayHandoffRepository(getDatabase());
    const conversation = await seedConversation();
    const { asset, version } = await seedSource(conversation.spaceId);
    await handoffs.issue({
      tokenDigest: 'c'.repeat(64),
      userId: 'user:owner',
      conversationId: conversation.id,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 120_000),
      target: {
        kind: 'resource',
        resourceKind: 'source',
        resourceId: asset.id,
        versionId: version.id,
      },
    });
    expect(
      await handoffs.consume({
        tokenDigest: 'c'.repeat(64),
        trustedSubjectId: 'user:owner',
        now: new Date(now.getTime() + 1_000),
      }),
    ).toEqual({
      status: 'consumed',
      conversationId: conversation.id,
      target: {
        kind: 'resource',
        resourceKind: 'source',
        resourceId: asset.id,
        versionId: version.id,
      },
    });
  });

  it('rejects an artifact target owned by another user', async () => {
    const handoffs = new DrizzleGatewayHandoffRepository(getDatabase());
    const conversation = await seedConversation();
    const { artifact } = await seedArtifact(conversation.spaceId);
    await expect(
      handoffs.issue({
        tokenDigest: 'd'.repeat(64),
        userId: 'user:other',
        conversationId: conversation.id,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 120_000),
        target: {
          kind: 'artifact',
          artifactId: artifact.id,
          versionId: null,
        },
      }),
    ).rejects.toThrow('Cannot hand off an inaccessible conversation');
  });

  it('rejects a source target from a different space', async () => {
    const handoffs = new DrizzleGatewayHandoffRepository(getDatabase());
    const ownerConversation = await seedConversation();
    const otherConversation = await new DrizzlePlatformConversationRepository(
      getDatabase(),
    ).create({
      ownerSubjectId: 'user:owner',
      spaceKind: 'notebook',
      spaceTitle: '另一个空间',
      now,
    });
    const { asset } = await seedSource(otherConversation.spaceId);
    await expect(
      handoffs.issue({
        tokenDigest: 'e'.repeat(64),
        userId: 'user:owner',
        conversationId: ownerConversation.id,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 120_000),
        target: {
          kind: 'resource',
          resourceKind: 'source',
          resourceId: asset.id,
          versionId: null,
        },
      }),
    ).rejects.toThrow('Handoff target is not accessible');
  });

  it('rejects a message target outside the conversation', async () => {
    const handoffs = new DrizzleGatewayHandoffRepository(getDatabase());
    const conversationA = await seedConversation();
    const conversationB = await new DrizzlePlatformConversationRepository(
      getDatabase(),
    ).create({
      ownerSubjectId: 'user:owner',
      spaceKind: 'notebook',
      spaceTitle: '会话B',
      now,
    });
    const messages = new DrizzlePlatformConversationRepository(getDatabase());
    const message = await messages.appendCompletedMessage({
      conversationId: conversationB.id,
      trustedSubjectId: 'user:owner',
      role: 'assistant',
      content: '外部消息',
      now,
    });
    await expect(
      handoffs.issue({
        tokenDigest: 'f'.repeat(64),
        userId: 'user:owner',
        conversationId: conversationA.id,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 120_000),
        target: { kind: 'message', messageId: message.id },
      }),
    ).rejects.toThrow('Handoff target is not accessible');
  });
});
