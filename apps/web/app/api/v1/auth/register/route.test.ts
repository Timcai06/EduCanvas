import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  registerAndCreateSession: vi.fn(),
  prepareSession: vi.fn(),
  writeCookie: vi.fn(),
  checkAttempt: vi.fn(),
  recordFailure: vi.fn(),
  resetFailures: vi.fn(),
}));

vi.mock('@/server/auth/account-repository', () => {
  class AccountError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    AccountError,
    WebAccountRepository: class {
      registerAndCreateSession = mocks.registerAndCreateSession;
    },
  };
});
vi.mock('@/server/auth/session', () => ({
  prepareWebSession: mocks.prepareSession,
  writeWebSessionCookie: mocks.writeCookie,
}));
vi.mock('@/server/auth/rate-limit', () => ({
  authRateLimitDeploymentReady: vi.fn(() => true),
  checkAuthAttempt: mocks.checkAttempt,
  recordAuthFailure: mocks.recordFailure,
  resetAuthFailures: mocks.resetFailures,
}));

import { AccountError } from '@/server/auth/account-repository';
import { POST } from './route';

function registerRequest(): Request {
  return new Request('http://localhost/api/v1/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify({
      username: 'student',
      nickname: '同学',
      password: 'Password123!',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepareSession.mockReturnValue({
    token: 'raw-token',
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date('2026-08-24T00:00:00.000Z'),
    now: new Date('2026-07-24T00:00:00.000Z'),
  });
  mocks.checkAttempt.mockReturnValue({ allowed: true });
  mocks.recordFailure.mockReturnValue({ allowed: true });
  mocks.registerAndCreateSession.mockResolvedValue({
    userId: 'user:one',
    username: 'student',
    nickname: '同学',
    avatarAvailable: false,
  });
  mocks.writeCookie.mockResolvedValue(undefined);
});

describe('POST /api/v1/auth/register', () => {
  it('用同一事务创建账号与首个session，提交后才写cookie', async () => {
    const response = await POST(registerRequest());

    expect(response.status).toBe(201);
    expect(mocks.registerAndCreateSession).toHaveBeenCalledWith({
      username: 'student',
      nickname: '同学',
      password: 'Password123!',
      newSession: {
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date('2026-08-24T00:00:00.000Z'),
      },
      now: new Date('2026-07-24T00:00:00.000Z'),
    });
    expect(mocks.writeCookie).toHaveBeenCalledWith('raw-token');
  });

  it('账号事务失败时不写cookie并稳定映射用户名冲突', async () => {
    mocks.registerAndCreateSession.mockRejectedValue(
      new AccountError('username_taken'),
    );

    const response = await POST(registerRequest());

    expect(response.status).toBe(409);
    expect(mocks.writeCookie).not.toHaveBeenCalled();
  });
});
