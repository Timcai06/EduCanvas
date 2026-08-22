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
  const parsed = registerInputSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request');
  }
  const attemptKey = `register:${parsed.data.username.trim().toLowerCase()}`;
  const attempt = checkAuthAttempt(attemptKey);
  if (!attempt.allowed) {
    return jsonError(429, 'auth_rate_limited', {
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
    return jsonResponse({ user: profile }, { status: 201 });
  } catch (error) {
    if (error instanceof PasswordValidationError) {
      const failed = recordAuthFailure(attemptKey);
      if (!failed.allowed) {
        return jsonError(429, 'auth_rate_limited', {
          retryAfterMs: failed.retryAfterMs,
        });
      }
      return jsonError(400, 'password_too_short');
    }
    if (error instanceof AccountError) {
      const failed = recordAuthFailure(attemptKey);
      if (!failed.allowed) {
        return jsonError(429, 'auth_rate_limited', {
          retryAfterMs: failed.retryAfterMs,
        });
      }
      const status = error.code === 'username_taken' ? 409 : 400;
      return jsonError(status, error.code);
    }
    return jsonError(503, 'register_unavailable');
  }
}
