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
    return jsonError(403, 'forbidden_origin');
  }
  if (!authRateLimitDeploymentReady()) {
    return jsonError(503, 'auth_rate_limit_unavailable');
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
    return jsonError(400, 'invalid_request');
  }
  const attemptKey = `login:${parsed.data.username.trim().toLowerCase()}`;
  const attempt = checkAuthAttempt(attemptKey);
  if (!attempt.allowed) {
    return jsonError(429, 'auth_rate_limited', {
      retryAfterMs: attempt.retryAfterMs,
    });
  }
  try {
    const profile = await new WebAccountRepository().authenticate(parsed.data);
    resetAuthFailures(attemptKey);
    await writeWebSessionCookie(await createWebSession(profile.userId));
    return jsonResponse({ user: profile });
  } catch (error) {
    if (error instanceof AccountError) {
      const failed = recordAuthFailure(attemptKey);
      if (!failed.allowed) {
        return jsonError(429, 'auth_rate_limited', {
          retryAfterMs: failed.retryAfterMs,
        });
      }
      return jsonError(401, 'invalid_credentials');
    }
    return jsonError(503, 'login_unavailable');
  }
}
