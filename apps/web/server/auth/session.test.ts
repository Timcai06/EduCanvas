import { createHash } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockCookieStore, mockRevokeByTokenHash, mockCreate, mockFindActive } =
  vi.hoisted(() => ({
    mockCookieStore: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    },
    mockRevokeByTokenHash: vi.fn(),
    mockCreate: vi.fn(),
    mockFindActive: vi.fn(),
  }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

vi.mock('@educanvas/db', () => ({
  DrizzleWebSessionRepository: class {
    create = mockCreate;
    findActiveRegisteredUserIdByTokenHash = mockFindActive;
    revokeByTokenHash = mockRevokeByTokenHash;
  },
}));

import {
  prepareWebSession,
  createWebSession,
  writeWebSessionCookie,
  revokeCurrentWebSession,
  readRegisteredSessionIdentity,
  WEB_SESSION_COOKIE,
} from './session';

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 返回一个通过 parseSessionToken 校验的真实 token。 */
function validToken(): string {
  return prepareWebSession().token;
}

describe('prepareWebSession', () => {
  it('生成 32 字节 base64url token 和对应 sha256 hash', () => {
    const session = prepareWebSession();
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.tokenHash).toBe(sha256(session.token));
    expect(session.tokenHash.length).toBe(64);
  });

  it('expiresAt 为 now + 30 天', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const session = prepareWebSession(now);
    const expected = new Date(now.getTime() + 60 * 60 * 24 * 30 * 1000);
    expect(session.expiresAt.toISOString()).toBe(expected.toISOString());
  });

  it('两次调用生成不同 token', () => {
    const a = prepareWebSession();
    const b = prepareWebSession();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe('createWebSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('调用 repository.create 并返回原始 token', async () => {
    mockCreate.mockResolvedValue(undefined);
    const token = await createWebSession('user-1');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0]![0];
    expect(call.userId).toBe('user-1');
    expect(call.tokenHash).toBe(sha256(token));
    expect(call.expiresAt).toBeInstanceOf(Date);
  });

  it('repository 失败时抛出异常，不返回 token', async () => {
    mockCreate.mockRejectedValue(new Error('db error'));
    await expect(createWebSession('user-1')).rejects.toThrow('db error');
  });
});

describe('writeWebSessionCookie', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('接受合法 token 写入 HttpOnly Cookie', async () => {
    const token = validToken();
    await writeWebSessionCookie(token);
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      WEB_SESSION_COOKIE,
      token,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      }),
    );
  });

  it('非法 token 长度抛出错误', async () => {
    await expect(writeWebSessionCookie('short')).rejects.toThrow(
      'web_session_token_invalid',
    );
  });

  it('非法 token 字符抛出错误', async () => {
    await expect(writeWebSessionCookie('!'.repeat(43))).rejects.toThrow(
      'web_session_token_invalid',
    );
  });
});

describe('revokeCurrentWebSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('撤销有效 session 后删除 Cookie', async () => {
    const token = validToken();
    mockCookieStore.get.mockReturnValue({ value: token });
    mockRevokeByTokenHash.mockResolvedValue(undefined);

    await revokeCurrentWebSession();

    expect(mockRevokeByTokenHash).toHaveBeenCalledWith({
      tokenHash: sha256(token),
    });
    expect(mockCookieStore.delete).toHaveBeenCalledWith(WEB_SESSION_COOKIE);
  });

  it('无 Cookie 时幂等 — 不调 revoke 但仍 delete cookie', async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    await revokeCurrentWebSession();

    expect(mockRevokeByTokenHash).not.toHaveBeenCalled();
    expect(mockCookieStore.delete).toHaveBeenCalledWith(WEB_SESSION_COOKIE);
  });

  it('无效 token 格式时幂等 — 不调 revoke', async () => {
    mockCookieStore.get.mockReturnValue({ value: 'bad' });

    await revokeCurrentWebSession();

    expect(mockRevokeByTokenHash).not.toHaveBeenCalled();
    expect(mockCookieStore.delete).toHaveBeenCalledWith(WEB_SESSION_COOKIE);
  });

  it('重复调用幂等 — revokeByTokenHash 的 WHERE revokedAt IS NULL 保证', async () => {
    const token = validToken();
    mockCookieStore.get.mockReturnValue({ value: token });
    mockRevokeByTokenHash.mockResolvedValue(undefined);

    await revokeCurrentWebSession();
    await revokeCurrentWebSession();

    expect(mockRevokeByTokenHash).toHaveBeenCalledTimes(2);
    expect(mockCookieStore.delete).toHaveBeenCalledTimes(2);
  });

  it('数据库失败时 exception 透传', async () => {
    const token = validToken();
    mockCookieStore.get.mockReturnValue({ value: token });
    mockRevokeByTokenHash.mockRejectedValue(new Error('db down'));

    await expect(revokeCurrentWebSession()).rejects.toThrow('db down');
  });
});

describe('readRegisteredSessionIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有效 session 返回 userId', async () => {
    const token = validToken();
    mockCookieStore.get.mockReturnValue({ value: token });
    mockFindActive.mockResolvedValue('user-42');

    const identity = await readRegisteredSessionIdentity();
    expect(identity).toEqual({ userId: 'user-42' });
    expect(mockFindActive).toHaveBeenCalledWith({
      tokenHash: sha256(token),
    });
  });

  it('无 Cookie 返回 null', async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const identity = await readRegisteredSessionIdentity();
    expect(identity).toBeNull();
    expect(mockFindActive).not.toHaveBeenCalled();
  });

  it('token 已过期或已撤销（DB 返回 null）返回 null', async () => {
    const token = validToken();
    mockCookieStore.get.mockReturnValue({ value: token });
    mockFindActive.mockResolvedValue(null);

    const identity = await readRegisteredSessionIdentity();
    expect(identity).toBeNull();
  });

  it('非法 token 字符返回 null，不查数据库', async () => {
    mockCookieStore.get.mockReturnValue({ value: '<script>' });

    const identity = await readRegisteredSessionIdentity();
    expect(identity).toBeNull();
    expect(mockFindActive).not.toHaveBeenCalled();
  });
});
