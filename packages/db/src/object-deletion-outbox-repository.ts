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
  /** 本次 claim 的 attempt 编号；complete/fail 必须传入匹配的 attempt 才能推进。 */
  attempt: number;
}

function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60 * 1_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

/**
 * Worker 侧 Outbox 消费器。
 * - claimBatch 使用 FOR UPDATE SKIP LOCKED + 租约过期恢复保证单写者
 * - complete/fail 必须传入 attempt，防止旧 worker 推进已被重新领取的行
 */
export class DrizzleObjectDeletionOutboxRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  /**
   * 领取一批待删除行。事务内 FOR UPDATE SKIP LOCKED 保证多 worker 不重复领取；
   * attempts+1 与 status=processing 同事务写入，租约超时的 processing 行可被
   * 其他 worker 重新领取（原 worker 视为崩溃，旧 attempt 不再被接受）。
   * 按 availableAt、id 升序稳定领取已到期条目，不对失败行额外提权。
   * 这里只更新 outbox 行，不触碰对象存储。
   */
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

  /** 完成删除；attempt 必须匹配当前 processing 行的 attempt，防止旧 worker 误推进。 */
  async complete(id: string, attempt: number, now = new Date()): Promise<void> {
    await this.database
      .update(objectDeletionOutbox)
      .set({ status: 'completed', completedAt: now })
      .where(
        and(
          eq(objectDeletionOutbox.id, id),
          eq(objectDeletionOutbox.status, 'processing'),
          eq(objectDeletionOutbox.attempts, attempt),
        ),
      );
  }

  /** 标记失败；attempt 必须匹配。超过 MAX_ATTEMPTS 进入终态 failed。 */
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
          eq(objectDeletionOutbox.attempts, input.attempt),
        ),
      );
  }
}
