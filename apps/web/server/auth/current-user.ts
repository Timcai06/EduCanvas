import 'server-only';

import {
  WebAccountRepository,
  type WebUserProfile,
} from './account-repository';
import {
  readRegisteredSessionIdentity,
  type RegisteredSessionIdentity,
} from './session';

/** 读取当前注册账号的公开资料；匿名与 local Agent 主体不会被伪装成账号。 */
export async function readCurrentWebUser(
  identity?: RegisteredSessionIdentity | null,
): Promise<WebUserProfile | null> {
  const resolvedIdentity =
    identity === undefined ? await readRegisteredSessionIdentity() : identity;
  if (!resolvedIdentity) return null;
  return new WebAccountRepository().getProfile(resolvedIdentity.userId);
}
