import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonError, jsonResponse } from '@/server/http/request-security';
import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import {
  encodeTemporalCursor,
  PaginationRequestError,
  parseListPagination,
} from '@/server/http/pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 笔记本列表:当前一对一投影返回主Conversation公开字段，不返回消息内容。 */
export async function GET(request: Request): Promise<Response> {
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonResponse({ conversations: [] });
  try {
    const pagination = parseListPagination(request, 30);
    const repository = new DrizzlePlatformConversationRepository();
    const page = await repository.listAccessibleRecentPage({
      trustedSubjectId: identity.studentId,
      agentProfileId: 'general',
      ...pagination,
    });
    return jsonResponse({
      conversations: page.items.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        lastActivityAt: conversation.lastActivityAt,
      })),
      page: { nextCursor: encodeTemporalCursor(page.nextCursor) },
    });
  } catch (error) {
    if (error instanceof PaginationRequestError) {
      return jsonError(400, error.code);
    }
    return jsonError(503, 'conversation_list_unavailable');
  }
}
