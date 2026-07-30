import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockSameOrigin } = vi.hoisted(() => ({
  mockSameOrigin: vi.fn(),
}));

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

vi.mock('@/server/http/request-security', async () => {
  const actual = await vi.importActual<
    typeof import('@/server/http/request-security')
  >('@/server/http/request-security');
  return {
    ...actual,
    isTrustedSameOriginWrite: mockSameOrigin,
  };
});

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
  mockSameOrigin.mockReturnValue(true);
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

  it('跨域请求返回 403', async () => {
    mockSameOrigin.mockReturnValue(false);

    const response = await POST(
      new Request('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example.com',
        },
        body: JSON.stringify({
          username: 'student',
          nickname: '同学',
          password: 'Password123!',
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.registerAndCreateSession).not.toHaveBeenCalled();
  });

  it('非 AccountError 异常返回 503 不泄露细节', async () => {
    mocks.registerAndCreateSession.mockRejectedValue(
      new Error('db connection lost'),
    );

    const response = await POST(registerRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe('register_unavailable');
    expect(JSON.stringify(body)).not.toContain('db connection lost');
  });

  it('成功响应不含 token hash 或敏感字段', async () => {
    const response = await POST(registerRequest());

    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('hash');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('tokenHash');
  });

  it('prepareWebSession 的 token 只在内存，tokenHash 才传给仓储', async () => {
    const response = await POST(registerRequest());

    expect(response.status).toBe(201);
    // tokenHash 传给 registerAndCreateSession
    expect(mocks.registerAndCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        newSession: {
          tokenHash: 'a'.repeat(64),
          expiresAt: expect.any(Date),
        },
      }),
    );
    // raw token 传给 writeCookie，不传给 registerAndCreateSession
    expect(mocks.writeCookie).toHaveBeenCalledWith('raw-token');
    // raw token 不在 registerAndCreateSession 的参数中
    const registerCall = mocks.registerAndCreateSession.mock.calls[0]![0];
    expect(JSON.stringify(registerCall)).not.toContain('raw-token');
  });
});
