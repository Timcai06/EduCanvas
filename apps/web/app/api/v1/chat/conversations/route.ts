import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonError } from '@/server/http/request-security';
import { DrizzlePlatformConversationRepository } from '@educanvas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 侧栏历史列表:只返回公开投影(id/title/lastActivityAt),无消息内容。 */
export async function GET(): Promise<Response> {
  const identity = await readAnonymousIdentity();
  if (!identity) return Response.json({ conversations: [] });
  try {
    const repository = new DrizzlePlatformConversationRepository();
    const conversations = await repository.listOwnedRecent({
      trustedSubjectId: identity.studentId,
    });
    return Response.json({
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        lastActivityAt: conversation.lastActivityAt,
      })),
    });
  } catch {
    return jsonError(
      503,
      'conversation_list_unavailable',
      '暂时无法读取历史对话。',
    );
  }
}
