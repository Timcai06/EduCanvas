import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { isValidConversationId } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
export const dynamic = 'force-dynamic';
export async function PATCH(
  request: Request,
  context: { params: Promise<{ notebookId: string }> },
) {
  if (!isTrustedSameOriginWrite(request))
    return jsonError(403, 'forbidden_origin');
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const { notebookId } = await context.params;
  if (!isValidConversationId(notebookId))
    return jsonError(404, 'resource_not_found');
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.title !== 'string' ||
    !body.title.trim() ||
    body.title.trim().length > 120
  )
    return jsonError(400, 'invalid_notebook_title');
  const notebook =
    await new DrizzlePlatformConversationRepository().renameNotebook({
      notebookId,
      trustedSubjectId: identity.studentId,
      title: body.title,
    });
  return notebook
    ? jsonResponse({ notebook })
    : jsonError(404, 'resource_not_found');
}
