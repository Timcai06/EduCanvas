import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  agentOperations,
  conversationMessageCitations,
  conversations,
  operationSources,
  researchCheckpoints,
} from './schema';
import { isUuid } from './internal/identifiers';
import {
  normalizeResearchCandidateUrls,
  normalizeResearchQueries,
  parseResearchCheckpointPhase,
  parseResearchOperationStatus,
  RESEARCH_CHECKPOINT_PHASE_INDEX,
  RESEARCH_CHECKPOINT_PROTOCOL_VERSION,
  ResearchCheckpointConflictError,
  ResearchCheckpointLifecycleError,
  ResearchCheckpointOwnershipError,
  researchOperationIsTerminal,
  type ResearchCheckpointPhase,
  type ResearchCheckpointPublicSnapshot,
  type ResearchCheckpointSnapshot,
  type ResearchOperationStatus,
} from './research-checkpoint-contract';

export {
  normalizeResearchCandidateUrl,
  normalizeResearchQuery,
  RESEARCH_CHECKPOINT_PHASES,
  RESEARCH_CHECKPOINT_PROTOCOL_VERSION,
  ResearchCheckpointConflictError,
  ResearchCheckpointLifecycleError,
  ResearchCheckpointOwnershipError,
  ResearchCheckpointValidationError,
  type ResearchCheckpointPhase,
  type ResearchCheckpointPublicSnapshot,
  type ResearchCheckpointSnapshot,
  type ResearchOperationStatus,
} from './research-checkpoint-contract';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

function actorIdFromInput(input: {
  actorId?: string;
  actorUserId?: string;
}): string {
  if (
    input.actorId &&
    input.actorUserId &&
    input.actorId !== input.actorUserId
  ) {
    throw new ResearchCheckpointOwnershipError();
  }
  const actorId = input.actorId ?? input.actorUserId;
  if (!actorId || actorId.length < 1 || actorId.length > 160) {
    throw new ResearchCheckpointOwnershipError();
  }
  return actorId;
}

function toSnapshot(
  row: typeof researchCheckpoints.$inferSelect,
): ResearchCheckpointSnapshot {
  const phase = parseResearchCheckpointPhase(row.phase);
  if (row.protocolVersion !== RESEARCH_CHECKPOINT_PROTOCOL_VERSION) {
    throw new ResearchCheckpointConflictError();
  }
  return {
    operationId: row.operationId,
    protocolVersion: RESEARCH_CHECKPOINT_PROTOCOL_VERSION,
    phase,
    completedQueries: normalizeResearchQueries(row.completedQueries),
    candidateUrls: normalizeResearchCandidateUrls(row.candidateUrls),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function effectiveUpdatedAt(current: Date | undefined, requested: Date): Date {
  if (!current || current.getTime() <= requested.getTime()) return requested;
  return current;
}

type OwnershipInput = {
  operationId: string;
  conversationId: string;
  actorId?: string;
  actorUserId?: string;
};

async function requireOwnedOperation(
  executor: DatabaseExecutor,
  input: OwnershipInput,
) {
  const actorId = actorIdFromInput(input);
  if (!isUuid(input.operationId) || !isUuid(input.conversationId)) {
    throw new ResearchCheckpointOwnershipError();
  }
  const [operation] = await executor
    .select({
      id: agentOperations.id,
      conversationId: agentOperations.conversationId,
      actorUserId: agentOperations.actorUserId,
      status: agentOperations.status,
    })
    .from(agentOperations)
    .innerJoin(
      conversations,
      eq(conversations.id, agentOperations.conversationId),
    )
    .where(
      and(
        eq(agentOperations.id, input.operationId),
        eq(agentOperations.conversationId, input.conversationId),
        eq(agentOperations.actorUserId, actorId),
      ),
    )
    .limit(1);
  if (!operation) throw new ResearchCheckpointOwnershipError();
  return {
    ...operation,
    status: parseResearchOperationStatus(operation.status),
  };
}

async function lockOperation(
  executor: DatabaseExecutor,
  operationId: string,
): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`research-checkpoint-v1:${operationId}`}, 0))`,
  );
}

function assertWritable(operation: { status: ResearchOperationStatus }): void {
  if (researchOperationIsTerminal(operation.status)) {
    throw new ResearchCheckpointLifecycleError(
      'Operation已进入终态，不能写入Research checkpoint',
    );
  }
}

/** PostgreSQL-backed bounded Deep Research checkpoint. */
export class DrizzleResearchCheckpointRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createOrGet(
    input: OwnershipInput & {
      phase?: ResearchCheckpointPhase;
      completedQueries?: readonly string[];
      candidateUrls?: readonly string[];
      now?: Date;
    },
  ): Promise<{ checkpoint: ResearchCheckpointSnapshot; replayed: boolean }> {
    const phase = parseResearchCheckpointPhase(input.phase ?? 'planning');
    const completedQueries = normalizeResearchQueries(
      input.completedQueries ?? [],
    );
    const candidateUrls = normalizeResearchCandidateUrls(
      input.candidateUrls ?? [],
    );
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await lockOperation(transaction, input.operationId);
      const operation = await requireOwnedOperation(transaction, input);
      const [existing] = await transaction
        .select()
        .from(researchCheckpoints)
        .where(eq(researchCheckpoints.operationId, input.operationId))
        .limit(1);
      if (existing) {
        if (existing.protocolVersion !== RESEARCH_CHECKPOINT_PROTOCOL_VERSION) {
          throw new ResearchCheckpointConflictError();
        }
        return { checkpoint: toSnapshot(existing), replayed: true };
      }
      assertWritable(operation);
      const [created] = await transaction
        .insert(researchCheckpoints)
        .values({
          operationId: input.operationId,
          protocolVersion: RESEARCH_CHECKPOINT_PROTOCOL_VERSION,
          phase,
          completedQueries,
          candidateUrls,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error('Research checkpoint写入后无法读取');
      return { checkpoint: toSnapshot(created), replayed: false };
    });
  }

  async get(input: OwnershipInput): Promise<ResearchCheckpointSnapshot | null> {
    const operation = await requireOwnedOperation(this.database, input);
    const [row] = await this.database
      .select()
      .from(researchCheckpoints)
      .where(eq(researchCheckpoints.operationId, operation.id))
      .limit(1);
    return row ? toSnapshot(row) : null;
  }

  async mergeProgress(
    input: OwnershipInput & {
      completedQueries?: readonly string[];
      candidateUrls?: readonly string[];
      now?: Date;
    },
  ): Promise<ResearchCheckpointSnapshot> {
    const addedQueries = normalizeResearchQueries(input.completedQueries ?? []);
    const addedUrls = normalizeResearchCandidateUrls(input.candidateUrls ?? []);
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await lockOperation(transaction, input.operationId);
      const operation = await requireOwnedOperation(transaction, input);
      assertWritable(operation);
      const [existing] = await transaction
        .select()
        .from(researchCheckpoints)
        .where(eq(researchCheckpoints.operationId, input.operationId))
        .limit(1);
      if (!existing) {
        const [created] = await transaction
          .insert(researchCheckpoints)
          .values({
            operationId: input.operationId,
            protocolVersion: RESEARCH_CHECKPOINT_PROTOCOL_VERSION,
            phase: 'planning',
            completedQueries: addedQueries,
            candidateUrls: addedUrls,
            updatedAt: now,
          })
          .returning();
        if (!created) throw new Error('Research checkpoint写入后无法读取');
        return toSnapshot(created);
      }
      if (existing.protocolVersion !== RESEARCH_CHECKPOINT_PROTOCOL_VERSION) {
        throw new ResearchCheckpointConflictError();
      }
      const completedQueries = normalizeResearchQueries([
        ...existing.completedQueries,
        ...addedQueries,
      ]);
      const candidateUrls = normalizeResearchCandidateUrls([
        ...existing.candidateUrls,
        ...addedUrls,
      ]);
      const changed =
        completedQueries.length !== existing.completedQueries.length ||
        candidateUrls.length !== existing.candidateUrls.length;
      if (!changed) return toSnapshot(existing);
      const [updated] = await transaction
        .update(researchCheckpoints)
        .set({
          completedQueries,
          candidateUrls,
          updatedAt: effectiveUpdatedAt(existing.updatedAt, now),
        })
        .where(eq(researchCheckpoints.operationId, input.operationId))
        .returning();
      if (!updated) throw new Error('Research checkpoint更新后无法读取');
      return toSnapshot(updated);
    });
  }

  async advancePhase(
    input: OwnershipInput & {
      phase: ResearchCheckpointPhase;
      now?: Date;
    },
  ): Promise<ResearchCheckpointSnapshot> {
    const nextPhase = parseResearchCheckpointPhase(input.phase);
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await lockOperation(transaction, input.operationId);
      const operation = await requireOwnedOperation(transaction, input);
      assertWritable(operation);
      const [existing] = await transaction
        .select()
        .from(researchCheckpoints)
        .where(eq(researchCheckpoints.operationId, input.operationId))
        .limit(1);
      if (!existing) {
        const [created] = await transaction
          .insert(researchCheckpoints)
          .values({
            operationId: input.operationId,
            protocolVersion: RESEARCH_CHECKPOINT_PROTOCOL_VERSION,
            phase: nextPhase,
            completedQueries: [],
            candidateUrls: [],
            updatedAt: now,
          })
          .returning();
        if (!created) throw new Error('Research checkpoint写入后无法读取');
        return toSnapshot(created);
      }
      if (existing.protocolVersion !== RESEARCH_CHECKPOINT_PROTOCOL_VERSION) {
        throw new ResearchCheckpointConflictError();
      }
      const currentPhase = parseResearchCheckpointPhase(existing.phase);
      if (
        RESEARCH_CHECKPOINT_PHASE_INDEX.get(nextPhase)! <=
        RESEARCH_CHECKPOINT_PHASE_INDEX.get(currentPhase)!
      ) {
        return toSnapshot(existing);
      }
      const [updated] = await transaction
        .update(researchCheckpoints)
        .set({
          phase: nextPhase,
          updatedAt: effectiveUpdatedAt(existing.updatedAt, now),
        })
        .where(eq(researchCheckpoints.operationId, input.operationId))
        .returning();
      if (!updated) throw new Error('Research checkpoint更新后无法读取');
      return toSnapshot(updated);
    });
  }

  /** Return counts and citation ordinals only; raw queries and URLs never cross this boundary. */
  async getPublicSnapshot(
    input: OwnershipInput,
  ): Promise<ResearchCheckpointPublicSnapshot | null> {
    const operation = await requireOwnedOperation(this.database, input);
    const [checkpoint] = await this.database
      .select()
      .from(researchCheckpoints)
      .where(eq(researchCheckpoints.operationId, operation.id))
      .limit(1);
    if (!checkpoint) return null;
    const checkpointSnapshot = toSnapshot(checkpoint);
    const [sourceCountRow] = await this.database
      .select({ sourceCount: sql<number>`count(*)::int` })
      .from(operationSources)
      .where(eq(operationSources.operationId, operation.id));
    const citationRows = await this.database
      .select({ ordinal: operationSources.ordinal })
      .from(conversationMessageCitations)
      .innerJoin(
        operationSources,
        eq(operationSources.id, conversationMessageCitations.operationSourceId),
      )
      .where(eq(operationSources.operationId, operation.id))
      .orderBy(asc(operationSources.ordinal));
    const status = operation.status;
    return {
      operationId: operation.id,
      phase: checkpointSnapshot.phase,
      completedQueryCount: checkpointSnapshot.completedQueries.length,
      candidateCount: checkpointSnapshot.candidateUrls.length,
      sourceCount: Number(sourceCountRow?.sourceCount ?? 0),
      citationOrdinals: [...new Set(citationRows.map((row) => row.ordinal))],
      operationStatus: status,
      terminal: researchOperationIsTerminal(status),
    };
  }
}
