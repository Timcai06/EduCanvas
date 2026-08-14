import { describe, expect, it } from 'vitest';
import {
  createDesktopAuthorizationCode,
  createDesktopSessionToken,
  hashDesktopCredential,
  verifyDesktopAuthorizationCode,
  verifyDesktopPkce,
} from './authorization-code';

const secret = 's'.repeat(32);
const now = new Date('2026-08-11T08:00:00.000Z');
const verifier = 'v'.repeat(43);
const challenge = '7w_YNF9DSfIdPf_pRjSq646_kPr-2-o9NAl16JGghdM';
const base64UrlAlphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

describe('desktop authorization code', () => {
  it('issues an opaque short-lived code without embedding the user id', () => {
    const code = createDesktopAuthorizationCode(
      {
        codeChallenge: challenge,
        notebookId: 'notebook:one',
        conversationId: 'conversation:one',
      },
      { secret, now: () => now, randomBytes: () => Buffer.alloc(16, 7) },
    );
    expect(code).toMatch(/^eca1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(code).not.toContain('user:one');
    expect(
      verifyDesktopAuthorizationCode(code, {
        secret,
        now: () => new Date(now.getTime() + 60_000),
      }),
    ).toMatchObject({
      codeChallenge: challenge,
      notebookId: 'notebook:one',
      conversationId: 'conversation:one',
    });
  });

  it('rejects tampering, a different secret and expiry', () => {
    const code = createDesktopAuthorizationCode(
      {
        codeChallenge: challenge,
        notebookId: 'notebook:one',
        conversationId: 'conversation:one',
      },
      { secret, now: () => now },
    );
    const [, , signature] = code.split('.');
    const lastIndex = base64UrlAlphabet.indexOf(signature!.at(-1)!);
    const nonCanonicalAlias = `${code.slice(0, -1)}${base64UrlAlphabet[lastIndex + 1]}`;
    expect(Buffer.from(nonCanonicalAlias.split('.')[2]!, 'base64url')).toEqual(
      Buffer.from(signature!, 'base64url'),
    );
    expect(
      verifyDesktopAuthorizationCode(nonCanonicalAlias, {
        secret,
        now: () => now,
      }),
    ).toBeNull();
    expect(
      verifyDesktopAuthorizationCode(code, {
        secret: 'x'.repeat(32),
        now: () => now,
      }),
    ).toBeNull();
    expect(
      verifyDesktopAuthorizationCode(code, {
        secret,
        now: () => new Date(now.getTime() + 121_000),
      }),
    ).toBeNull();
  });

  it('uses S256 PKCE and creates an isolated desktop session token', () => {
    expect(verifyDesktopPkce(challenge, verifier)).toBe(true);
    expect(verifyDesktopPkce(challenge, 'x'.repeat(43))).toBe(false);
    const token = createDesktopSessionToken(() => Buffer.alloc(32, 9));
    expect(token).toMatch(/^ecs1_[A-Za-z0-9_-]{43}$/);
    expect(hashDesktopCredential(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('supports the maximum opaque route ids accepted by gateway.v1', () => {
    const notebookId = `n${'a'.repeat(159)}`;
    const conversationId = `c${'b'.repeat(159)}`;
    const code = createDesktopAuthorizationCode(
      { codeChallenge: challenge, notebookId, conversationId },
      { secret, now: () => now, randomBytes: () => Buffer.alloc(16, 3) },
    );
    expect(
      verifyDesktopAuthorizationCode(code, { secret, now: () => now }),
    ).toMatchObject({ notebookId, conversationId });
  });

  it('can issue an identity-only code without an initial route cursor', () => {
    const code = createDesktopAuthorizationCode(
      { codeChallenge: challenge },
      { secret, now: () => now, randomBytes: () => Buffer.alloc(16, 5) },
    );
    expect(
      verifyDesktopAuthorizationCode(code, { secret, now: () => now }),
    ).toEqual({
      codeChallenge: challenge,
      expiresAt: new Date('2026-08-11T08:02:00.000Z'),
    });
  });
});
