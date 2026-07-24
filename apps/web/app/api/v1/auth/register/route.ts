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
import { registerInputSchema } from '@/server/auth/input-policy';
import { PasswordValidationError } from '@/server/auth/password';
import {
  authRateLimitDeploymentReady,
  checkAuthAttempt,
  recordAuthFailure,
  resetAuthFailures,
} from '@/server/auth/rate-limit';
import {
  prepareWebSession,
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
  let raw: unknown;
  try {
    raw = await readLimitedJsonRequest(request);
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    throw error;
  }
  const parsed = registerInputSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '注册信息格式不正确。');
  }
  const attemptKey = `register:${parsed.data.username.trim().toLowerCase()}`;
  const attempt = checkAuthAttempt(attemptKey);
  if (!attempt.allowed) {
    return jsonError(429, 'auth_rate_limited', '注册尝试过于频繁。', {
      retryAfterMs: attempt.retryAfterMs,
    });
  }
  try {
    const newSession = prepareWebSession();
    const profile = await new WebAccountRepository().registerAndCreateSession({
      ...parsed.data,
      newSession: {
        tokenHash: newSession.tokenHash,
        expiresAt: newSession.expiresAt,
      },
      now: newSession.now,
    });
    resetAuthFailures(attemptKey);
    await writeWebSessionCookie(newSession.token);
    return Response.json({ user: profile }, { status: 201 });
  } catch (error) {
    if (error instanceof PasswordValidationError) {
      const failed = recordAuthFailure(attemptKey);
      if (!failed.allowed) {
        return jsonError(429, 'auth_rate_limited', '注册尝试过于频繁。', {
          retryAfterMs: failed.retryAfterMs,
        });
      }
      return jsonError(400, 'password_too_short', '密码需为 8 至 128 位。');
    }
    if (error instanceof AccountError) {
      const failed = recordAuthFailure(attemptKey);
      if (!failed.allowed) {
        return jsonError(429, 'auth_rate_limited', '注册尝试过于频繁。', {
          retryAfterMs: failed.retryAfterMs,
        });
      }
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
