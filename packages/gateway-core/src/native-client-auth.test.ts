import { describe, expect, it } from 'vitest';
import {
  gatewayDesktopAuthorizationQuerySchema,
  gatewayDesktopCallbackSchema,
  gatewayDesktopClientId,
  gatewayDesktopRedirectUri,
  gatewayDesktopSessionTokenSchema,
  gatewayDesktopTokenExchangeRequestSchema,
  gatewayDesktopTokenGrantSchema,
} from './native-client-auth';

const state = 's'.repeat(43);
const challenge = 'c'.repeat(43);
const verifier = 'v'.repeat(43);

describe('Gateway desktop native-client auth contract', () => {
  it('accepts only the frozen client, redirect URI and S256 authorization query', () => {
    expect(
      gatewayDesktopAuthorizationQuerySchema.parse({
        response_type: 'code',
        client_id: gatewayDesktopClientId,
        redirect_uri: gatewayDesktopRedirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }),
    ).toMatchObject({ client_id: 'educanvas-desktop' });

    for (const override of [
      { client_id: 'other-client' },
      { redirect_uri: 'https://attacker.example/callback' },
      { code_challenge_method: 'plain' },
      { state: 'too-short' },
    ]) {
      expect(
        gatewayDesktopAuthorizationQuerySchema.safeParse({
          response_type: 'code',
          client_id: gatewayDesktopClientId,
          redirect_uri: gatewayDesktopRedirectUri,
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          ...override,
        }).success,
      ).toBe(false);
    }
  });

  it('allows only code and state in the deep-link callback', () => {
    expect(
      gatewayDesktopCallbackSchema.parse({
        code: `eca1.${'p'.repeat(48)}.${'x'.repeat(43)}`,
        state,
      }),
    ).toMatchObject({ state });
    expect(
      gatewayDesktopCallbackSchema.safeParse({
        code: `eca1.${'p'.repeat(48)}.${'x'.repeat(43)}`,
        state,
        token: 'must-never-appear',
      }).success,
    ).toBe(false);
  });

  it('validates the PKCE token exchange and strict grant response', () => {
    const request = gatewayDesktopTokenExchangeRequestSchema.parse({
      grant_type: 'authorization_code',
      client_id: gatewayDesktopClientId,
      redirect_uri: gatewayDesktopRedirectUri,
      code: `eca1.${'p'.repeat(48)}.${'x'.repeat(43)}`,
      code_verifier: verifier,
    });
    expect(request.code_verifier).toBe(verifier);

    const token = `ecs1_${'t'.repeat(43)}`;
    expect(gatewayDesktopSessionTokenSchema.parse(token)).toBe(token);
    expect(
      gatewayDesktopTokenGrantSchema.parse({
        access_token: token,
        token_type: 'Bearer',
        expires_at: '2026-09-10T08:00:00.000Z',
        user_id: 'user:one',
        notebook_id: 'notebook:one',
        conversation_id: 'conversation:one',
      }),
    ).toMatchObject({
      token_type: 'Bearer',
      notebook_id: 'notebook:one',
      conversation_id: 'conversation:one',
    });
    expect(
      gatewayDesktopTokenGrantSchema.safeParse({
        access_token: token,
        token_type: 'Bearer',
        expires_at: '2026-09-10T08:00:00.000Z',
        user_id: 'user:one',
      }).success,
    ).toBe(true);
    expect(
      gatewayDesktopTokenGrantSchema.safeParse({
        access_token: token,
        token_type: 'Bearer',
        expires_at: '2026-09-10T08:00:00.000Z',
        user_id: 'user:one',
        notebook_id: 'notebook:one',
      }).success,
    ).toBe(false);
    expect(
      gatewayDesktopSessionTokenSchema.safeParse('x'.repeat(48)).success,
    ).toBe(false);
  });
});
