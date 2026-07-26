import { and, eq } from 'drizzle-orm';
import {
  requireNotebookAccess,
  type NotebookAccessExecutor,
} from './notebook-access';
import { agentOperations, conversations } from './schema';

/**
 * 校验产物生成所用 Notebook 与 Conversation 属于同一可信主体。
 * 只返回布尔值，不区分不存在与越权，调用方统一映射为所有权错误。
 */
export async function ownsArtifactConversationScope(
  database: NotebookAccessExecutor,
  input: {
    spaceId: string;
    conversationId: string;
    trustedSubjectId: string;
    operationId?: string | null;
  },
): Promise<boolean> {
  const [scope] = await database
    .select({ conversationId: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.spaceId, input.spaceId),
        eq(conversations.status, 'active'),
      ),
    )
    .limit(1);
  if (!scope) return false;
  const access = await requireNotebookAccess(database, {
    notebookId: input.spaceId,
    trustedSubjectId: input.trustedSubjectId,
    requiredPermission: 'artifact.write',
  }).catch(() => null);
  if (!access || !input.operationId) return Boolean(access);

  const [operation] = await database
    .select({ id: agentOperations.id })
    .from(agentOperations)
    .where(
      and(
        eq(agentOperations.id, input.operationId),
        eq(agentOperations.conversationId, input.conversationId),
        eq(agentOperations.actorUserId, input.trustedSubjectId),
        eq(agentOperations.kind, 'turn'),
      ),
    )
    .limit(1);
  return Boolean(operation);
}
