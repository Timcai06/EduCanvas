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
import { passwordChangeInputSchema } from '@/server/auth/input-policy';
import { PasswordValidationError } from '@/server/auth/password';
import {
  authRateLimitDeploymentReady,
  checkAuthAttempt,
  recordAuthFailure,
  resetAuthFailures,
} from '@/server/auth/rate-limit';
import {
  prepareWebSession,
  readRegisteredSessionIdentity,
  writeWebSessionCookie,
} from '@/server/auth/session';

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
  const parsed = passwordChangeInputSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '密码格式不正确。');
  }
  const attemptKey = `password:${identity.userId}`;
  const attempt = checkAuthAttempt(attemptKey);
  if (!attempt.allowed) {
    return jsonError(429, 'auth_rate_limited', '密码验证尝试过于频繁。', {
      retryAfterMs: attempt.retryAfterMs,
    });
  }
  try {
    const newSession = prepareWebSession();
    await new WebAccountRepository().changePasswordAndRotateSession({
      userId: identity.userId,
      ...parsed.data,
      newSession: {
        tokenHash: newSession.tokenHash,
        expiresAt: newSession.expiresAt,
      },
      now: newSession.now,
    });
    resetAuthFailures(attemptKey);
    await writeWebSessionCookie(newSession.token);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof PasswordValidationError) {
      return jsonError(400, error.code, '新密码需为 8 至 128 位。');
    }
    if (error instanceof AccountError) {
      if (error.code === 'invalid_current_password') {
        const failed = recordAuthFailure(attemptKey);
        if (!failed.allowed) {
          return jsonError(429, 'auth_rate_limited', '密码验证尝试过于频繁。', {
            retryAfterMs: failed.retryAfterMs,
          });
        }
      }
      const message =
        error.code === 'invalid_current_password'
          ? '当前密码不正确。'
          : '暂时无法修改密码。';
      return jsonError(400, error.code, message);
    }
    return jsonError(503, 'password_change_unavailable', '暂时无法修改密码。');
  }
}
