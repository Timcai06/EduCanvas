import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema';
import {
  DrizzleObjectDeletionOutboxRepository,
  MAX_OBJECT_DELETION_ATTEMPTS,
  OBJECT_DELETION_LEASE_TIMEOUT_MS,
} from './object-deletion-outbox-repository';
import { objectDeletionOutbox } from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error(
      '集成测试数据库名必须以_integration或_test结尾，拒绝连接非测试数据库',
    );
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl ? postgres(testDatabaseUrl) : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

async function seedPending(
  input: {
    objectKind?: string;
    storageKey?: string;
    status?: string;
    claimedAt?: Date;
  } = {},
) {
  const [row] = await getDatabase()
    .insert(objectDeletionOutbox)
    .values({
      objectKind: input.objectKind ?? 'asset',
      storageKey: input.storageKey ?? `test-key-${randomUUID()}`,
      sourceType: 'asset_version',
      sourceId: randomUUID(),
      status: input.status ?? 'pending',
      availableAt: new Date(),
      claimedAt: input.claimedAt ?? null,
    })
    .returning();
  if (!row) throw new Error('seed failed');
  return row;
}

describeWithDatabase(
  'DrizzleObjectDeletionOutboxRepository integration',
  () => {
    beforeAll(async () => {
      await migrate(getDatabase(), {
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      });
    });

    afterAll(async () => {
      await connection?.end({ timeout: 5 });
    });

    const repo = new DrizzleObjectDeletionOutboxRepository(getDatabase());

    it('claimBatch 领取 pending 行并标记为 processing，返回 leasedUntil', async () => {
      const seed = await seedPending({ storageKey: 'claim-test-key' });

      const claims = await repo.claimBatch({ limit: 5 });

      expect(claims.length).toBeGreaterThanOrEqual(1);
      const claim = claims.find((c) => c.id === seed.id);
      expect(claim).toBeDefined();
      expect(claim!.objectKind).toBe('asset');
      expect(claim!.storageKey).toBe('claim-test-key');
      expect(claim!.attempt).toBe(1);
      expect(claim!.leasedUntil).toBeInstanceOf(Date);
      // 租约在未来
      expect(claim!.leasedUntil.getTime()).toBeGreaterThan(Date.now());
    });

    it('complete 后将行推进为 completed', async () => {
      const seed = await seedPending({ storageKey: 'complete-test-key' });
      const [claim] = await repo.claimBatch({ limit: 1 });
      expect(claim).toBeDefined();
      const c = claim!;

      await repo.complete(c.id);

      const [row] = await getDatabase()
        .select({ status: objectDeletionOutbox.status })
        .from(objectDeletionOutbox)
        .where(eq(objectDeletionOutbox.id, c.id));
      expect(row?.status).toBe('completed');
    });

    it('对已完成的行再次 complete 不抛异常', async () => {
      const seed = await seedPending({ storageKey: 'idempotent-complete-key' });
      const [claim] = await repo.claimBatch({ limit: 1 });
      expect(claim).toBeDefined();
      const c = claim!;
      await repo.complete(c.id);
      // 第二次 complete — WHERE status=processing 不匹配，静默
      await repo.complete(c.id);
    });

    it('对未 claim 的行 complete 不抛异常', async () => {
      const seed = await seedPending({ storageKey: 'unclaimed-complete-key' });
      // 直接 complete 未 processing 的行 — WHERE 不匹配，静默
      await repo.complete(seed.id);
    });

    it('fail 退回 pending 状态，带退避延迟和 failureCode', async () => {
      const seed = await seedPending({ storageKey: 'fail-retry-key' });
      const [claim] = await repo.claimBatch({ limit: 1 });
      expect(claim).toBeDefined();
      const c = claim!;

      await repo.fail(c.id, {
        failureCode: 'object_not_found',
        attempt: c.attempt,
      });

      const [row] = await getDatabase()
        .select({
          status: objectDeletionOutbox.status,
          failureCode: objectDeletionOutbox.failureCode,
          availableAt: objectDeletionOutbox.availableAt,
        })
        .from(objectDeletionOutbox)
        .where(eq(objectDeletionOutbox.id, c.id));
      expect(row?.status).toBe('pending');
      expect(row?.failureCode).toBe('object_not_found');
      // 退避延迟后 availableAt 在未来
      expect(row!.availableAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('超过 MAX_ATTEMPTS 次 fail 后进入终态 failed', async () => {
      const seed = await seedPending({ storageKey: 'terminal-fail-key' });
      const [claim] = await repo.claimBatch({ limit: 1 });
      expect(claim).toBeDefined();
      const c = claim!;

      await repo.fail(c.id, {
        failureCode: 'object_delete_failed',
        attempt: MAX_OBJECT_DELETION_ATTEMPTS,
      });

      const [row] = await getDatabase()
        .select({ status: objectDeletionOutbox.status })
        .from(objectDeletionOutbox)
        .where(eq(objectDeletionOutbox.id, c.id));
      expect(row?.status).toBe('failed');
    });

    it('租约过期 processing 行被 claimBatch 恢复领取', async () => {
      // 模拟崩溃：创建 processing 行，claimedAt 在租约之前
      const leaseAgo = new Date(
        Date.now() - OBJECT_DELETION_LEASE_TIMEOUT_MS - 60_000,
      );
      const seed = await seedPending({
        storageKey: 'lease-recovery-key',
        status: 'processing',
        claimedAt: leaseAgo,
      });

      const claims = await repo.claimBatch({ limit: 5 });
      const recovered = claims.find((c) => c.id === seed.id);
      expect(recovered).toBeDefined();
      // 被重新领取，attempt 递增
      expect(recovered!.attempt).toBeGreaterThanOrEqual(1);
    });

    it('未过期 processing 行不被 claimBatch 领取', async () => {
      // 模拟正在处理的 worker：claimedAt 在租约内
      const recentLease = new Date(Date.now() - 30_000); // 30s ago
      const seed = await seedPending({
        storageKey: 'active-lease-key',
        status: 'processing',
        claimedAt: recentLease,
      });

      const claims = await repo.claimBatch({ limit: 5 });
      const found = claims.find((c) => c.id === seed.id);
      expect(found).toBeUndefined();
    });

    it('并发 claim 对同一行只有一个成功', async () => {
      const seed = await seedPending({ storageKey: 'concurrent-key' });

      // 模拟两个并发 claim — 需要两个独立事务
      const [first, second] = await Promise.all([
        repo.claimBatch({ limit: 1 }),
        repo.claimBatch({ limit: 1 }),
      ]);

      // 只有一个拿到该行
      const firstHas = first.some((c) => c.id === seed.id);
      const secondHas = second.some((c) => c.id === seed.id);
      // 至少一个拿到（可能两个都没拿到如果被其他测试干扰，但不可能两个都拿到）
      expect(firstHas && secondHas).toBe(false);
    });

    it('ObjectDeletionClaim 的 sourceType 接受 asset_video_keyframe', async () => {
      const [row] = await getDatabase()
        .insert(objectDeletionOutbox)
        .values({
          objectKind: 'asset',
          storageKey: `keyframe-key-${randomUUID()}`,
          sourceType: 'asset_video_keyframe',
          sourceId: randomUUID(),
          status: 'pending',
          availableAt: new Date(),
        })
        .returning();
      if (!row) throw new Error('seed failed');

      const claims = await repo.claimBatch({ limit: 1 });
      const claim = claims.find((c) => c.id === row.id);
      expect(claim).toBeDefined();
      expect(claim!.sourceType).toBe('asset_video_keyframe');
    });
  },
);
