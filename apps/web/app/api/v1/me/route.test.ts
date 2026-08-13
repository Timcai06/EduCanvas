import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  readCurrentWebUser: vi.fn(),
  readEffectiveSubject: vi.fn(),
  projectPublicEffectiveSubject: vi.fn(),
  readRegisteredSessionIdentity: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('@/server/auth/current-user', () => ({
  readCurrentWebUser: mocks.readCurrentWebUser,
}));

vi.mock('@/server/identity/effective-subject', () => ({
  readEffectiveSubject: mocks.readEffectiveSubject,
  projectPublicEffectiveSubject: mocks.projectPublicEffectiveSubject,
}));

vi.mock('@/server/auth/session', () => ({
  readRegisteredSessionIdentity: mocks.readRegisteredSessionIdentity,
}));

vi.mock('@/server/auth/account-repository', () => {
  class AccountError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    AccountError,
    WebAccountRepository: class {
      updateProfile = mocks.updateProfile;
    },
  };
});

import { GET } from './route';

function expectNoPrivateIdentityFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectNoPrivateIdentityFields);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    expect(key).not.toMatch(/^(?:dataOwnerId|userId|token|tokenHash|hash)$/i);
    expectNoPrivateIdentityFields(nested);
  }
}

describe('GET /api/v1/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCurrentWebUser.mockResolvedValue({
      userId: 'user:profile-private',
      username: 'student',
      nickname: '同学',
      avatarAvailable: false,
    });
    mocks.readEffectiveSubject.mockResolvedValue({
      registeredSession: { userId: 'user:profile-private' },
      sessionIdentity: 'registered',
      dataOwnerKind: 'local',
      dataOwnerId: 'local:private-owner',
      gatewayIdentity: 'separate_session',
      automaticOwnershipMigration: false,
    });
    mocks.projectPublicEffectiveSubject.mockReturnValue({
      profileIdentity: 'registered',
      sessionIdentity: 'registered',
      dataOwner: 'local',
      dataScope: 'configured_local',
      gatewayIdentity: 'separate_session',
      automaticOwnershipMigration: false,
    });
  });

  it('复用同一注册session读取资料并返回不可缓存公共投影', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.readCurrentWebUser).toHaveBeenCalledTimes(1);
    expect(mocks.readCurrentWebUser).toHaveBeenCalledWith({
      userId: 'user:profile-private',
    });
    expect(mocks.readEffectiveSubject).toHaveBeenCalledTimes(1);
    expect(mocks.projectPublicEffectiveSubject).toHaveBeenCalledWith(
      expect.objectContaining({
        dataOwnerId: 'local:private-owner',
        gatewayIdentity: 'separate_session',
      }),
      { profileAvailable: true },
    );

    const body = await response.json();
    expect(body).toMatchObject({
      user: {
        username: 'student',
        nickname: '同学',
        avatarAvailable: false,
      },
      subject: {
        profileIdentity: 'registered',
        sessionIdentity: 'registered',
        dataOwner: 'local',
        dataScope: 'configured_local',
        gatewayIdentity: 'separate_session',
        automaticOwnershipMigration: false,
      },
    });
    expectNoPrivateIdentityFields(body);
  });

  it('响应不泄露profile/data owner原始ID、token或hash', async () => {
    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain('user:profile-private');
    expect(serialized).not.toContain('local:private-owner');
    expect(serialized).not.toContain('anonymous-raw-token');
    expectNoPrivateIdentityFields(body);
  });

  it('无账号资料时仍返回无迁移的effective subject契约', async () => {
    mocks.readCurrentWebUser.mockResolvedValue(null);
    mocks.readEffectiveSubject.mockResolvedValue({
      registeredSession: null,
      sessionIdentity: 'none',
      dataOwnerKind: 'anonymous',
      dataOwnerId: `anon:v1:${'b'.repeat(64)}`,
      gatewayIdentity: 'separate_session',
      automaticOwnershipMigration: false,
    });
    mocks.projectPublicEffectiveSubject.mockReturnValue({
      profileIdentity: 'none',
      sessionIdentity: 'none',
      dataOwner: 'anonymous',
      dataScope: 'browser',
      gatewayIdentity: 'separate_session',
      automaticOwnershipMigration: false,
    });

    const response = await GET();
    const body = await response.json();

    expect(mocks.projectPublicEffectiveSubject).toHaveBeenCalledWith(
      expect.objectContaining({ dataOwnerKind: 'anonymous' }),
      { profileAvailable: false },
    );
    expect(body).toMatchObject({
      user: null,
      subject: {
        profileIdentity: 'none',
        dataOwner: 'anonymous',
        dataScope: 'browser',
      },
    });
    expect(JSON.stringify(body)).not.toContain('anon:v1:');
    expectNoPrivateIdentityFields(body);
  });
});
