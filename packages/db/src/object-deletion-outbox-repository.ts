import { and, asc, eq, lt, lte, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import { objectDeletionOutbox } from './schema';

type Database = ReturnType<typeof getDb>;

export const MAX_OBJECT_DELETION_ATTEMPTS = 10;

/** 租约超时：processing 行超过此时间未完成视为 worker 崩溃，可被其他 worker 领取。 */
export const OBJECT_DELETION_LEASE_TIMEOUT_MS = 5 * 60 * 1_000;

export interface ObjectDeletionClaim {
  id: string;
  objectKind: 'asset' | 'artifact' | 'avatar';
  storageKey: string;
  sourceType:
    | 'asset_version'
    | 'asset_representation'
    | 'asset_video_keyframe'
    | 'artifact_version'
    | 'user_avatar';
  sourceId: string;
  attempt: number;
  /** 本次 claim 的租约截止时间，complete/fail 必须在此前调用。 */
  leasedUntil: Date;
}

function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60 * 1_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

/** Worker 侧 Outbox 消费器；行锁加租约保证多 Worker 不并发处理同一行，崩溃后可恢复。 */
export class DrizzleObjectDeletionOutboxRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async claimBatch(input: {
    limit?: number;
    now?: Date;
    leaseTimeoutMs?: number;
  }): Promise<readonly ObjectDeletionClaim[]> {
    const now = input.now ?? new Date();
    const leaseTimeoutMs =
      input.leaseTimeoutMs ?? OBJECT_DELETION_LEASE_TIMEOUT_MS;
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const expiredLease = new Date(now.getTime() - leaseTimeoutMs);
    return this.database.transaction(async (transaction) => {
      // 领取 pending 行 + 租约过期的 processing 行（崩溃恢复）
      const candidates = await transaction
        .select()
        .from(objectDeletionOutbox)
        .where(
          and(
            or(
              eq(objectDeletionOutbox.status, 'pending'),
              and(
                eq(objectDeletionOutbox.status, 'processing'),
                lt(objectDeletionOutbox.claimedAt, expiredLease),
              ),
            ),
            lte(objectDeletionOutbox.availableAt, now),
          ),
        )
        .orderBy(
          asc(objectDeletionOutbox.availableAt),
          asc(objectDeletionOutbox.id),
        )
        .limit(limit)
        .for('update', { skipLocked: true });
      const leaseEnd = new Date(now.getTime() + leaseTimeoutMs);
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
          leasedUntil: leaseEnd,
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
