import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  changeAndRotate: vi.fn(),
  readIdentity: vi.fn(),
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
      changePasswordAndRotateSession = mocks.changeAndRotate;
    },
  };
});
vi.mock('@/server/auth/session', () => ({
  prepareWebSession: mocks.prepareSession,
  readRegisteredSessionIdentity: mocks.readIdentity,
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

function passwordRequest(): Request {
  return new Request('http://localhost/api/v1/me/password', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify({
      currentPassword: 'Current123!',
      newPassword: 'Replacement123!',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readIdentity.mockResolvedValue({ userId: 'user:one' });
  mocks.prepareSession.mockReturnValue({
    token: 'raw-token',
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date('2026-08-24T00:00:00.000Z'),
    now: new Date('2026-07-24T00:00:00.000Z'),
  });
  mocks.checkAttempt.mockReturnValue({ allowed: true });
  mocks.recordFailure.mockReturnValue({ allowed: true });
  mocks.changeAndRotate.mockResolvedValue(undefined);
  mocks.writeCookie.mockResolvedValue(undefined);
});

describe('POST /api/v1/me/password', () => {
  it('用单一数据库事务轮换密码和session，提交后才写cookie', async () => {
    const response = await POST(passwordRequest());

    expect(response.status).toBe(200);
    expect(mocks.changeAndRotate).toHaveBeenCalledWith({
      userId: 'user:one',
      currentPassword: 'Current123!',
      newPassword: 'Replacement123!',
      newSession: {
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date('2026-08-24T00:00:00.000Z'),
      },
      now: new Date('2026-07-24T00:00:00.000Z'),
    });
    expect(mocks.writeCookie).toHaveBeenCalledWith('raw-token');
    const transactionOrder = mocks.changeAndRotate.mock.invocationCallOrder[0];
    const cookieOrder = mocks.writeCookie.mock.invocationCallOrder[0];
    expect(transactionOrder).toBeDefined();
    expect(cookieOrder).toBeDefined();
    expect(transactionOrder ?? Number.MAX_SAFE_INTEGER).toBeLessThan(
      cookieOrder ?? 0,
    );
  });

  it('事务失败时不写入新cookie', async () => {
    mocks.changeAndRotate.mockRejectedValue(
      new AccountError('invalid_current_password'),
    );

    const response = await POST(passwordRequest());

    expect(response.status).toBe(400);
    expect(mocks.writeCookie).not.toHaveBeenCalled();
  });
});
