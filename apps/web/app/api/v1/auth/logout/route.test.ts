import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockRevokeSession, mockCheckSameOrigin } = vi.hoisted(() => ({
  mockRevokeSession: vi.fn(),
  mockCheckSameOrigin: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({
  revokeCurrentWebSession: mockRevokeSession,
}));

vi.mock('@/server/http/request-security', async () => {
  const actual = await vi.importActual<
    typeof import('@/server/http/request-security')
  >('@/server/http/request-security');
  return {
    ...actual,
    isTrustedSameOriginWrite: mockCheckSameOrigin,
  };
});

import { POST } from './route';

function logoutRequest(origin = 'http://localhost'): Request {
  return new Request('http://localhost/api/v1/auth/logout', {
    method: 'POST',
    headers: { origin },
  });
}

describe('POST /api/v1/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckSameOrigin.mockReturnValue(true);
    mockRevokeSession.mockResolvedValue(undefined);
  });

  it('成功退出返回 200', async () => {
    const response = await POST(logoutRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mockRevokeSession).toHaveBeenCalledTimes(1);
  });

  it('跨域请求返回 403', async () => {
    mockCheckSameOrigin.mockReturnValue(false);

    const response = await POST(logoutRequest('https://evil.example.com'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'forbidden_origin' },
    });
    expect(mockRevokeSession).not.toHaveBeenCalled();
  });

  it('重复退出幂等 — 两次都返回 200', async () => {
    const first = await POST(logoutRequest());
    const second = await POST(logoutRequest());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockRevokeSession).toHaveBeenCalledTimes(2);
  });

  it('revoke 失败返回 503，不泄露内部异常', async () => {
    mockRevokeSession.mockRejectedValue(new Error('db connection lost'));

    const response = await POST(logoutRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe('logout_unavailable');
    // 不泄露原始错误信息
    expect(JSON.stringify(body)).not.toContain('db connection lost');
    expect(JSON.stringify(body)).not.toContain('token');
    expect(JSON.stringify(body)).not.toContain('hash');
  });

  it('响应中不含 token、hash 或 session 信息', async () => {
    const response = await POST(logoutRequest());

    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('hash');
    expect(serialized).not.toContain('session');
    expect(serialized).not.toContain('cookie');
  });
});
