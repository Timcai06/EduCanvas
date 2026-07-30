import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockFindByUsername, mockFindCredentials, mockUpdatePassword } =
  vi.hoisted(() => ({
    mockFindByUsername: vi.fn(),
    mockFindCredentials: vi.fn(),
    mockUpdatePassword: vi.fn(),
  }));

vi.mock('@educanvas/db', () => {
  class WebCredentialChangedError extends Error {}
  return {
    DrizzleWebAccountRepository: class {
      findByUsername = mockFindByUsername;
      findCredentialsByUserId = mockFindCredentials;
      updatePasswordAndRotateSession = mockUpdatePassword;
    },
    WebCredentialChangedError,
    WebUsernameTakenError: class extends Error {},
  };
});

const { mockConsumeDummy, mockHashPassword, mockVerifyPassword } = vi.hoisted(
  () => ({
    mockConsumeDummy: vi.fn(async () => undefined),
    mockHashPassword: vi.fn(async () => ({
      passwordHash: 'b'.repeat(43),
      passwordSalt: 'b'.repeat(16),
      passwordParams: {
        version: 1,
        algorithm: 'scrypt',
        N: 16_384,
        r: 8,
        p: 1,
        keyLength: 32,
      },
    })),
    mockVerifyPassword: vi.fn(async () => true),
  }),
);

vi.mock('./password', () => ({
  consumeDummyPasswordVerification: mockConsumeDummy,
  hashPassword: mockHashPassword,
  verifyPassword: mockVerifyPassword,
}));

const { WebCredentialChangedError } = await import('@educanvas/db');
const { WebAccountRepository } = await import('./account-repository');

function validCredentials() {
  return {
    passwordHash: 'a'.repeat(43),
    passwordSalt: 'a'.repeat(16),
    passwordParams: {
      version: 1 as const,
      algorithm: 'scrypt' as const,
      N: 16_384,
      r: 8,
      p: 1,
      keyLength: 32,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WebAccountRepository authentication', () => {
  it('未命中用户名时仍消耗一次受控密码验证成本', async () => {
    mockFindByUsername.mockResolvedValue(null);

    const repository = new WebAccountRepository();
    await expect(
      repository.authenticate({
        username: 'missing-user',
        password: 'Password123!',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(mockConsumeDummy).toHaveBeenCalledWith('Password123!');
  });

  it('密码验证失败返回 invalid_credentials，不泄露内部细节', async () => {
    mockFindByUsername.mockResolvedValue({
      userId: 'user-1',
      ...validCredentials(),
    });
    mockVerifyPassword.mockResolvedValue(false);

    const repository = new WebAccountRepository();
    await expect(
      repository.authenticate({
        username: 'test-user',
        password: 'wrong-password',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('成功认证返回用户 profile', async () => {
    const profile = {
      userId: 'user-1',
      ...validCredentials(),
    };
    mockFindByUsername.mockResolvedValue(profile);
    mockVerifyPassword.mockResolvedValue(true);

    const repository = new WebAccountRepository();
    const result = await repository.authenticate({
      username: 'test-user',
      password: 'correct-password',
    });

    expect(result).toBe(profile);
  });
});

describe('WebAccountRepository password rotation', () => {
  it('成功改密后调用仓储原子更新密码并轮换 session', async () => {
    mockFindCredentials.mockResolvedValue(validCredentials());
    mockVerifyPassword.mockResolvedValue(true);
    mockUpdatePassword.mockResolvedValue(undefined);

    const repository = new WebAccountRepository();
    await repository.changePasswordAndRotateSession({
      userId: 'user:test',
      currentPassword: 'OldPassword1!',
      newPassword: 'NewPassword1!',
      newSession: {
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date('2026-07-25T00:00:00.000Z'),
      },
    });

    expect(mockUpdatePassword).toHaveBeenCalledTimes(1);
    const call = mockUpdatePassword.mock.calls[0]![0];
    expect(call.userId).toBe('user:test');
    expect(call.expectedCredential).toEqual({
      passwordHash: 'a'.repeat(43),
      passwordSalt: 'a'.repeat(16),
    });
    expect(call.passwordMaterial.passwordHash).toBe('b'.repeat(43));
    expect(call.newSession.tokenHash).toBe('a'.repeat(64));
    expect(call.newSession.expiresAt).toBeInstanceOf(Date);
  });

  it('当前用户不是注册用户时返回 not_registered', async () => {
    mockFindCredentials.mockResolvedValue(null);

    const repository = new WebAccountRepository();
    await expect(
      repository.changePasswordAndRotateSession({
        userId: 'user:ghost',
        currentPassword: 'OldPassword1!',
        newPassword: 'NewPassword1!',
        newSession: {
          tokenHash: 'a'.repeat(64),
          expiresAt: new Date('2026-07-25T00:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'not_registered' });
  });

  it('旧密码不正确返回 invalid_current_password', async () => {
    mockFindCredentials.mockResolvedValue(validCredentials());
    mockVerifyPassword.mockResolvedValue(false);

    const repository = new WebAccountRepository();
    await expect(
      repository.changePasswordAndRotateSession({
        userId: 'user:test',
        currentPassword: 'WrongOldPassword!',
        newPassword: 'NewPassword1!',
        newSession: {
          tokenHash: 'a'.repeat(64),
          expiresAt: new Date('2026-07-25T00:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_current_password' });
    // 密码错误不调仓储
    expect(mockUpdatePassword).not.toHaveBeenCalled();
  });

  it('CAS 冲突映射为 invalid_current_password 且不泄露内部异常', async () => {
    mockFindCredentials.mockResolvedValue(validCredentials());
    mockVerifyPassword.mockResolvedValue(true);
    mockUpdatePassword.mockRejectedValue(new WebCredentialChangedError());

    const repository = new WebAccountRepository();
    await expect(
      repository.changePasswordAndRotateSession({
        userId: 'user:test',
        currentPassword: 'OldPassword1!',
        newPassword: 'NewPassword1!',
        newSession: {
          tokenHash: 'a'.repeat(64),
          expiresAt: new Date('2026-07-25T00:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_current_password' });
    // 稳定码，不抛出 WebCredentialChangedError 到上层
  });

  it('非预期 DB 错误透传不包装', async () => {
    mockFindCredentials.mockResolvedValue(validCredentials());
    mockVerifyPassword.mockResolvedValue(true);
    mockUpdatePassword.mockRejectedValue(new Error('db connection lost'));

    const repository = new WebAccountRepository();
    await expect(
      repository.changePasswordAndRotateSession({
        userId: 'user:test',
        currentPassword: 'OldPassword1!',
        newPassword: 'NewPassword1!',
        newSession: {
          tokenHash: 'a'.repeat(64),
          expiresAt: new Date('2026-07-25T00:00:00.000Z'),
        },
      }),
    ).rejects.toThrow('db connection lost');
  });
});
