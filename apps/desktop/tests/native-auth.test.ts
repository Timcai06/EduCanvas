import { describe, expect, it } from 'vitest';
import {
  buildDesktopAuthorizationUrl,
  createDesktopPkceRequest,
  findDesktopDeepLink,
  parseDesktopAuthCallback,
} from '../src/main/native-auth';

describe('desktop native auth', () => {
  it('creates 32-byte state/verifier and an RFC 7636 S256 challenge', () => {
    let fill = 1;
    const request = createDesktopPkceRequest((size) =>
      Buffer.alloc(size, fill++),
    );
    expect(request.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(request.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(request.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(request.codeChallenge).not.toBe(request.codeVerifier);
  });

  it('builds only the frozen authorization request on HTTPS or loopback HTTP', () => {
    const request = createDesktopPkceRequest((size) => Buffer.alloc(size, 3));
    const url = buildDesktopAuthorizationUrl(
      'https://learn.educanvas.example/base',
      request,
    );
    expect(url.toString()).toContain(
      'https://learn.educanvas.example/desktop/authorize?',
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'educanvas-desktop',
      redirect_uri: 'educanvas://auth/callback',
      state: request.state,
      code_challenge: request.codeChallenge,
      code_challenge_method: 'S256',
    });
    expect(() =>
      buildDesktopAuthorizationUrl('http://remote.example', request),
    ).toThrow('desktop_web_url_insecure');
    expect(() =>
      buildDesktopAuthorizationUrl('http://127.0.0.1:3000', request),
    ).not.toThrow();
  });

  it('accepts the exact callback and rejects state mismatch or extra fields', () => {
    const state = 's'.repeat(43);
    const code = `eca1.${'p'.repeat(48)}.${'x'.repeat(43)}`;
    expect(
      parseDesktopAuthCallback(
        `educanvas://auth/callback?code=${code}&state=${state}`,
        state,
      ),
    ).toEqual({ code });
    for (const callback of [
      `educanvas://other/callback?code=${code}&state=${state}`,
      `educanvas://auth/other?code=${code}&state=${state}`,
      `educanvas://auth/callback?code=${code}&state=${'z'.repeat(43)}`,
      `educanvas://auth/callback?code=${code}&state=${state}&token=bad`,
      `https://auth/callback?code=${code}&state=${state}`,
    ]) {
      expect(() => parseDesktopAuthCallback(callback, state)).toThrow();
    }
  });

  it('finds a deep link anywhere in Windows command-line arguments', () => {
    expect(
      findDesktopDeepLink([
        'C:\\Program Files\\EduCanvas.exe',
        '--flag',
        'educanvas://auth/callback?code=x&state=y',
      ]),
    ).toBe('educanvas://auth/callback?code=x&state=y');
    expect(findDesktopDeepLink(['EduCanvas.exe', '--flag'])).toBeNull();
  });
});
