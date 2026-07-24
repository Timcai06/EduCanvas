import 'server-only';

import {
  WebAccountRepository,
  type WebUserProfile,
} from './account-repository';
import { readRegisteredSessionIdentity } from './session';

export async function readCurrentWebUser(): Promise<WebUserProfile | null> {
  const identity = await readRegisteredSessionIdentity();
  if (!identity) return null;
  return new WebAccountRepository().getProfile(identity.userId);
}
