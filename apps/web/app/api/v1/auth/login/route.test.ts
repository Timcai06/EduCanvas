import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const authMocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createSession: vi.fn(),
  writeCookie: vi.fn(),
  deploymentReady: vi.fn(),
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
      authenticate = authMocks.authenticate;
    },
  };
});

vi.mock('@/server/auth/session', () => ({
  createWebSession: authMocks.createSession,
  writeWebSessionCookie: authMocks.writeCookie,
}));

vi.mock('@/server/auth/rate-limit', () => ({
  authRateLimitDeploymentReady: authMocks.deploymentReady,
  checkAuthAttempt: authMocks.checkAttempt,
  recordAuthFailure: authMocks.recordFailure,
  resetAuthFailures: authMocks.resetFailures,
}));

import { AccountError } from '@/server/auth/account-repository';
import { POST } from './route';

function loginRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.deploymentReady.mockReturnValue(true);
    authMocks.checkAttempt.mockReturnValue({ allowed: true });
    authMocks.recordFailure.mockReturnValue({ allowed: true });
    authMocks.createSession.mockResolvedValue('session-token');
    authMocks.writeCookie.mockResolvedValue(undefined);
  });

  it('在仓储调用前拒绝超长密码', async () => {
    const response = await POST(
      loginRequest({ username: 'student', password: 'x'.repeat(129) }),
    );

    expect(response.status).toBe(400);
    expect(authMocks.authenticate).not.toHaveBeenCalled();
  });

  it('失败达到阈值时返回稳定 429 与 Retry-After', async () => {
    authMocks.authenticate.mockRejectedValue(
      new AccountError('invalid_credentials'),
    );
    authMocks.recordFailure.mockReturnValue({
      allowed: false,
      retryAfterMs: 1_250,
    });

    const response = await POST(
      loginRequest({ username: 'Student', password: 'wrong-password' }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('2');
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'auth_rate_limited',
        message: '登录尝试过于频繁。',
        retryAfterMs: 1_250,
      },
    });
    expect(authMocks.recordFailure).toHaveBeenCalledWith('login:student');
  });

  it('成功登录后重置同一主体的失败窗口', async () => {
    authMocks.authenticate.mockResolvedValue({
      userId: 'user-1',
      nickname: '同学',
    });

    const response = await POST(
      loginRequest({ username: 'Student', password: 'correct-password' }),
    );

    expect(response.status).toBe(200);
    expect(authMocks.resetFailures).toHaveBeenCalledWith('login:student');
  });

  it('非本地部署缺少共享限流声明时 fail closed', async () => {
    authMocks.deploymentReady.mockReturnValue(false);

    const response = await POST(
      loginRequest({ username: 'student', password: 'correct-password' }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'auth_rate_limit_unavailable' },
    });
    expect(authMocks.authenticate).not.toHaveBeenCalled();
  });
});
