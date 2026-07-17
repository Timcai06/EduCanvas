import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import {
  createAnonymousIdentity,
  deriveAnonymousStudentId,
  parseAnonymousToken,
} from './anonymous-identity';

function tokenFor(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

describe('anonymous identity token', () => {
  it('只接受规范的32-byte无padding base64url token', () => {
    const token = tokenFor(1);

    expect(parseAnonymousToken(token)).toBe(token);
    expect(parseAnonymousToken(`${token}=`)).toBeNull();
    expect(parseAnonymousToken(token.slice(1))).toBeNull();
    expect(parseAnonymousToken(`!${token.slice(1)}`)).toBeNull();
  });

  it('相同token稳定映射身份且不同token不能复用身份', () => {
    const first = tokenFor(1);
    const second = tokenFor(2);

    expect(deriveAnonymousStudentId(first)).toBe(
      deriveAnonymousStudentId(first),
    );
    expect(deriveAnonymousStudentId(second)).not.toBe(
      deriveAnonymousStudentId(first),
    );
    expect(deriveAnonymousStudentId(first)).toMatch(/^anon:v1:[a-f0-9]{64}$/);
  });

  it('每次创建独立且可验证的匿名身份', () => {
    const first = createAnonymousIdentity();
    const second = createAnonymousIdentity();

    expect(parseAnonymousToken(first.token)).toBe(first.token);
    expect(first.studentId).toBe(deriveAnonymousStudentId(first.token));
    expect(second.token).not.toBe(first.token);
    expect(second.studentId).not.toBe(first.studentId);
  });
});
