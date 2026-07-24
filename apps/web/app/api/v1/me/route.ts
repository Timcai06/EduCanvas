import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import { readRegisteredSessionIdentity } from '@/server/auth/session';
import {
  AccountError,
  WebAccountRepository,
} from '@/server/auth/account-repository';
import { readCurrentWebUser } from '@/server/auth/current-user';
import { profileUpdateInputSchema } from '@/server/auth/input-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const user = await readCurrentWebUser();
  return Response.json(
    { user },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readRegisteredSessionIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先登录。');
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
    return jsonError(400, 'invalid_request', '资料格式不正确。');
  }
  try {
    const user = await new WebAccountRepository().updateProfile({
      userId: identity.userId,
      nickname: parsed.data.nickname,
    });
    return Response.json({ user });
  } catch (error) {
    if (error instanceof AccountError) {
      return jsonError(400, error.code, '昵称不符合要求。');
    }
    return jsonError(503, 'profile_unavailable', '暂时无法更新资料。');
  }
}
