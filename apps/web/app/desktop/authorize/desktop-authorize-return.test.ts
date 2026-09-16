import { describe, expect, it } from 'vitest';
import { buildDesktopAuthorizeReturnPath } from './desktop-authorize-return';

describe('desktop authorization login return', () => {
  it('preserves the complete validated PKCE request across browser login', () => {
    const returnTo = buildDesktopAuthorizeReturnPath({
      response_type: 'code',
      client_id: 'educanvas-desktop',
      redirect_uri: 'educanvas://auth/callback',
      state: 'state-value',
      code_challenge: 'challenge-value',
      code_challenge_method: 'S256',
    });
    const parsed = new URL(returnTo, 'http://127.0.0.1:3000');

    expect(parsed.pathname).toBe('/desktop/authorize');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'educanvas-desktop',
      redirect_uri: 'educanvas://auth/callback',
      state: 'state-value',
      code_challenge: 'challenge-value',
      code_challenge_method: 'S256',
    });
  });
});
