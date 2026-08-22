import { z } from 'zod';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import {
  DrizzleWebRuntimeRunRepository,
  WebRuntimeRunNotFoundError,
} from '@educanvas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ runId: z.string().uuid() }).strict();
const inputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('succeeded') }).strict(),
  z
    .object({
      status: z.literal('failed'),
      failureCode: z.enum([
        'runtime_timeout',
        'runtime_crashed',
        'resource_quota_exceeded',
        'execution_failed',
        'cancel_race_rejected',
      ]),
    })
    .strict(),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }
  const params = paramsSchema.safeParse(await context.params);
  const identity = await readAnonymousIdentity();
  const conversation = identity
    ? await loadOwnedGeneralConversation(identity)
    : null;
  if (!identity || !conversation) {
    return jsonError(401, 'unauthorized');
  }
  if (!params.success) {
    return jsonError(404, 'resource_not_found');
  }
  let value: unknown;
  try {
    value = await readLimitedJsonRequest(request);
  } catch (error) {
    return error instanceof JsonRequestValidationError
      ? jsonRequestErrorResponse(error)
      : jsonError(400, 'invalid_request');
  }
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request');
  }
  try {
    const run = await new DrizzleWebRuntimeRunRepository().settleAuthorizedRun({
      runId: params.data.runId,
      notebookId: conversation.spaceId,
      trustedSubjectId: identity.studentId,
      status: parsed.data.status,
      failureCode:
        parsed.data.status === 'failed' ? parsed.data.failureCode : undefined,
    });
    return jsonResponse({
      runId: run.id,
      status: run.status,
      terminalAuthority: run.terminalAuthority,
    });
  } catch (error) {
    if (error instanceof WebRuntimeRunNotFoundError) {
      return jsonError(404, 'resource_not_found');
    }
    return jsonError(503, 'runtime_unavailable');
  }
}
