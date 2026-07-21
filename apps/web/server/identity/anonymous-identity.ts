import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

export const ANONYMOUS_IDENTITY_COOKIE =
  process.env.NODE_ENV === 'production'
    ? '__Host-educanvas_anonymous_identity'
    : 'educanvas_anonymous_identity';
const TOKEN_BYTES = 32;
const TOKEN_LENGTH = 43;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface AnonymousIdentity {
  token: string;
  studentId: string;
}

/** 仅接受规范的32-byte、无padding base64url bearer，拒绝宽松解码和任意Cookie文本。 */
export function parseAnonymousToken(value: string): string | null {
  if (value.length !== TOKEN_LENGTH || !TOKEN_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.byteLength !== TOKEN_BYTES ||
    decoded.toString('base64url') !== value
  ) {
    return null;
  }
  return value;
}

export function deriveAnonymousStudentId(token: string): string {
  const parsed = parseAnonymousToken(token);
  if (!parsed) throw new Error('匿名身份token格式非法');
  const digest = createHash('sha256').update(parsed, 'utf8').digest('hex');
  return `anon:v1:${digest}`;
}

export function createAnonymousIdentity(): AnonymousIdentity {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, studentId: deriveAnonymousStudentId(token) };
}

/** 仅区分可轮换的浏览器匿名身份；local/registered 身份不得因尚无课程被替换。 */
export function isEphemeralAnonymousIdentity(
  identity: AnonymousIdentity,
): boolean {
  return identity.token.length > 0 && identity.studentId.startsWith('anon:v1:');
}

/** Server Component只能调用读取函数；缺失或畸形Cookie不会被静默替换。 */
export async function readAnonymousIdentity(): Promise<AnonymousIdentity | null> {
  if (
    process.env.EDUCANVAS_DEPLOYMENT_ENV?.trim() === 'local' &&
    (process.env.EDUCANVAS_LOCAL_USER_ID?.trim() || 'local:owner')
  ) {
    return {
      token: '',
      studentId: process.env.EDUCANVAS_LOCAL_USER_ID?.trim() || 'local:owner',
    };
  }
  const value = (await cookies()).get(ANONYMOUS_IDENTITY_COOKIE)?.value;
  if (!value) return null;
  const token = parseAnonymousToken(value);
  return token ? { token, studentId: deriveAnonymousStudentId(token) } : null;
}

/** 只能从Server Action/Route Handler调用；bootstrap成功之前不得调用。 */
export async function writeAnonymousIdentityCookie(
  token: string,
): Promise<void> {
  const parsed = parseAnonymousToken(token);
  if (!parsed) throw new Error('拒绝写入非法匿名身份token');
  (await cookies()).set(ANONYMOUS_IDENTITY_COOKIE, parsed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}
