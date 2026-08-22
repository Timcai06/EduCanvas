import { describe, expect, it, vi } from 'vitest';
import { LinkTrafficLimiter, linkTrafficKey } from './link-traffic-limiter';

vi.mock('server-only', () => ({}));

describe('LinkTrafficLimiter', () => {
  it('shares the request window and concurrency wall by actor and Notebook', () => {
    const limiter = new LinkTrafficLimiter({
      windowMs: 100,
      maxRequests: 3,
      maxConcurrent: 2,
    });
    const key = linkTrafficKey('student-1', 'notebook-1');
    const first = limiter.acquire(key, 1_000);
    const second = limiter.acquire(key, 1_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(limiter.acquire(key, 1_000)).toMatchObject({
      allowed: false,
      reason: 'concurrency',
    });

    if (first.allowed) first.release();
    expect(limiter.acquire(key, 1_010)).toMatchObject({ allowed: true });
    expect(limiter.acquire(key, 1_020)).toMatchObject({
      allowed: false,
      reason: 'rate',
      retryAfterMs: 80,
    });
  });

  it('releases a lease at most once and resets an expired window', () => {
    const limiter = new LinkTrafficLimiter({
      windowMs: 100,
      maxRequests: 1,
      maxConcurrent: 1,
    });
    const key = linkTrafficKey('student-1', 'notebook-1');
    const lease = limiter.acquire(key, 1_000);
    expect(lease.allowed).toBe(true);
    if (lease.allowed) {
      lease.release();
      lease.release();
    }

    expect(limiter.acquire(key, 1_099)).toMatchObject({
      allowed: false,
      reason: 'rate',
    });
    expect(limiter.acquire(key, 1_100)).toMatchObject({ allowed: true });
  });

  it('rejects empty identity keys instead of collapsing tenants together', () => {
    expect(() => linkTrafficKey('', 'notebook-1')).toThrow(
      'link traffic identity is invalid',
    );
    expect(() => linkTrafficKey('student-1', '')).toThrow(
      'link traffic identity is invalid',
    );
  });

  it('fails closed when every bounded key slot has active work', () => {
    const limiter = new LinkTrafficLimiter({
      maxKeys: 1,
      maxConcurrent: 1,
    });
    expect(limiter.acquire('active-key', 1_000)).toMatchObject({
      allowed: true,
    });
    expect(limiter.acquire('new-key', 1_001)).toEqual({
      allowed: false,
      reason: 'concurrency',
      retryAfterMs: 1_000,
    });
  });
});
