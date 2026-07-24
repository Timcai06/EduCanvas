import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { PasswordValidationError, hashPassword, verifyPassword } =
  await import('./password');

describe('password storage', () => {
  it('never stores the plaintext password and verifies with scrypt material', async () => {
    const material = await hashPassword('Abcdef123456!');
    expect(material.passwordHash).not.toContain('Abcdef123456!');
    expect(material.passwordSalt).not.toContain('Abcdef123456!');
    await expect(
      verifyPassword({ password: 'Abcdef123456!', ...material }),
    ).resolves.toBe(true);
    await expect(
      verifyPassword({ password: 'wrong-password', ...material }),
    ).resolves.toBe(false);
  });

  it('rejects passwords shorter than the server minimum', async () => {
    await expect(hashPassword('12345')).rejects.toBeInstanceOf(
      PasswordValidationError,
    );
  });
});
