import { describe, expect, it } from 'vitest';
import {
  gatewayConnectionConnectRequestSchema,
  gatewayConnectionListSchema,
  gatewayConnectionProviderDescriptorSchema,
} from './channels';

describe('Gateway connection contracts', () => {
  it('keeps provider contracts independent from adapter details', () => {
    expect(
      gatewayConnectionConnectRequestSchema.parse({
        provider: 'telegram',
        conversationId: 'conversation:1',
      }),
    ).toEqual({ provider: 'telegram', conversationId: 'conversation:1' });
    expect(() =>
      gatewayConnectionConnectRequestSchema.parse({
        provider: 'telegram.bot',
        conversationId: 'conversation:1',
      }),
    ).toThrow();
  });

  it('requires disabled providers to explain the honest limitation', () => {
    expect(() =>
      gatewayConnectionProviderDescriptorSchema.parse({
        provider: 'wechat',
        label: '微信',
        availability: 'disabled',
        disabledReason: null,
        experimental: false,
      }),
    ).toThrow();
  });

  it('bounds provider and connection lists', () => {
    expect(() =>
      gatewayConnectionListSchema.parse({
        providers: [],
        connections: Array.from({ length: 101 }, (_, index) => ({
          connectionId: `connection:${index}`,
          provider: 'telegram',
          status: 'active',
          conversationId: 'conversation:1',
          createdAt: '2026-07-21T08:00:00.000Z',
          activationExpiresAt: null,
          revokedAt: null,
        })),
      }),
    ).toThrow();
  });
});
