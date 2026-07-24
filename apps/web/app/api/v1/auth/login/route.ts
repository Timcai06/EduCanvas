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
import { createWebSession, writeWebSessionCookie } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  let raw: unknown;
  try {
    raw = await readLimitedJsonRequest(request);
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    throw error;
  }
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '登录信息格式不正确。');
  }
  try {
    const profile = await new WebAccountRepository().authenticate(parsed.data);
    await writeWebSessionCookie(await createWebSession(profile.userId));
    return Response.json({ user: profile });
  } catch (error) {
    if (error instanceof AccountError) {
      return jsonError(401, 'invalid_credentials', '用户名或密码不正确。');
    }
    return jsonError(503, 'login_unavailable', '暂时无法登录。');
  }
}
