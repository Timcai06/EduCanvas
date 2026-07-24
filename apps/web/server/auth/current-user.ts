import 'server-only';

import {
  WebAccountRepository,
  type WebUserProfile,
} from './account-repository';
import { readRegisteredSessionIdentity } from './session';

/** 读取当前注册账号的公开资料；匿名与 local Agent 主体不会被伪装成账号。 */
export async function readCurrentWebUser(): Promise<WebUserProfile | null> {
  const identity = await readRegisteredSessionIdentity();
  if (!identity) return null;
  return new WebAccountRepository().getProfile(identity.userId);
}
