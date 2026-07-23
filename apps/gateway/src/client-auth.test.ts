import { describe, expect, it } from 'vitest';
import { GatewayClientSessionAuth } from './client-auth';

describe('GatewayClientSessionAuth', () => {
  const secret = 's'.repeat(32);
  const now = new Date('2026-07-19T04:00:00.000Z');

  it('issues an actor-bound expiring token and rejects tampering', () => {
    const auth = new GatewayClientSessionAuth(secret, 60, () => now);
    const issued = auth.issue('user:1');
    expect(auth.verify(issued.token)).toMatchObject({ userId: 'user:1' });
    expect(auth.verify(`${issued.token}x`)).toBeNull();
  });

  it('rejects expired sessions', () => {
    let current = now;
    const auth = new GatewayClientSessionAuth(secret, 1, () => current);
    const issued = auth.issue('user:1');
    current = new Date(now.getTime() + 1_001);
    expect(auth.verify(issued.token)).toBeNull();
  });
});
