import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
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
import { loadOwnedStudyContext } from '@/server/study/study-service';
import { runCodeExercise } from '@/server/teaching/code-exercise-runner';
import {
  codeRunTrafficKey,
  codeRunTrafficLimiter,
} from '@/server/teaching/code-run-traffic-limiter';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z
  .object({
    artifactId: z.string().min(1).max(128),
    source: z.string().min(1).max(10_000),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request))
    return jsonError(403, 'forbidden_origin');

  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const context = await loadOwnedStudyContext(identity);
  if (!context) return jsonError(401, 'unauthorized');

  let body: unknown;
  try {
    body = await readLimitedJsonRequest(request, { maxBytes: 12_000 });
  } catch (error) {
    return error instanceof JsonRequestValidationError
      ? jsonRequestErrorResponse(error)
      : jsonError(400, 'invalid_request');
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, 'invalid_code_run');
  if (
    context.artifact.type !== 'code_completion' ||
    context.artifact.artifactId !== parsed.data.artifactId
  ) {
    return jsonError(404, 'code_exercise_not_found');
  }

  const lease = codeRunTrafficLimiter.acquire(
    codeRunTrafficKey(identity.studentId, context.plan.goal.notebookId),
  );
  if (!lease.allowed) {
    return jsonError(429, 'code_run_rate_limited', {
      retryAfterMs: lease.retryAfterMs,
    });
  }

  try {
    const result = await runCodeExercise({
      notebookId: context.plan.goal.notebookId,
      source: parsed.data.source,
      signal: request.signal,
    });
    return jsonResponse(result);
  } catch {
    return jsonError(503, 'code_runtime_unavailable');
  } finally {
    lease.release();
  }
}
