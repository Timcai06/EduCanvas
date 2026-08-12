import 'server-only';

import type { RegisteredSessionIdentity } from '../auth/session';
import { readRegisteredSessionIdentity } from '../auth/session';
import { readDataOwnerIdentity } from './anonymous-identity';

export type EffectiveDataOwnerKind =
  'local' | 'registered' | 'anonymous' | 'none';

/**
 * 服务端身份快照。ID 只供同进程 repository 查询，必须经
 * projectPublicEffectiveSubject 投影后才能进入 HTTP 响应。
 */
export interface EffectiveSubjectSnapshot {
  registeredSession: RegisteredSessionIdentity | null;
  sessionIdentity: 'registered' | 'none';
  dataOwnerKind: EffectiveDataOwnerKind;
  dataOwnerId: string | null;
  gatewayIdentity: 'separate_session';
  automaticOwnershipMigration: false;
}

export interface PublicEffectiveSubject {
  profileIdentity: 'registered' | 'none';
  sessionIdentity: 'registered' | 'none';
  dataOwner: EffectiveDataOwnerKind;
  dataScope: 'configured_local' | 'account' | 'browser' | 'none';
  gatewayIdentity: 'separate_session';
  automaticOwnershipMigration: false;
}

function dataOwnerKind(input: {
  deploymentEnvironment: string | undefined;
  registeredSession: RegisteredSessionIdentity | null;
  dataOwnerId: string | null;
}): EffectiveDataOwnerKind {
  if (input.deploymentEnvironment?.trim() === 'local') return 'local';
  if (input.registeredSession) return 'registered';
  if (input.dataOwnerId?.startsWith('anon:v1:')) return 'anonymous';
  return 'none';
}

/**
 * 恢复一次 Web session，再据此解析 data owner，避免同一请求内重复读取或让
 * profile 的存在与否改变数据归属。Gateway 使用独立的 HMAC/session 边界。
 */
export async function readEffectiveSubject(): Promise<EffectiveSubjectSnapshot> {
  const registeredSession = await readRegisteredSessionIdentity();
  const dataOwner = await readDataOwnerIdentity(registeredSession);
  const dataOwnerId = dataOwner?.studentId ?? null;
  return {
    registeredSession,
    sessionIdentity: registeredSession ? 'registered' : 'none',
    dataOwnerKind: dataOwnerKind({
      deploymentEnvironment: process.env.EDUCANVAS_DEPLOYMENT_ENV,
      registeredSession,
      dataOwnerId,
    }),
    dataOwnerId,
    gatewayIdentity: 'separate_session',
    automaticOwnershipMigration: false,
  };
}

/** 生成最小公开 DTO；不得加入 userId、匿名摘要、Cookie 或 Gateway 凭证。 */
export function projectPublicEffectiveSubject(
  snapshot: EffectiveSubjectSnapshot,
  input: { profileAvailable: boolean },
): PublicEffectiveSubject {
  const scopes = {
    local: 'configured_local',
    registered: 'account',
    anonymous: 'browser',
    none: 'none',
  } as const;
  return {
    profileIdentity: input.profileAvailable ? 'registered' : 'none',
    sessionIdentity: snapshot.sessionIdentity,
    dataOwner: snapshot.dataOwnerKind,
    dataScope: scopes[snapshot.dataOwnerKind],
    gatewayIdentity: snapshot.gatewayIdentity,
    automaticOwnershipMigration: false,
  };
}
