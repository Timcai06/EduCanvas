import type {
  AgentTurnContextLedgerPort,
  AgentTurnContextMaterial,
  AgentTurnContextSnapshot,
} from '@educanvas/agent-core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  agentOperations,
  assets,
  assetVersions,
  conversationMessages,
  turnContextSnapshots,
} from './schema';
import {
  prepareTurnContextMaterial,
  TurnContextConflictError,
} from './turn-context';
import { isUuid } from './internal/identifiers';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;
type ConcreteCreateInput = {
  operationId: string;
  actorId: string;
  material: AgentTurnContextMaterial;
  now?: Date;
};

export class AgentTurnContextOwnershipError extends Error {
  readonly code = 'agent_turn_context_not_found';

  constructor() {
    super('Context Snapshot不存在或不属于当前Actor');
    this.name = 'AgentTurnContextOwnershipError';
  }
}

export class AgentTurnContextLifecycleError extends Error {
  readonly code = 'invalid_agent_turn_context_state';

  constructor(message: string) {
    super(message);
    this.name = 'AgentTurnContextLifecycleError';
  }
}

function toSnapshot(
  row: typeof turnContextSnapshots.$inferSelect,
): AgentTurnContextSnapshot {
  if (!row.agentOperationId || row.sessionId || row.turnId) {
    throw new AgentTurnContextLifecycleError(
      'Context Snapshot不是有效agent_turn形状',
    );
  }
  return {
    id: row.id,
    operationId: row.agentOperationId,
    builderVersion: row.builderVersion,
    includedMessageIds: row.includedMessageIds,
    selectedAssetVersionIds: row.selectedAssetVersionIds,
    omittedMessageCount: row.omittedMessageCount,
    characterCount: row.characterCount,
    contextHash: row.contextHash,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireOwnedTurnOperation(
  executor: DatabaseExecutor,
  input: { operationId: string; actorId: string },
) {
  if (
    input.actorId.length < 1 ||
    input.actorId.length > 160 ||
    !isUuid(input.operationId)
  ) {
    throw new AgentTurnContextOwnershipError();
  }
  const [operation] = await executor
    .select()
    .from(agentOperations)
    .where(
      and(
        eq(agentOperations.id, input.operationId),
        eq(agentOperations.actorUserId, input.actorId),
        eq(agentOperations.kind, 'turn'),
      ),
    )
    .limit(1);
  if (!operation?.notebookId) throw new AgentTurnContextOwnershipError();
  return { ...operation, notebookId: operation.notebookId };
}

async function validateContextReferences(
  executor: DatabaseExecutor,
  input: {
    conversationId: string;
    notebookId: string;
    includedMessageIds: readonly string[];
    selectedAssetVersionIds: readonly string[];
  },
): Promise<void> {
  if (input.includedMessageIds.length > 0) {
    const messages = await executor
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, input.conversationId),
          inArray(conversationMessages.id, [...input.includedMessageIds]),
        ),
      );
    if (messages.length !== input.includedMessageIds.length) {
      throw new AgentTurnContextOwnershipError();
    }
  }
  if (input.selectedAssetVersionIds.length > 0) {
    const versions = await executor
      .select({ id: assetVersions.id })
      .from(assetVersions)
      .innerJoin(assets, eq(assets.id, assetVersions.assetId))
      .where(
        and(
          eq(assets.spaceId, input.notebookId),
          eq(assets.status, 'ready'),
          eq(assetVersions.status, 'ready'),
          inArray(assetVersions.id, [...input.selectedAssetVersionIds]),
        ),
      );
    if (versions.length !== input.selectedAssetVersionIds.length) {
      throw new AgentTurnContextOwnershipError();
    }
  }
}

function immutableFieldsMatch(
  row: typeof turnContextSnapshots.$inferSelect,
  input: ReturnType<typeof prepareTurnContextMaterial>,
): boolean {
  return (
    row.builderVersion === input.builderVersion &&
    row.contextHash === input.contextHash &&
    row.omittedMessageCount === input.omittedMessageCount &&
    row.characterCount === input.characterCount &&
    JSON.stringify(row.includedMessageIds) ===
      JSON.stringify(input.includedMessageIds) &&
    JSON.stringify(row.selectedAssetVersionIds) ===
      JSON.stringify(input.selectedAssetVersionIds)
  );
}

/**
 * PostgreSQL统一Context Snapshot账本；只持久化不可变ID、计数与摘要，且每次读取都重新验证Actor。
 */
export class DrizzleAgentTurnContextRepository implements AgentTurnContextLedgerPort {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createOrGet(
    input: ConcreteCreateInput,
  ): Promise<{ snapshot: AgentTurnContextSnapshot; replayed: boolean }> {
    const prepared = prepareTurnContextMaterial(input.material);
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${'turn-context-v2:' + input.operationId}, 0))`,
      );
      const operation = await requireOwnedTurnOperation(transaction, input);
      const [existing] = await transaction
        .select()
        .from(turnContextSnapshots)
        .where(eq(turnContextSnapshots.agentOperationId, input.operationId))
        .limit(1);
      if (existing) {
        if (!immutableFieldsMatch(existing, prepared)) {
          throw new TurnContextConflictError();
        }
        return { snapshot: toSnapshot(existing), replayed: true };
      }
      if (!['pending', 'running'].includes(operation.status)) {
        throw new AgentTurnContextLifecycleError(
          'Operation已进入终态，不能再创建Context Snapshot',
        );
      }
      await validateContextReferences(transaction, {
        conversationId: operation.conversationId,
        notebookId: operation.notebookId,
        includedMessageIds: prepared.includedMessageIds,
        selectedAssetVersionIds: prepared.selectedAssetVersionIds,
      });
      const [created] = await transaction
        .insert(turnContextSnapshots)
        .values({
          agentOperationId: operation.id,
          builderVersion: prepared.builderVersion,
          includedMessageIds: prepared.includedMessageIds,
          selectedAssetVersionIds: prepared.selectedAssetVersionIds,
          omittedMessageCount: prepared.omittedMessageCount,
          characterCount: prepared.characterCount,
          contextHash: prepared.contextHash,
          createdAt: input.now,
        })
        .returning();
      if (!created) {
        throw new AgentTurnContextLifecycleError('Context Snapshot创建失败');
      }
      return { snapshot: toSnapshot(created), replayed: false };
    });
  }

  async get(input: {
    operationId: string;
    actorId: string;
  }): Promise<AgentTurnContextSnapshot | null> {
    await requireOwnedTurnOperation(this.database, input);
    const [row] = await this.database
      .select()
      .from(turnContextSnapshots)
      .where(eq(turnContextSnapshots.agentOperationId, input.operationId))
      .limit(1);
    return row ? toSnapshot(row) : null;
  }
}
