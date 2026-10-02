import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  isValidConversationId,
  writeActiveConversationCookie,
} from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ notebookId: string }> };
async function resolve(context: Context) {
  const identity = await readAnonymousIdentity();
  const { notebookId } = await context.params;
  if (!identity || !isValidConversationId(notebookId)) return null;
  const repository = new DrizzlePlatformConversationRepository();
  const notebook = await repository.getNotebook({
    notebookId,
    trustedSubjectId: identity.studentId,
  });
  return notebook ? { repository, identity, notebookId, notebook } : null;
}
export async function GET(_request: Request, context: Context) {
  const access = await resolve(context);
  if (!access) return jsonError(404, 'resource_not_found');
  const conversations = await access.repository.listInNotebook({
    notebookId: access.notebookId,
    trustedSubjectId: access.identity.studentId,
  });
  return jsonResponse({
    conversations,
    canCreate: access.notebook.permissions.includes('conversation.create'),
    canManage: access.notebook.permissions.includes('notebook.manage'),
  });
}
export async function POST(request: Request, context: Context) {
  if (!isTrustedSameOriginWrite(request))
    return jsonError(403, 'forbidden_origin');
  const access = await resolve(context);
  if (!access) return jsonError(404, 'resource_not_found');
  const body = await request.json().catch(() => null);
  if (body?.conversationId) {
    if (!isValidConversationId(body.conversationId))
      return jsonError(404, 'resource_not_found');
    const conversation = await access.repository.getOwned({
      conversationId: body.conversationId,
      trustedSubjectId: access.identity.studentId,
    });
    if (
      !conversation ||
      conversation.spaceId !== access.notebookId ||
      conversation.agentProfileId !== 'general'
    )
      return jsonError(404, 'resource_not_found');
    await writeActiveConversationCookie(conversation.id);
    return jsonResponse({ conversation });
  }
  if (!access.notebook.permissions.includes('conversation.create'))
    return jsonError(404, 'resource_not_found');
  if (
    body?.title !== undefined &&
    (typeof body.title !== 'string' || body.title.length > 120)
  )
    return jsonError(400, 'invalid_conversation_title');
  const conversation = await access.repository.createInNotebook({
    notebookId: access.notebookId,
    trustedSubjectId: access.identity.studentId,
    title: body?.title,
  });
  await writeActiveConversationCookie(conversation.id);
  return jsonResponse({ conversation }, { status: 201 });
}
