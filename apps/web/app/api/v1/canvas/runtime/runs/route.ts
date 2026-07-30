import { randomBytes } from 'node:crypto';
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
  WebRuntimeAdmissionError,
  WebRuntimeRunNotFoundError,
} from '@educanvas/db';
import { readWebRuntimeHostConfig } from '@/server/canvas/web-runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z
  .object({
    requestId: z.string().uuid(),
    artifactId: z.string().uuid(),
    artifactVersionId: z.string().uuid(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readAnonymousIdentity();
  const conversation = identity
    ? await loadOwnedGeneralConversation(identity)
    : null;
  if (!identity || !conversation) {
    return jsonError(401, 'unauthorized', '请先开始对话。');
  }
  let value: unknown;
  try {
    value = await readLimitedJsonRequest(request);
  } catch (error) {
    return error instanceof JsonRequestValidationError
      ? jsonRequestErrorResponse(error)
      : jsonError(400, 'invalid_request', '运行请求不正确。');
  }
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) {
    return jsonError(404, 'resource_not_found', '资源不存在。');
  }
  try {
    const config = readWebRuntimeHostConfig();
    const bootstrapToken = randomBytes(32).toString('base64url');
    const run = await new DrizzleWebRuntimeRunRepository().createAuthorizedRun({
      requestId: parsed.data.requestId,
      notebookId: conversation.spaceId,
      artifactId: parsed.data.artifactId,
      artifactVersionId: parsed.data.artifactVersionId,
      trustedSubjectId: identity.studentId,
      bootstrapToken,
    });
    return jsonResponse(
      {
        runId: run.id,
        bootstrapToken,
        runtimeOrigin: config.runtimeOrigin,
        binding: {
          protocolVersion: 'educanvas.web-runtime.v1',
          runtimeId: run.runtimeId,
          notebookId: run.notebookId,
          artifactVersionId: run.artifactVersionId,
          artifactContentHash: run.artifactContentHash,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof WebRuntimeRunNotFoundError ||
      error instanceof WebRuntimeAdmissionError
    ) {
      return jsonError(404, 'resource_not_found', '资源不存在。');
    }
    return jsonError(503, 'runtime_unavailable', '运行环境暂时不可用。');
  }
}
