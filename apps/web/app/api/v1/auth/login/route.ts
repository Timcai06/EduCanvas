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
import { loginInputSchema } from '@/server/auth/input-policy';
import {
  authRateLimitDeploymentReady,
  checkAuthAttempt,
  recordAuthFailure,
  resetAuthFailures,
} from '@/server/auth/rate-limit';
import { createWebSession, writeWebSessionCookie } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  if (!authRateLimitDeploymentReady()) {
    return jsonError(
      503,
      'auth_rate_limit_unavailable',
      '当前部署尚未配置认证请求保护。',
    );
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
  const parsed = loginInputSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '登录信息格式不正确。');
  }
  const attemptKey = `login:${parsed.data.username.trim().toLowerCase()}`;
  const attempt = checkAuthAttempt(attemptKey);
  if (!attempt.allowed) {
    return jsonError(429, 'auth_rate_limited', '登录尝试过于频繁。', {
      retryAfterMs: attempt.retryAfterMs,
    });
  }
  try {
    const profile = await new WebAccountRepository().authenticate(parsed.data);
    resetAuthFailures(attemptKey);
    await writeWebSessionCookie(await createWebSession(profile.userId));
    return Response.json({ user: profile });
  } catch (error) {
    if (error instanceof AccountError) {
      const failed = recordAuthFailure(attemptKey);
      if (!failed.allowed) {
        return jsonError(429, 'auth_rate_limited', '登录尝试过于频繁。', {
          retryAfterMs: failed.retryAfterMs,
        });
      }
      return jsonError(401, 'invalid_credentials', '用户名或密码不正确。');
    }
    return jsonError(503, 'login_unavailable', '暂时无法登录。');
  }
}
