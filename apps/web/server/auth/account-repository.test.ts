import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@educanvas/db', () => {
  class WebCredentialChangedError extends Error {}
  return {
    DrizzleWebAccountRepository: class {},
    WebCredentialChangedError,
    WebUsernameTakenError: class extends Error {},
  };
});
vi.mock('./password', () => ({
  consumeDummyPasswordVerification: vi.fn(async () => undefined),
  hashPassword: vi.fn(async () => ({
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
  verifyPassword: vi.fn(async () => true),
}));

const { WebCredentialChangedError } = await import('@educanvas/db');
const { WebAccountRepository } = await import('./account-repository');
const { consumeDummyPasswordVerification } = await import('./password');

describe('WebAccountRepository authentication', () => {
  it('未命中用户名时仍消耗一次受控密码验证成本', async () => {
    const persistence = {
      findByUsername: vi.fn(async () => null),
    };
    const repository = new WebAccountRepository(persistence as never);

    await expect(
      repository.authenticate({
        username: 'missing-user',
        password: 'Password123!',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(consumeDummyPasswordVerification).toHaveBeenCalledWith(
      'Password123!',
    );
  });
});

describe('WebAccountRepository password rotation', () => {
  it('maps a compare-and-swap loss to invalid_current_password', async () => {
    const persistence = {
      findCredentialsByUserId: vi.fn(async () => ({
        passwordHash: 'a'.repeat(43),
        passwordSalt: 'a'.repeat(16),
        passwordParams: {
          N: 16_384,
          r: 8,
          p: 1,
          keyLength: 32,
        },
      })),
      updatePasswordAndRotateSession: vi.fn(async () => {
        throw new WebCredentialChangedError();
      }),
    };
    const repository = new WebAccountRepository(persistence as never);

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
    expect(persistence.updatePasswordAndRotateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedCredential: {
          passwordHash: 'a'.repeat(43),
          passwordSalt: 'a'.repeat(16),
        },
      }),
    );
  });
});
