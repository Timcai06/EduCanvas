import { z } from 'zod';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import {
  DrizzleWebRuntimeRunRepository,
  WebRuntimeRunNotFoundError,
} from '@educanvas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ requestId: z.string().uuid() }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
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
  try {
    const run = await new DrizzleWebRuntimeRunRepository().cancelAuthorizedRun({
      requestId: params.data.requestId,
      notebookId: conversation.spaceId,
      trustedSubjectId: identity.studentId,
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
