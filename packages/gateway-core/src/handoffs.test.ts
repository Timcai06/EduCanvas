import { describe, expect, it } from 'vitest';
import {
  gatewayHandoffCredentialSchema,
  gatewayHandoffIssueRequestSchema,
} from './handoffs';

describe('Gateway handoff contracts', () => {
  it('accepts only a bounded opaque credential', () => {
    expect(
      gatewayHandoffCredentialSchema.parse({
        token: 'a'.repeat(43),
        expiresAt: '2026-07-21T08:02:00.000Z',
      }),
    ).toEqual({
      token: 'a'.repeat(43),
      expiresAt: '2026-07-21T08:02:00.000Z',
    });
    expect(() =>
      gatewayHandoffCredentialSchema.parse({
        token: 'conversation:1',
        expiresAt: '2026-07-21T08:02:00.000Z',
      }),
    ).toThrow();
  });

  it('does not accept ownership or expiry claims from the client', () => {
    expect(() =>
      gatewayHandoffIssueRequestSchema.parse({
        conversationId: 'conversation:1',
        userId: 'attacker:chosen',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
