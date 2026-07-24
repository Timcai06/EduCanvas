import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { DrizzleWebSessionRepository } from '@educanvas/db';

export const WEB_SESSION_COOKIE =
  process.env.NODE_ENV === 'production'
    ? '__Host-educanvas_session'
    : 'educanvas_session';

const TOKEN_BYTES = 32;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const sessionRepository = new DrizzleWebSessionRepository();

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function parseSessionToken(value: string): string | null {
  if (!TOKEN_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.byteLength === TOKEN_BYTES &&
    decoded.toString('base64url') === value
    ? value
    : null;
}

export interface RegisteredSessionIdentity {
  userId: string;
}

export async function readRegisteredSessionIdentity(): Promise<RegisteredSessionIdentity | null> {
  const value = (await cookies()).get(WEB_SESSION_COOKIE)?.value;
  const token = value ? parseSessionToken(value) : null;
  if (!token) return null;
  const userId = await sessionRepository.findActiveRegisteredUserIdByTokenHash({
    tokenHash: hashSessionToken(token),
  });
  return userId ? { userId } : null;
}

export async function createWebSession(userId: string): Promise<string> {
  const token = createSessionToken();
  const now = new Date();
  await sessionRepository.create({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(now.getTime() + COOKIE_MAX_AGE_SECONDS * 1000),
    now,
  });
  return token;
}

export async function writeWebSessionCookie(token: string): Promise<void> {
  const parsed = parseSessionToken(token);
  if (!parsed) throw new Error('web_session_token_invalid');
  (await cookies()).set(WEB_SESSION_COOKIE, parsed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function revokeCurrentWebSession(): Promise<void> {
  const cookieStore = await cookies();
  const value = cookieStore.get(WEB_SESSION_COOKIE)?.value;
  const token = value ? parseSessionToken(value) : null;
  if (token) {
    await sessionRepository.revokeByTokenHash({
      tokenHash: hashSessionToken(token),
    });
  }
  cookieStore.delete(WEB_SESSION_COOKIE);
}

export async function revokeAllWebSessionsForUser(
  userId: string,
): Promise<void> {
  await sessionRepository.revokeAllForUser({ userId });
}
