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
    return jsonError(403, 'forbidden_origin');
  }
  if (!authRateLimitDeploymentReady()) {
    return jsonError(503, 'auth_rate_limit_unavailable');
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
  const parsed = passwordChangeInputSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request');
  }
  const attemptKey = `password:${identity.userId}`;
  const attempt = checkAuthAttempt(attemptKey);
  if (!attempt.allowed) {
    return jsonError(429, 'auth_rate_limited', {
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
    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof PasswordValidationError) {
      return jsonError(400, error.code);
    }
    if (error instanceof AccountError) {
      if (error.code === 'invalid_current_password') {
        const failed = recordAuthFailure(attemptKey);
        if (!failed.allowed) {
          return jsonError(429, 'auth_rate_limited', {
            retryAfterMs: failed.retryAfterMs,
          });
        }
      }
      return jsonError(400, error.code);
    }
    return jsonError(503, 'password_change_unavailable');
  }
}
