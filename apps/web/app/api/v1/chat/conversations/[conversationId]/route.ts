import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { z } from 'zod';
import {
  clearActiveConversationCookie,
  isValidConversationId,
  readActiveConversationId,
  writeActiveConversationCookie,
} from '@/server/platform/general-conversation';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const renameConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
  })
  .strict();

/** 重命名当前主体拥有的 Notebook；标题写入 Space 与主 Conversation 的同一事务。 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const { conversationId } = await context.params;
  if (!isValidConversationId(conversationId)) {
    return jsonError(400, 'invalid_conversation_id', '笔记本编号不正确。');
  }
  const body = await request.json().catch(() => null);
  const parsed = renameConversationSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      'invalid_notebook_title',
      '笔记本名称应为 1 到 120 个字符。',
    );
  }
  const repository = new DrizzlePlatformConversationRepository();
  const conversation = await repository.renameOwned({
    conversationId,
    trustedSubjectId: identity.studentId,
    title: parsed.data.title,
  });
  if (!conversation) {
    return jsonError(404, 'conversation_not_found', '笔记本不存在。');
  }
  return jsonResponse({
    conversation: { id: conversation.id, title: conversation.title },
  });
}

/** 归档当前主体拥有的历史 Notebook；当前游标只切换到同主体的下一条记录。 */
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
  if (!isValidConversationId(conversationId)) {
    return jsonError(400, 'invalid_conversation_id', '历史记录编号不正确。');
  }
  const repository = new DrizzlePlatformConversationRepository();
  const archived = await repository.archiveOwned({
    conversationId,
    trustedSubjectId: identity.studentId,
  });
  if (!archived) {
    return jsonError(404, 'conversation_not_found', '历史记录不存在。');
  }
  const activeConversationId = await readActiveConversationId();
  if (activeConversationId !== conversationId) {
    return jsonResponse({
      deleted: true,
      nextConversationId: activeConversationId,
    });
  }
  const [next] = await repository.listOwnedRecent({
    trustedSubjectId: identity.studentId,
    limit: 1,
  });
  if (next) await writeActiveConversationCookie(next.id);
  else await clearActiveConversationCookie();
  return jsonResponse({ deleted: true, nextConversationId: next?.id ?? null });
}
