import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import {
  clearActiveConversationCookie,
  writeActiveConversationCookie,
} from '@/server/platform/general-conversation';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const { conversationId } = await context.params;
  const repository = new DrizzlePlatformConversationRepository();
  const archived = await repository.archiveOwned({
    conversationId,
    trustedSubjectId: identity.studentId,
  });
  if (!archived) {
    return jsonError(404, 'conversation_not_found', '历史记录不存在。');
  }
  const [next] = await repository.listOwnedRecent({
    trustedSubjectId: identity.studentId,
    limit: 1,
  });
  if (next) await writeActiveConversationCookie(next.id);
  else await clearActiveConversationCookie();
  return Response.json({ deleted: true, nextConversationId: next?.id ?? null });
}
