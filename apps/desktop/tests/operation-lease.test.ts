import { describe, expect, it } from 'vitest';
import { createOperationLease } from '../src/main/operation-lease';

describe('cross-window operation lease', () => {
  it('allows one desktop window operation at a time', () => {
    const lease = createOperationLease(() => 'lease-1');
    const token = lease.acquire(7);

    expect(token).toBe('lease-1');
    expect(lease.acquire(8)).toBeNull();
    expect(lease.holds(7, token!)).toBe(true);
    expect(lease.holds(8, token!)).toBe(false);
    expect(lease.release(8, token!)).toBe(false);
    expect(lease.release(7, token!)).toBe(true);
    expect(lease.acquire(8)).toBe('lease-1');
  });

  it('releases a lease when its renderer window is destroyed', () => {
    const lease = createOperationLease(() => 'lease-1');
    lease.acquire(7);

    expect(lease.releaseOwner(7)).toBe(true);
    expect(lease.acquire(8)).toBe('lease-1');
  });
});
