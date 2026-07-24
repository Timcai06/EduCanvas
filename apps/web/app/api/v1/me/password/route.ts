import { z } from 'zod';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import {
  AccountError,
  WebAccountRepository,
} from '@/server/auth/account-repository';
import { PasswordValidationError } from '@/server/auth/password';
import {
  createWebSession,
  readRegisteredSessionIdentity,
  revokeAllWebSessionsForUser,
  writeWebSessionCookie,
} from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const passwordChangeSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
});

export async function POST(request: Request): Promise<Response> {
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
  const parsed = passwordChangeSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '密码格式不正确。');
  }
  try {
    await new WebAccountRepository().changePassword({
      userId: identity.userId,
      ...parsed.data,
    });
    await revokeAllWebSessionsForUser(identity.userId);
    await writeWebSessionCookie(await createWebSession(identity.userId));
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof PasswordValidationError) {
      return jsonError(400, error.code, '新密码至少需要 6 位。');
    }
    if (error instanceof AccountError) {
      const message =
        error.code === 'invalid_current_password'
          ? '当前密码不正确。'
          : '暂时无法修改密码。';
      return jsonError(400, error.code, message);
    }
    return jsonError(503, 'password_change_unavailable', '暂时无法修改密码。');
  }
}
