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
import { createWebSession, writeWebSessionCookie } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  username: z.string(),
  nickname: z.string(),
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
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '注册信息格式不正确。');
  }
  try {
    const profile = await new WebAccountRepository().register(parsed.data);
    await writeWebSessionCookie(await createWebSession(profile.userId));
    return Response.json({ user: profile }, { status: 201 });
  } catch (error) {
    if (error instanceof PasswordValidationError) {
      return jsonError(400, 'password_too_short', '密码至少需要 6 位。');
    }
    if (error instanceof AccountError) {
      const status = error.code === 'username_taken' ? 409 : 400;
      const message =
        error.code === 'username_taken'
          ? '用户名已被使用。'
          : '注册信息不符合要求。';
      return jsonError(status, error.code, message);
    }
    return jsonError(503, 'register_unavailable', '暂时无法注册。');
  }
}
