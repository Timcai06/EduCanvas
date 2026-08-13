import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  readRegisteredSessionIdentity: vi.fn(),
  readDataOwnerIdentity: vi.fn(),
}));

vi.mock('../auth/session', () => ({
  readRegisteredSessionIdentity: mocks.readRegisteredSessionIdentity,
}));

vi.mock('./anonymous-identity', () => ({
  readDataOwnerIdentity: mocks.readDataOwnerIdentity,
}));

import {
  projectPublicEffectiveSubject,
  readEffectiveSubject,
} from './effective-subject';

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

describe('effective subject contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('local+registered只把账号当作session资料，data owner仍为local主体', async () => {
    vi.stubEnv('EDUCANVAS_DEPLOYMENT_ENV', 'local');
    mocks.readRegisteredSessionIdentity.mockResolvedValue({
      userId: 'user:registered',
    });
    mocks.readDataOwnerIdentity.mockResolvedValue({
      token: '',
      studentId: 'local:owner',
    });

    await expect(readEffectiveSubject()).resolves.toEqual({
      registeredSession: { userId: 'user:registered' },
      sessionIdentity: 'registered',
      dataOwnerKind: 'local',
      dataOwnerId: 'local:owner',
      gatewayIdentity: 'separate_session',
      automaticOwnershipMigration: false,
    });
    expect(mocks.readDataOwnerIdentity).toHaveBeenCalledWith({
      userId: 'user:registered',
    });
  });

  it('cloud registered session与data owner明确对齐', async () => {
    vi.stubEnv('EDUCANVAS_DEPLOYMENT_ENV', 'cloud');
    mocks.readRegisteredSessionIdentity.mockResolvedValue({
      userId: 'user:registered',
    });
    mocks.readDataOwnerIdentity.mockResolvedValue({
      token: '',
      studentId: 'user:registered',
    });

    await expect(readEffectiveSubject()).resolves.toEqual({
      registeredSession: { userId: 'user:registered' },
      sessionIdentity: 'registered',
      dataOwnerKind: 'registered',
      dataOwnerId: 'user:registered',
      gatewayIdentity: 'separate_session',
      automaticOwnershipMigration: false,
    });
  });

  it('cloud anonymous仅投影匿名data owner，不伪装注册session', async () => {
    vi.stubEnv('EDUCANVAS_DEPLOYMENT_ENV', 'cloud');
    mocks.readRegisteredSessionIdentity.mockResolvedValue(null);
    mocks.readDataOwnerIdentity.mockResolvedValue({
      token: 'anonymous-raw-token',
      studentId: `anon:v1:${'a'.repeat(64)}`,
    });

    const snapshot = await readEffectiveSubject();
    expect(snapshot).toEqual({
      registeredSession: null,
      sessionIdentity: 'none',
      dataOwnerKind: 'anonymous',
      dataOwnerId: `anon:v1:${'a'.repeat(64)}`,
      gatewayIdentity: 'separate_session',
      automaticOwnershipMigration: false,
    });

    const projected = projectPublicEffectiveSubject(snapshot, {
      profileAvailable: false,
    });
    expect(projected).toMatchObject({
      profileIdentity: 'none',
      sessionIdentity: 'none',
      dataOwner: 'anonymous',
      dataScope: 'browser',
      gatewayIdentity: 'separate_session',
      automaticOwnershipMigration: false,
    });
    expectNoPrivateIdentityFields(projected);
    expect(JSON.stringify(projected)).not.toContain('anon:v1:');
    expect(JSON.stringify(projected)).not.toContain('anonymous-raw-token');
  });

  it('无Web session和匿名Cookie时诚实返回无data owner', async () => {
    vi.stubEnv('EDUCANVAS_DEPLOYMENT_ENV', 'cloud');
    mocks.readRegisteredSessionIdentity.mockResolvedValue(null);
    mocks.readDataOwnerIdentity.mockResolvedValue(null);

    await expect(readEffectiveSubject()).resolves.toEqual({
      registeredSession: null,
      sessionIdentity: 'none',
      dataOwnerKind: 'none',
      dataOwnerId: null,
      gatewayIdentity: 'separate_session',
      automaticOwnershipMigration: false,
    });
  });

  it('公共投影不暴露主体ID且声明Gateway使用独立session', () => {
    const publicSubject = projectPublicEffectiveSubject(
      {
        registeredSession: { userId: 'user:registered' },
        sessionIdentity: 'registered',
        dataOwnerKind: 'local',
        dataOwnerId: 'local:private-owner',
        gatewayIdentity: 'separate_session',
        automaticOwnershipMigration: false,
      },
      { profileAvailable: true },
    );

    expect(publicSubject).toMatchObject({
      profileIdentity: 'registered',
      sessionIdentity: 'registered',
      dataOwner: 'local',
      dataScope: 'configured_local',
      gatewayIdentity: 'separate_session',
      automaticOwnershipMigration: false,
    });
    expectNoPrivateIdentityFields(publicSubject);
    expect(JSON.stringify(publicSubject)).not.toContain('local:private-owner');
  });
});
