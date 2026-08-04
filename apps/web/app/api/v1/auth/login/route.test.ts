import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockSameOrigin } = vi.hoisted(() => ({
  mockSameOrigin: vi.fn(),
}));

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
    mockSameOrigin.mockReturnValue(true);
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
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'auth_rate_limited',
        message: '登录尝试过于频繁。',
        retryAfterMs: 1_250,
      },
    });
    expect(response.headers.get('x-request-id')).toBeTruthy();
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

  it('跨域请求返回 403', async () => {
    mockSameOrigin.mockReturnValue(false);

    const response = await POST(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example.com',
        },
        body: JSON.stringify({ username: 'student', password: 'Password123!' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(authMocks.authenticate).not.toHaveBeenCalled();
  });

  it('凭证错误返回 401 稳定码，不泄露内部异常', async () => {
    authMocks.authenticate.mockRejectedValue(
      new AccountError('invalid_credentials'),
    );

    const response = await POST(
      loginRequest({ username: 'student', password: 'wrong-password' }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('invalid_credentials');
    expect(JSON.stringify(body)).not.toContain('token');
    expect(JSON.stringify(body)).not.toContain('hash');
  });

  it('非 AccountError 的异常返回 503 不泄露细节', async () => {
    authMocks.authenticate.mockRejectedValue(new Error('db connection lost'));

    const response = await POST(
      loginRequest({ username: 'student', password: 'correct-password' }),
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe('login_unavailable');
    expect(JSON.stringify(body)).not.toContain('db connection lost');
  });

  it('Cookie 写入失败在 authenticate 成功后仍应报告错误', async () => {
    authMocks.authenticate.mockResolvedValue({
      userId: 'user-1',
      nickname: '同学',
    });
    authMocks.writeCookie.mockRejectedValue(new Error('cookie write failed'));

    const response = await POST(
      loginRequest({ username: 'student', password: 'correct-password' }),
    );

    // Cookie 写入失败 → 503，但 authenticate 已经成功
    // 注意：session 已写入 DB（createWebSession 在 writeCookie 之前调用）
    expect(response.status).toBe(503);
  });

  it('成功响应不含 token hash 或敏感字段', async () => {
    authMocks.authenticate.mockResolvedValue({
      userId: 'user-1',
      nickname: '同学',
    });

    const response = await POST(
      loginRequest({ username: 'student', password: 'correct-password' }),
    );

    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('hash');
    expect(serialized).not.toContain('password');
  });
});
