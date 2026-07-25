import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { conversations, spaces } from './schema';

type ArtifactScopeReader = Pick<ReturnType<typeof getDb>, 'select'>;

/**
 * 校验产物生成所用 Notebook 与 Conversation 属于同一可信主体。
 * 只返回布尔值，不区分不存在与越权，调用方统一映射为所有权错误。
 */
export async function ownsArtifactConversationScope(
  database: ArtifactScopeReader,
  input: {
    spaceId: string;
    conversationId: string;
    trustedSubjectId: string;
  },
): Promise<boolean> {
  const [scope] = await database
    .select({
      ownerSubjectId: spaces.ownerSubjectId,
      conversationOwnerSubjectId: conversations.ownerSubjectId,
    })
    .from(spaces)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.spaceId, spaces.id),
      ),
    )
    .where(eq(spaces.id, input.spaceId))
    .limit(1);
  return (
    scope?.ownerSubjectId === input.trustedSubjectId &&
    scope.conversationOwnerSubjectId === input.trustedSubjectId
  );
}
