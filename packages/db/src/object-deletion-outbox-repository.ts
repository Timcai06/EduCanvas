import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { getDb } from './client';
import { objectDeletionOutbox } from './schema';

type Database = ReturnType<typeof getDb>;

export const MAX_OBJECT_DELETION_ATTEMPTS = 10;

export interface ObjectDeletionClaim {
  id: string;
  objectKind: 'asset' | 'artifact' | 'avatar';
  storageKey: string;
  sourceType:
    | 'asset_version'
    | 'asset_representation'
    | 'artifact_version'
    | 'user_avatar';
  sourceId: string;
  attempt: number;
}

function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60 * 1_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

/** Worker 侧 Outbox 消费器；行锁保证多 Worker 不会同时删除同一个对象。 */
export class DrizzleObjectDeletionOutboxRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async claimBatch(input: {
    limit?: number;
    now?: Date;
  }): Promise<readonly ObjectDeletionClaim[]> {
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    return this.database.transaction(async (transaction) => {
      const candidates = await transaction
        .select()
        .from(objectDeletionOutbox)
        .where(
          and(
            eq(objectDeletionOutbox.status, 'pending'),
            lte(objectDeletionOutbox.availableAt, now),
          ),
        )
        .orderBy(
          asc(objectDeletionOutbox.availableAt),
          asc(objectDeletionOutbox.id),
        )
        .limit(limit)
        .for('update', { skipLocked: true });
      const claims: ObjectDeletionClaim[] = [];
      for (const candidate of candidates) {
        const [claimed] = await transaction
          .update(objectDeletionOutbox)
          .set({
            status: 'processing',
            attempts: sql`${objectDeletionOutbox.attempts} + 1`,
            claimedAt: now,
            failureCode: null,
          })
          .where(eq(objectDeletionOutbox.id, candidate.id))
          .returning();
        if (!claimed) continue;
        claims.push({
          id: claimed.id,
          objectKind: claimed.objectKind as ObjectDeletionClaim['objectKind'],
          storageKey: claimed.storageKey,
          sourceType: claimed.sourceType as ObjectDeletionClaim['sourceType'],
          sourceId: claimed.sourceId,
          attempt: claimed.attempts,
        });
      }
      return claims;
    });
  }

  async complete(id: string, now = new Date()): Promise<void> {
    await this.database
      .update(objectDeletionOutbox)
      .set({ status: 'completed', completedAt: now })
      .where(
        and(
          eq(objectDeletionOutbox.id, id),
          eq(objectDeletionOutbox.status, 'processing'),
        ),
      );
  }

  async fail(
    id: string,
    input: { failureCode: string; attempt: number; now?: Date },
  ): Promise<void> {
    const now = input.now ?? new Date();
    const terminal = input.attempt >= MAX_OBJECT_DELETION_ATTEMPTS;
    await this.database
      .update(objectDeletionOutbox)
      .set({
        status: terminal ? 'failed' : 'pending',
        claimedAt: null,
        failureCode: input.failureCode.slice(0, 128),
        availableAt: new Date(now.getTime() + retryDelayMs(input.attempt)),
      })
      .where(
        and(
          eq(objectDeletionOutbox.id, id),
          eq(objectDeletionOutbox.status, 'processing'),
        ),
      );
  }
}
