import { describe, expect, it } from 'vitest';
import type { GatewayChannelConnection } from '@educanvas/gateway-core';
import {
  createDefaultGatewayConnectionProviders,
  GatewayConnectionRuntimeError,
  GatewayConnectionService,
  type GatewayConnectionRepositoryPort,
} from './connections';

const now = new Date('2026-07-21T08:00:00.000Z');

class MemoryConnections implements GatewayConnectionRepositoryPort {
  readonly records: GatewayChannelConnection[] = [];

  async list(userId: string): Promise<readonly GatewayChannelConnection[]> {
    return this.records.filter((record) =>
      record.connectionId.startsWith(userId),
    );
  }

  async begin(input: Parameters<GatewayConnectionRepositoryPort['begin']>[0]) {
    const connection: GatewayChannelConnection = {
      connectionId: `${input.userId}:connection:1`,
      provider: input.provider,
      status: 'pending',
      conversationId: input.conversationId,
      createdAt: input.now.toISOString(),
      activationExpiresAt: input.activationExpiresAt.toISOString(),
      revokedAt: null,
    };
    this.records.push(connection);
    return connection;
  }

  async revoke(
    input: Parameters<GatewayConnectionRepositoryPort['revoke']>[0],
  ) {
    const record = this.records.find(
      (candidate) => candidate.connectionId === input.connectionId,
    );
    if (!record) throw new Error('missing');
    const revoked: GatewayChannelConnection = {
      ...record,
      status: 'revoked',
      activationExpiresAt: null,
      revokedAt: input.now.toISOString(),
    };
    this.records.splice(this.records.indexOf(record), 1, revoked);
    return revoked;
  }
}

describe('GatewayConnectionService', () => {
  it('creates a provider-neutral pending connection and bounded authorization', async () => {
    const repository = new MemoryConnections();
    const service = new GatewayConnectionService(
      repository,
      createDefaultGatewayConnectionProviders({
        telegramBotUsername: '@EduCanvasTutorBot',
      }),
      () => now,
    );
    const result = await service.connect({
      userId: 'user:1',
      request: { provider: 'telegram', conversationId: 'conversation:1' },
    });
    expect(result).toMatchObject({
      connection: { provider: 'telegram', status: 'pending' },
      authorization: {
        kind: 'external_url',
        expiresAt: '2026-07-21T08:10:00.000Z',
      },
    });
    expect(result.authorization.url).toContain('start=educanvas_');
  });

  it('keeps unqualified providers explicitly disabled', async () => {
    const service = new GatewayConnectionService(
      new MemoryConnections(),
      createDefaultGatewayConnectionProviders({}),
      () => now,
    );
    const listed = await service.list('user:1');
    expect(listed.providers).toMatchObject([
      { provider: 'telegram', availability: 'disabled' },
      { provider: 'wechat', availability: 'disabled' },
      { provider: 'qq', availability: 'disabled' },
    ]);
    await expect(
      service.connect({
        userId: 'user:1',
        request: { provider: 'wechat', conversationId: 'conversation:1' },
      }),
    ).rejects.toBeInstanceOf(GatewayConnectionRuntimeError);
  });
});
