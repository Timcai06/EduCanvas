import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { getDb } from './client';
import { mcpToolIntents } from './schema/mcp-intent';

type Database = ReturnType<typeof getDb>;
export const MAX_MCP_INTENT_RECONCILIATION_BATCH = 500;

/** 有界擦除未绑定或未执行的过期MCP密文；dispatching必须留给Effect Reconciler。 */
export class DrizzleMcpIntentReconciler {
  constructor(private readonly providedDatabase?: Database) {}
  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async abandonExpiredPrepared(
    input: { now?: Date; limit?: number } = {},
  ): Promise<number> {
    const now = input.now ?? new Date();
    const limit = input.limit ?? 100;
    if (
      !Number.isFinite(now.getTime()) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_MCP_INTENT_RECONCILIATION_BATCH
    ) {
      throw new Error('mcp_intent_reconciliation_input_invalid');
    }
    return this.database.transaction(async (transaction) => {
      const candidates = await transaction
        .select({ resumeRef: mcpToolIntents.resumeRef })
        .from(mcpToolIntents)
        .where(
          and(
            eq(mcpToolIntents.status, 'prepared'),
            lte(mcpToolIntents.expiresAt, now),
          ),
        )
        .orderBy(
          asc(mcpToolIntents.expiresAt),
          asc(mcpToolIntents.preparedAt),
          asc(mcpToolIntents.resumeRef),
        )
        .limit(limit)
        .for('update', { skipLocked: true });
      if (candidates.length === 0) return 0;
      const settled = await transaction
        .update(mcpToolIntents)
        .set({
          status: 'failed',
          keyVersion: null,
          nonce: null,
          ciphertext: null,
          authTag: null,
          settledAt: now,
        })
        .where(
          and(
            inArray(
              mcpToolIntents.resumeRef,
              candidates.map((item) => item.resumeRef),
            ),
            eq(mcpToolIntents.status, 'prepared'),
            lte(mcpToolIntents.expiresAt, now),
          ),
        )
        .returning({ resumeRef: mcpToolIntents.resumeRef });
      return settled.length;
    });
  }
}
