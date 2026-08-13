import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  readWebIdentity: vi.fn(),
  findDesktopIdentity: vi.fn(),
}));

vi.mock('./session', () => ({
  readRegisteredSessionIdentity: mocks.readWebIdentity,
}));
vi.mock('@educanvas/db', () => ({
  DrizzleWebSessionRepository: class {
    findActiveRegisteredUserIdByTokenHash = mocks.findDesktopIdentity;
  },
}));

import { readAuthenticatedRequestIdentity } from './request-identity';

describe('readAuthenticatedRequestIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readWebIdentity.mockResolvedValue({ userId: 'user:web' });
    mocks.findDesktopIdentity.mockResolvedValue('user:desktop');
  });

  it('uses the existing HttpOnly Web session when Authorization is absent', async () => {
    await expect(
      readAuthenticatedRequestIdentity(new Request('http://localhost/test')),
    ).resolves.toEqual({ userId: 'user:web', source: 'web' });
  });

  it('preserves the trusted local deployment identity without a Web cookie', async () => {
    vi.stubEnv('EDUCANVAS_DEPLOYMENT_ENV', 'local');
    vi.stubEnv('EDUCANVAS_LOCAL_USER_ID', 'local:owner');
    mocks.readWebIdentity.mockResolvedValueOnce(null);
    await expect(
      readAuthenticatedRequestIdentity(new Request('http://localhost/test')),
    ).resolves.toEqual({ userId: 'local:owner', source: 'web' });
    vi.unstubAllEnvs();
  });

  it('accepts only an ecs1 bearer and queries its SHA-256 hash', async () => {
    const token = `ecs1_${'t'.repeat(43)}`;
    await expect(
      readAuthenticatedRequestIdentity(
        new Request('http://localhost/test', {
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    ).resolves.toEqual({ userId: 'user:desktop', source: 'desktop' });
    expect(mocks.findDesktopIdentity).toHaveBeenCalledWith({
      tokenHash: createHash('sha256').update(token).digest('hex'),
    });
    expect(mocks.readWebIdentity).not.toHaveBeenCalled();
  });

  it('fails closed for malformed or inactive bearers without Cookie fallback', async () => {
    for (const authorization of ['Bearer web-cookie-token', 'Basic abc']) {
      await expect(
        readAuthenticatedRequestIdentity(
          new Request('http://localhost/test', {
            headers: { authorization },
          }),
        ),
      ).resolves.toBeNull();
    }
    mocks.findDesktopIdentity.mockResolvedValueOnce(null);
    await expect(
      readAuthenticatedRequestIdentity(
        new Request('http://localhost/test', {
          headers: { authorization: `Bearer ecs1_${'x'.repeat(43)}` },
        }),
      ),
    ).resolves.toBeNull();
    expect(mocks.readWebIdentity).not.toHaveBeenCalled();
  });
});
