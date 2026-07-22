import type { ToolEffectReconciliationPort } from '@educanvas/agent-core';
import { eq } from 'drizzle-orm';
import { getDb } from './client';
import {
  reconciliationMatches,
  type RecordReconciliationInput,
  requireOwnedUnknownEffect,
  toReconciliationSnapshot,
  ToolEffectReconciliationConflictError,
  type ReconciliationDatabase,
  validateReconciliationInput,
} from './tool-effect-reconciliation-persistence';
import { toolEffectReconciliations } from './schema/tool-effect-reconciliation';

export {
  ToolEffectReconciliationConflictError,
  ToolEffectReconciliationLifecycleError,
  ToolEffectReconciliationOwnershipError,
} from './tool-effect-reconciliation-persistence';

/** PostgreSQL追加式Effect决议仓储；不回写原Effect、Tool Call或Operation终态。 */
export class DrizzleToolEffectReconciliationRepository implements ToolEffectReconciliationPort {
  constructor(private readonly providedDatabase?: ReconciliationDatabase) {}

  private get database(): ReconciliationDatabase {
    return this.providedDatabase ?? getDb();
  }

  async record(input: RecordReconciliationInput) {
    validateReconciliationInput(input);
    return this.database.transaction(async (transaction) => {
      const effect = await requireOwnedUnknownEffect(transaction, input);
      if (
        effect.effectKey !== input.expectedEffectKey ||
        effect.semanticsHash !== input.expectedSemanticsHash
      ) {
        throw new ToolEffectReconciliationConflictError();
      }
      if (
        input.source === 'adapter' &&
        (effect.reconciliationVerifierId === null ||
          effect.reconciliationVerifierId !== input.resolverId)
      ) {
        throw new ToolEffectReconciliationConflictError();
      }
      const [existing] = await transaction
        .select()
        .from(toolEffectReconciliations)
        .where(eq(toolEffectReconciliations.effectId, input.effectId))
        .limit(1);
      if (existing) {
        if (!reconciliationMatches(existing, input)) {
          throw new ToolEffectReconciliationConflictError();
        }
        return {
          reconciliation: toReconciliationSnapshot(existing, effect),
          recorded: false,
        };
      }
      const [created] = await transaction
        .insert(toolEffectReconciliations)
        .values({
          effectId: input.effectId,
          resolution: input.resolution,
          source: input.source,
          resolverId: input.resolverId,
          evidenceHash: input.evidenceHash,
          receiptHash: input.receiptHash ?? null,
          code: input.code ?? null,
          resolvedAt: input.now ?? new Date(),
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        return {
          reconciliation: toReconciliationSnapshot(created, effect),
          recorded: true,
        };
      }
      const [concurrent] = await transaction
        .select()
        .from(toolEffectReconciliations)
        .where(eq(toolEffectReconciliations.effectId, input.effectId))
        .limit(1);
      if (!concurrent || !reconciliationMatches(concurrent, input)) {
        throw new ToolEffectReconciliationConflictError();
      }
      return {
        reconciliation: toReconciliationSnapshot(concurrent, effect),
        recorded: false,
      };
    });
  }

  async get(input: { operationId: string; actorId: string; effectId: string }) {
    const effect = await requireOwnedUnknownEffect(this.database, input);
    const [row] = await this.database
      .select()
      .from(toolEffectReconciliations)
      .where(eq(toolEffectReconciliations.effectId, input.effectId))
      .limit(1);
    return row ? toReconciliationSnapshot(row, effect) : null;
  }
}
