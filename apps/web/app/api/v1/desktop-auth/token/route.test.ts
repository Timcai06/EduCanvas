import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ exchange: vi.fn() }));

vi.mock('@/server/desktop-auth/server-service', () => ({
  getDesktopAuthService: () => ({ exchange: mocks.exchange }),
}));

import { POST } from './route';

const validBody = {
  grant_type: 'authorization_code',
  client_id: 'educanvas-desktop',
  redirect_uri: 'educanvas://auth/callback',
  code: `eca1.${'p'.repeat(48)}.${'x'.repeat(43)}`,
  code_verifier: 'v'.repeat(43),
};

function request(body: unknown, origin?: string) {
  return new Request('http://localhost/api/v1/desktop-auth/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/desktop-auth/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exchange.mockResolvedValue({
      access_token: `ecs1_${'t'.repeat(43)}`,
      token_type: 'Bearer',
      expires_at: '2026-09-10T08:00:00.000Z',
      user_id: 'user:one',
      notebook_id: 'notebook:one',
      conversation_id: 'conversation:one',
    });
  });

  it('accepts a native request without browser Origin and returns no-store', async () => {
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({
      access_token: expect.stringMatching(/^ecs1_/),
      token_type: 'Bearer',
      notebook_id: 'notebook:one',
      conversation_id: 'conversation:one',
    });
  });

  it('rejects cross-site browser requests and malformed exchange bodies', async () => {
    expect(
      (await POST(request(validBody, 'https://evil.example'))).status,
    ).toBe(403);
    expect(
      (await POST(request({ ...validBody, code_verifier: 'short' }))).status,
    ).toBe(400);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it('maps consumed, expired or PKCE-invalid codes to invalid_grant', async () => {
    mocks.exchange.mockRejectedValueOnce(
      Object.assign(new Error('invalid_grant'), { code: 'invalid_grant' }),
    );
    const response = await POST(request(validBody));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_grant' },
    });
  });
});
