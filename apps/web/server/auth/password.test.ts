import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { consumeDummyPasswordVerification, hashPassword, verifyPassword } =
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
    await expect(hashPassword('1234567')).rejects.toMatchObject({
      code: 'password_too_short',
    });
  });

  it('rejects passwords longer than the server maximum', async () => {
    await expect(hashPassword('a'.repeat(129))).rejects.toMatchObject({
      code: 'password_too_long',
    });
  });

  it('拒绝无界验证输入并可执行固定成本的缺失账号验证', async () => {
    const material = await hashPassword('Bounded123!');
    await expect(
      verifyPassword({ password: 'a'.repeat(129), ...material }),
    ).resolves.toBe(false);
    await expect(
      consumeDummyPasswordVerification('Unknown123!'),
    ).resolves.toBeUndefined();
  });

  it('accepts passwords at both inclusive length boundaries', async () => {
    await expect(hashPassword('Abcdef1!')).resolves.toMatchObject({
      passwordParams: { version: 1, algorithm: 'scrypt' },
    });
    await expect(hashPassword(`A1!${'a'.repeat(125)}`)).resolves.toMatchObject({
      passwordParams: { version: 1, algorithm: 'scrypt' },
    });
  });

  it('verifies legacy unversioned scrypt parameters', async () => {
    const material = await hashPassword('Legacy123456!');
    const legacyParams = {
      N: material.passwordParams.N,
      r: material.passwordParams.r,
      p: material.passwordParams.p,
      keyLength: material.passwordParams.keyLength,
    };
    await expect(
      verifyPassword({
        password: 'Legacy123456!',
        passwordHash: material.passwordHash,
        passwordSalt: material.passwordSalt,
        passwordParams: legacyParams,
      }),
    ).resolves.toBe(true);
  });

  it.each([
    { version: 2, algorithm: 'scrypt', N: 16_384, r: 8, p: 1, keyLength: 32 },
    { version: 1, algorithm: 'argon2', N: 16_384, r: 8, p: 1, keyLength: 32 },
    {
      version: 1,
      algorithm: 'scrypt',
      N: 1_048_576,
      r: 8,
      p: 1,
      keyLength: 32,
    },
    { version: 1, algorithm: 'scrypt', N: 16_384, r: 64, p: 1, keyLength: 32 },
    {
      version: 1,
      algorithm: 'scrypt',
      N: 16_384,
      r: 8,
      p: 1,
      keyLength: 32,
      unexpected: true,
    },
  ])(
    'rejects unsupported or excessive password params: %o',
    async (passwordParams) => {
      const material = await hashPassword('Bounded123456!');
      await expect(
        verifyPassword({
          password: 'Bounded123456!',
          passwordHash: material.passwordHash,
          passwordSalt: material.passwordSalt,
          passwordParams,
        }),
      ).resolves.toBe(false);
    },
  );
});
