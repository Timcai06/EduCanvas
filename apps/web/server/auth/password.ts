import 'server-only';

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const SCRYPT_LIMITS = {
  minN: 16_384,
  maxN: 32_768,
  maxR: 8,
  maxP: 2,
  maxMemoryBytes: 64 * 1024 * 1024,
} as const;
const SCRYPT_PARAMS = {
  version: 1,
  algorithm: 'scrypt',
  N: 16_384,
  r: 8,
  p: 1,
  keyLength: KEY_LENGTH,
} as const;
const DUMMY_PASSWORD_MATERIAL = {
  passwordHash: Buffer.alloc(KEY_LENGTH).toString('base64url'),
  passwordSalt: 'ZWR1Y2FudmFzLWR1bW15LXNhbHQ',
  passwordParams: SCRYPT_PARAMS,
} as const;

/** 当前可持久化的版本化 scrypt 材料；参数必须保持在服务端 allowlist 内。 */
export interface StoredPasswordMaterial {
  passwordHash: string;
  passwordSalt: string;
  passwordParams: typeof SCRYPT_PARAMS;
}

/** 密码输入不满足服务端长度边界；不得把原始密码写入错误或日志。 */
export class PasswordValidationError extends Error {
  constructor(readonly code: 'password_too_short' | 'password_too_long') {
    super(code);
    this.name = 'PasswordValidationError';
  }
}

interface ParsedScryptParams {
  N: number;
  r: number;
  p: number;
  keyLength: typeof KEY_LENGTH;
}

function isBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isInteger(value) &&
    typeof value === 'number' &&
    value >= minimum &&
    value <= maximum
  );
}

function parseScryptParams(value: unknown): ParsedScryptParams | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const params = value as Record<string, unknown>;
  const legacy = params.version === undefined && params.algorithm === undefined;
  const versioned = params.version === 1 && params.algorithm === 'scrypt';
  if (!legacy && !versioned) return null;
  const allowedKeys = versioned
    ? ['N', 'algorithm', 'keyLength', 'p', 'r', 'version']
    : ['N', 'keyLength', 'p', 'r'];
  const actualKeys = Object.keys(params).sort();
  if (
    actualKeys.length !== allowedKeys.length ||
    actualKeys.some((key, index) => key !== allowedKeys[index])
  ) {
    return null;
  }
  if (
    !isBoundedInteger(params.N, SCRYPT_LIMITS.minN, SCRYPT_LIMITS.maxN) ||
    (params.N & (params.N - 1)) !== 0 ||
    !isBoundedInteger(params.r, 1, SCRYPT_LIMITS.maxR) ||
    !isBoundedInteger(params.p, 1, SCRYPT_LIMITS.maxP) ||
    params.keyLength !== KEY_LENGTH
  ) {
    return null;
  }
  return {
    N: params.N,
    r: params.r,
    p: params.p,
    keyLength: KEY_LENGTH,
  };
}

async function derive(
  password: string,
  salt: string,
  params: ParsedScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      params.keyLength,
      {
        N: params.N,
        r: params.r,
        p: params.p,
        maxmem: SCRYPT_LIMITS.maxMemoryBytes,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

/** 为新密码生成随机盐和版本化 scrypt 材料；只接受 8–128 个 Unicode 字符。 */
export async function hashPassword(
  password: string,
): Promise<StoredPasswordMaterial> {
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH) {
    throw new PasswordValidationError('password_too_short');
  }
  if (length > MAX_PASSWORD_LENGTH) {
    throw new PasswordValidationError('password_too_long');
  }
  const passwordSalt = randomBytes(16).toString('base64url');
  const hash = await derive(password, passwordSalt, SCRYPT_PARAMS);
  return {
    passwordHash: hash.toString('base64url'),
    passwordSalt,
    passwordParams: SCRYPT_PARAMS,
  };
}

/** 使用记录自带但受限的参数验证密码；畸形或超界材料统一返回 false。 */
export async function verifyPassword(input: {
  password: string;
  passwordHash: string;
  passwordSalt: string;
  passwordParams: unknown;
}): Promise<boolean> {
  const passwordLength = [...input.password].length;
  if (
    passwordLength < MIN_PASSWORD_LENGTH ||
    passwordLength > MAX_PASSWORD_LENGTH
  ) {
    return false;
  }
  const params = parseScryptParams(input.passwordParams);
  if (!params) return false;
  const expected = Buffer.from(input.passwordHash, 'base64url');
  if (
    expected.byteLength !== params.keyLength ||
    expected.toString('base64url') !== input.passwordHash
  ) {
    return false;
  }
  const actual = await derive(input.password, input.passwordSalt, params);
  return (
    actual.byteLength === expected.byteLength &&
    timingSafeEqual(actual, expected)
  );
}

/**
 * 未命中用户名时仍执行一次同参数 scrypt，降低通过响应耗时枚举账号的信号。
 * 返回值没有认证含义，调用方必须始终按凭据无效处理。
 */
export async function consumeDummyPasswordVerification(
  password: string,
): Promise<void> {
  await verifyPassword({ password, ...DUMMY_PASSWORD_MATERIAL });
}
