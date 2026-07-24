import 'server-only';

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { assessPasswordRisk } from '@/features/auth/password-strength';

const KEY_LENGTH = 32;
const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1, keyLength: KEY_LENGTH };

export interface StoredPasswordMaterial {
  passwordHash: string;
  passwordSalt: string;
  passwordParams: typeof SCRYPT_PARAMS;
}

export class PasswordValidationError extends Error {
  constructor(readonly code: 'password_too_short') {
    super(code);
    this.name = 'PasswordValidationError';
  }
}

async function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(
  password: string,
): Promise<StoredPasswordMaterial> {
  if (!assessPasswordRisk(password).acceptable) {
    throw new PasswordValidationError('password_too_short');
  }
  const passwordSalt = randomBytes(16).toString('base64url');
  const hash = await derive(password, passwordSalt);
  return {
    passwordHash: hash.toString('base64url'),
    passwordSalt,
    passwordParams: SCRYPT_PARAMS,
  };
}

export async function verifyPassword(input: {
  password: string;
  passwordHash: string;
  passwordSalt: string;
}): Promise<boolean> {
  const expected = Buffer.from(input.passwordHash, 'base64url');
  if (expected.byteLength !== KEY_LENGTH) return false;
  const actual = await derive(input.password, input.passwordSalt);
  return (
    actual.byteLength === expected.byteLength &&
    timingSafeEqual(actual, expected)
  );
}
