import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { agentOperations, conversations } from './schema';
import type { getDb } from './client';
import type { PlatformTurnSnapshot } from './platform-turn-repository';

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Scope is checked before recording cancellation, so forged Notebook context cannot affect another turn. */
export async function requestPlatformTurnCancellation(
  input: {
    trustedSubjectId: string;
    turnId: string;
    conversationId?: string;
    now?: Date;
  },
  dependencies: {
    database: Database;
    loadTurn: (
      transaction: Transaction,
      turnId: string,
      replayed: boolean,
    ) => Promise<PlatformTurnSnapshot>;
    lifecycleError: (message: string) => Error;
  },
): Promise<{ turn: PlatformTurnSnapshot | null; accepted: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.turnId)) {
    throw dependencies.lifecycleError('turnId格式无效');
  }
  const now = input.now ?? new Date();
  return dependencies.database.transaction(async (transaction) => {
    const [owned] = await transaction
      .select({
        id: agentOperations.id,
        status: agentOperations.status,
        cancelRequestedAt: agentOperations.cancelRequestedAt,
      })
      .from(agentOperations)
      .innerJoin(
        conversations,
        eq(conversations.id, agentOperations.conversationId),
      )
      .where(
        and(
          eq(agentOperations.id, input.turnId),
          input.conversationId
            ? eq(agentOperations.conversationId, input.conversationId)
            : undefined,
          eq(agentOperations.kind, 'turn'),
          or(
            eq(agentOperations.actorUserId, input.trustedSubjectId),
            and(
              isNull(agentOperations.actorUserId),
              eq(conversations.ownerSubjectId, input.trustedSubjectId),
            ),
          ),
        ),
      )
      .limit(1);
    if (!owned) return { turn: null, accepted: false };
    const [updated] = await transaction
      .update(agentOperations)
      .set({ cancelRequestedAt: now })
      .where(
        and(
          eq(agentOperations.id, input.turnId),
          inArray(agentOperations.status, ['pending', 'running']),
          isNull(agentOperations.cancelRequestedAt),
        ),
      )
      .returning({ id: agentOperations.id });
    return {
      turn: await dependencies.loadTurn(transaction, input.turnId, false),
      accepted:
        Boolean(updated) ||
        (['pending', 'running'].includes(owned.status) &&
          owned.cancelRequestedAt !== null),
    };
  });
}
