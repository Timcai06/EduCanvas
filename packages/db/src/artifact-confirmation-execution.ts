import { and, eq, inArray } from 'drizzle-orm';
import type { getDb } from './client';
import type { ArtifactConfirmationScope } from './artifact-confirmation-repository';
import {
  agentOperations,
  artifactConfirmationRequests,
  conversationMessages,
} from './schema';

type Database = ReturnType<typeof getDb>;

export async function selectArtifactConfirmationExecution(
  database: Database,
  input: ArtifactConfirmationScope & { confirmationId: string },
) {
  const [row] = await database
    .select({
      confirmation: artifactConfirmationRequests,
      proposalParts: conversationMessages.parts,
    })
    .from(artifactConfirmationRequests)
    .innerJoin(
      agentOperations,
      and(
        eq(agentOperations.id, artifactConfirmationRequests.operationId),
        eq(
          agentOperations.actorUserId,
          artifactConfirmationRequests.actorUserId,
        ),
        eq(agentOperations.notebookId, artifactConfirmationRequests.notebookId),
        eq(
          agentOperations.conversationId,
          artifactConfirmationRequests.conversationId,
        ),
        eq(agentOperations.kind, 'turn'),
      ),
    )
    .innerJoin(
      conversationMessages,
      and(
        eq(conversationMessages.id, artifactConfirmationRequests.userMessageId),
        eq(
          conversationMessages.operationId,
          artifactConfirmationRequests.operationId,
        ),
        eq(
          conversationMessages.conversationId,
          artifactConfirmationRequests.conversationId,
        ),
        eq(conversationMessages.role, 'user'),
      ),
    )
    .where(
      and(
        eq(artifactConfirmationRequests.id, input.confirmationId),
        eq(artifactConfirmationRequests.actorUserId, input.actorUserId),
        eq(artifactConfirmationRequests.notebookId, input.notebookId),
        eq(artifactConfirmationRequests.conversationId, input.conversationId),
        inArray(artifactConfirmationRequests.status, ['pending', 'confirmed']),
      ),
    )
    .limit(1);
  return row ?? null;
}
