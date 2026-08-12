import {
  createHash,
  createHmac,
  randomBytes as secureRandomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  gatewayDesktopAuthorizationCodeSchema,
  gatewayDesktopSessionTokenSchema,
  gatewayOpaqueIdSchema,
} from '@educanvas/gateway-core';
import { z } from 'zod';

const AUTHORIZATION_CODE_TTL_SECONDS = 120;
const codePayloadSchema = z
  .object({
    v: z.literal(1),
    c: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    e: z.number().int().positive(),
    n: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    b: gatewayOpaqueIdSchema,
    r: gatewayOpaqueIdSchema,
  })
  .strict();

interface CryptoOptions {
  readonly secret: string;
  readonly now?: () => Date;
  readonly randomBytes?: (size: number) => Buffer;
}

function requireSecret(secret: string): void {
  if (Buffer.byteLength(secret) < 32) {
    throw new Error('desktop_auth_secret_too_short');
  }
}

function sign(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload, 'utf8').digest();
}

/**
 * 签发不含主体标识的两分钟授权 code。主体只存在于数据库 hash 记录中；
 * 即使 deep-link 被系统诊断记录，也不会暴露 user id。
 */
export function createDesktopAuthorizationCode(
  input: {
    codeChallenge: string;
    notebookId: string;
    conversationId: string;
  },
  options: CryptoOptions,
): string {
  requireSecret(options.secret);
  const nowSeconds = Math.floor(
    (options.now?.() ?? new Date()).getTime() / 1_000,
  );
  const bytes = options.randomBytes ?? secureRandomBytes;
  const payload = Buffer.from(
    JSON.stringify(
      codePayloadSchema.parse({
        v: 1,
        c: input.codeChallenge,
        e: nowSeconds + AUTHORIZATION_CODE_TTL_SECONDS,
        n: bytes(16).toString('base64url'),
        b: input.notebookId,
        r: input.conversationId,
      }),
    ),
    'utf8',
  ).toString('base64url');
  return gatewayDesktopAuthorizationCodeSchema.parse(
    `eca1.${payload}.${sign(payload, options.secret).toString('base64url')}`,
  );
}

export function verifyDesktopAuthorizationCode(
  code: string,
  options: Pick<CryptoOptions, 'secret' | 'now'>,
): {
  codeChallenge: string;
  expiresAt: Date;
  notebookId: string;
  conversationId: string;
} | null {
  try {
    requireSecret(options.secret);
    const parsedCode = gatewayDesktopAuthorizationCodeSchema.parse(code);
    const [, payload, suppliedRaw] = parsedCode.split('.');
    if (!payload || !suppliedRaw) return null;
    const expected = Buffer.from(
      sign(payload, options.secret).toString('base64url'),
      'ascii',
    );
    const supplied = Buffer.from(suppliedRaw, 'ascii');
    if (
      supplied.byteLength !== expected.byteLength ||
      !timingSafeEqual(supplied, expected)
    ) {
      return null;
    }
    const claims = codePayloadSchema.parse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    );
    const nowSeconds = Math.floor(
      (options.now?.() ?? new Date()).getTime() / 1_000,
    );
    if (claims.e <= nowSeconds) return null;
    return {
      codeChallenge: claims.c,
      expiresAt: new Date(claims.e * 1_000),
      notebookId: claims.b,
      conversationId: claims.r,
    };
  } catch {
    return null;
  }
}

/** RFC 7636 S256：比较固定长度 base64url，避免普通字符串的提前返回。 */
export function verifyDesktopPkce(
  expectedChallenge: string,
  codeVerifier: string,
): boolean {
  const actual = createHash('sha256')
    .update(codeVerifier, 'utf8')
    .digest('base64url');
  const expected = Buffer.from(expectedChallenge, 'ascii');
  const supplied = Buffer.from(actual, 'ascii');
  return (
    expected.byteLength === supplied.byteLength &&
    timingSafeEqual(expected, supplied)
  );
}

export function createDesktopSessionToken(
  randomBytes: (size: number) => Buffer = secureRandomBytes,
): string {
  return gatewayDesktopSessionTokenSchema.parse(
    `ecs1_${randomBytes(32).toString('base64url')}`,
  );
}

export function hashDesktopCredential(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
