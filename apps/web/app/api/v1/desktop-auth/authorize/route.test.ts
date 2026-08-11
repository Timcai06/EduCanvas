import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  readIdentity: vi.fn(),
  loadConversation: vi.fn(),
  issueAuthorizationCode: vi.fn(),
}));

vi.mock('@/server/auth/session', () => ({
  readRegisteredSessionIdentity: mocks.readIdentity,
}));
vi.mock('@/server/desktop-auth/server-service', () => ({
  getDesktopAuthService: () => ({
    issueAuthorizationCode: mocks.issueAuthorizationCode,
  }),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: mocks.loadConversation,
}));

import { POST } from './route';

const validBody = {
  response_type: 'code',
  client_id: 'educanvas-desktop',
  redirect_uri: 'educanvas://auth/callback',
  state: 's'.repeat(43),
  code_challenge: 'c'.repeat(43),
  code_challenge_method: 'S256',
};

function request(body: Record<string, string>, origin = 'http://localhost') {
  return new Request('http://localhost/api/v1/desktop-auth/authorize', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
}

describe('POST /api/v1/desktop-auth/authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readIdentity.mockResolvedValue({ userId: 'user:one' });
    mocks.loadConversation.mockResolvedValue({
      id: 'conversation:one',
      spaceId: 'notebook:one',
      title: '当前 Web 会话',
      agentProfileId: 'general',
    });
    mocks.issueAuthorizationCode.mockResolvedValue({
      code: `eca1.${'p'.repeat(48)}.${'x'.repeat(43)}`,
      expiresAt: new Date('2026-08-11T08:02:00.000Z'),
    });
  });

  it('rejects cross-site writes and unauthenticated browsers', async () => {
    expect(
      (await POST(request(validBody, 'https://evil.example'))).status,
    ).toBe(403);
    mocks.readIdentity.mockResolvedValueOnce(null);
    expect((await POST(request(validBody))).status).toBe(401);
  });

  it('rejects an unregistered redirect URI before issuing a code', async () => {
    const response = await POST(
      request({ ...validBody, redirect_uri: 'https://evil.example/callback' }),
    );
    expect(response.status).toBe(400);
    expect(mocks.issueAuthorizationCode).not.toHaveBeenCalled();
  });

  it('redirects with code/state only and disables referrer/cache', async () => {
    const response = await POST(request(validBody));
    expect(response.status).toBe(303);
    const callback = new URL(response.headers.get('location')!);
    expect(callback.origin).toBe('null');
    expect(callback.protocol).toBe('educanvas:');
    expect(callback.host).toBe('auth');
    expect(callback.pathname).toBe('/callback');
    expect([...callback.searchParams.keys()].sort()).toEqual(['code', 'state']);
    expect(callback.searchParams.get('state')).toBe(validBody.state);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(mocks.loadConversation).toHaveBeenCalledWith({
      token: '',
      studentId: 'user:one',
    });
    expect(mocks.issueAuthorizationCode).toHaveBeenCalledWith({
      userId: 'user:one',
      codeChallenge: validBody.code_challenge,
      notebookId: 'notebook:one',
      conversationId: 'conversation:one',
    });
  });

  it('fails closed when the signed-in user has no Web conversation to bind', async () => {
    mocks.loadConversation.mockResolvedValueOnce(null);
    const response = await POST(request(validBody));
    expect(response.status).toBe(409);
    expect(mocks.issueAuthorizationCode).not.toHaveBeenCalled();
  });
});
