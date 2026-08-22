import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import { readRegisteredSessionIdentity } from '@/server/auth/session';
import {
  AccountError,
  WebAccountRepository,
} from '@/server/auth/account-repository';
import { readCurrentWebUser } from '@/server/auth/current-user';
import { profileUpdateInputSchema } from '@/server/auth/input-policy';
import {
  projectPublicEffectiveSubject,
  readEffectiveSubject,
} from '@/server/identity/effective-subject';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicUserProfile(user: {
  username: string;
  nickname: string;
  avatarAvailable: boolean;
}) {
  return {
    username: user.username,
    nickname: user.nickname,
    avatarAvailable: user.avatarAvailable,
  };
}

export async function GET(): Promise<Response> {
  const subject = await readEffectiveSubject();
  const user = await readCurrentWebUser(subject.registeredSession);
  return jsonResponse(
    {
      user: user ? publicUserProfile(user) : null,
      subject: projectPublicEffectiveSubject(subject, {
        profileAvailable: user !== null,
      }),
    },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  const identity = await readRegisteredSessionIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  let raw: unknown;
  try {
    raw = await readLimitedJsonRequest(request);
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    throw error;
  }
  const parsed = profileUpdateInputSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request');
  }
  try {
    const user = await new WebAccountRepository().updateProfile({
      userId: identity.userId,
      nickname: parsed.data.nickname,
    });
    return jsonResponse({ user: publicUserProfile(user) });
  } catch (error) {
    if (error instanceof AccountError) {
      return jsonError(400, error.code);
    }
    return jsonError(503, 'profile_unavailable');
  }
}
