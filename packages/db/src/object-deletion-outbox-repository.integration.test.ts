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
    attempts?: number;
    availableAt?: Date;
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
      attempts: input.attempts ?? 0,
      availableAt: input.availableAt ?? new Date(),
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

    async function claimSeed(
      seedId: string,
      input: { now?: Date; leaseTimeoutMs?: number } = {},
    ) {
      const claims = await repo.claimBatch({ limit: 200, ...input });
      const claim = claims.find((candidate) => candidate.id === seedId);
      expect(claim).toBeDefined();
      return claim!;
    }

    it('claimBatch 领取 pending 行返回 attempt', async () => {
      const seed = await seedPending({ storageKey: 'claim-test' });

      const claims = await repo.claimBatch({ limit: 5 });
      const claim = claims.find((c) => c.id === seed.id);
      expect(claim).toBeDefined();
      expect(claim!.attempt).toBe(1);
      expect(claim!.storageKey).toBe('claim-test');
    });

    it('complete 传入匹配 attempt 推进为 completed', async () => {
      const seed = await seedPending();
      const c = await claimSeed(seed.id);

      await repo.complete(c.id, c.attempt);

      const [row] = await getDatabase()
        .select({ status: objectDeletionOutbox.status })
        .from(objectDeletionOutbox)
        .where(eq(objectDeletionOutbox.id, c.id));
      expect(row?.status).toBe('completed');
    });

    it('complete 传入错误 attempt 不推进（防旧 worker 重入）', async () => {
      const seed = await seedPending();
      const c = await claimSeed(seed.id);

      // 用错误的 attempt 调用 complete
      await repo.complete(c.id, c.attempt + 99);

      const [row] = await getDatabase()
        .select({ status: objectDeletionOutbox.status })
        .from(objectDeletionOutbox)
        .where(eq(objectDeletionOutbox.id, c.id));
      // 状态不变，仍是 processing
      expect(row?.status).toBe('processing');
    });

    it('重复 complete 不抛异常', async () => {
      const seed = await seedPending();
      const c = await claimSeed(seed.id);
      await repo.complete(c.id, c.attempt);
      await repo.complete(c.id, c.attempt);
    });

    it('fail 传入匹配 attempt 退回 pending', async () => {
      const seed = await seedPending();
      const c = await claimSeed(seed.id);

      await repo.fail(c.id, {
        failureCode: 'object_not_found',
        attempt: c.attempt,
      });

      const [row] = await getDatabase()
        .select({
          status: objectDeletionOutbox.status,
          failureCode: objectDeletionOutbox.failureCode,
        })
        .from(objectDeletionOutbox)
        .where(eq(objectDeletionOutbox.id, c.id));
      expect(row?.status).toBe('pending');
      expect(row?.failureCode).toBe('object_not_found');
    });

    it('fail 传入错误 attempt 不推进', async () => {
      const seed = await seedPending();
      const c = await claimSeed(seed.id);

      await repo.fail(c.id, {
        failureCode: 'test',
        attempt: c.attempt + 99,
      });

      const [row] = await getDatabase()
        .select({ status: objectDeletionOutbox.status })
        .from(objectDeletionOutbox)
        .where(eq(objectDeletionOutbox.id, c.id));
      expect(row?.status).toBe('processing');
    });

    it('超过 MAX_ATTEMPTS 次 fail 后进入终态 failed', async () => {
      const seed = await seedPending({
        attempts: MAX_OBJECT_DELETION_ATTEMPTS - 1,
      });
      const c = await claimSeed(seed.id);
      expect(c.attempt).toBe(MAX_OBJECT_DELETION_ATTEMPTS);

      await repo.fail(c.id, {
        failureCode: 'object_delete_failed',
        attempt: c.attempt,
      });

      const [row] = await getDatabase()
        .select({ status: objectDeletionOutbox.status })
        .from(objectDeletionOutbox)
        .where(eq(objectDeletionOutbox.id, c.id));
      expect(row?.status).toBe('failed');
    });

    it('租约过期 processing 行被 claimBatch 恢复领取，attempt 递增', async () => {
      const leaseAgo = new Date(
        Date.now() - OBJECT_DELETION_LEASE_TIMEOUT_MS - 60_000,
      );
      const seed = await seedPending({
        storageKey: 'lease-recovery',
        status: 'processing',
        claimedAt: leaseAgo,
        attempts: 3,
      });

      const claims = await repo.claimBatch({ limit: 5 });
      const recovered = claims.find((c) => c.id === seed.id);
      expect(recovered).toBeDefined();
      // 旧 worker 的 attempt 3 已无效，新 claim 的 attempt 为 4
      expect(recovered!.attempt).toBe(4);
      // 旧 worker 用 attempt 3 调用 complete/fail 会被拒绝
    });

    it('attempts 已达 schema 上限的过期行收敛为 failed，不阻塞同批领取', async () => {
      const expired = new Date(
        Date.now() - OBJECT_DELETION_LEASE_TIMEOUT_MS - 60_000,
      );
      const poisoned = await seedPending({
        storageKey: `attempt-ceiling-${randomUUID()}`,
        status: 'processing',
        claimedAt: expired,
        attempts: 100,
      });
      const healthy = await seedPending({
        storageKey: `attempt-healthy-${randomUUID()}`,
      });

      const claims = await repo.claimBatch({ limit: 200 });
      expect(claims.some((claim) => claim.id === healthy.id)).toBe(true);
      expect(claims.some((claim) => claim.id === poisoned.id)).toBe(false);

      const [terminal] = await getDatabase()
        .select({
          status: objectDeletionOutbox.status,
          attempts: objectDeletionOutbox.attempts,
          failureCode: objectDeletionOutbox.failureCode,
        })
        .from(objectDeletionOutbox)
        .where(eq(objectDeletionOutbox.id, poisoned.id));
      expect(terminal).toEqual({
        status: 'failed',
        attempts: 100,
        failureCode: 'object_delete_attempts_exhausted',
      });
    });

    it('未过期 processing 行不被 claimBatch 领取', async () => {
      const recentLease = new Date(Date.now() - 30_000);
      const seed = await seedPending({
        status: 'processing',
        claimedAt: recentLease,
      });

      const claims = await repo.claimBatch({ limit: 5 });
      const found = claims.find((c) => c.id === seed.id);
      expect(found).toBeUndefined();
    });

    it('并发 claim 互斥 — 恰好一个 worker 领取（XOR）', async () => {
      // 清空已有 pending 行，隔离测试
      const seed = await seedPending({ storageKey: 'concurrent-xor' });

      const [first, second] = await Promise.all([
        repo.claimBatch({ limit: 5 }),
        repo.claimBatch({ limit: 5 }),
      ]);

      const firstHas = first.some((c) => c.id === seed.id);
      const secondHas = second.some((c) => c.id === seed.id);

      // XOR: 恰好一个拿到
      expect(firstHas !== secondHas).toBe(true);
    });

    it('ObjectDeletionClaim 的 sourceType 接受 asset_video_keyframe', async () => {
      const [row] = await getDatabase()
        .insert(objectDeletionOutbox)
        .values({
          objectKind: 'asset',
          storageKey: `keyframe-${randomUUID()}`,
          sourceType: 'asset_video_keyframe',
          sourceId: randomUUID(),
          status: 'pending',
          availableAt: new Date(),
        })
        .returning();
      if (!row) throw new Error('seed failed');

      const claims = await repo.claimBatch({ limit: 5 });
      const claim = claims.find((c) => c.id === row.id);
      expect(claim).toBeDefined();
      expect(claim!.sourceType).toBe('asset_video_keyframe');
    });

    it('availableAt 未到期的 pending 行不能被领取（F-5）', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1_000);
      const seed = await seedPending({
        storageKey: 'available-future',
        availableAt: future,
      });

      const claims = await repo.claimBatch({ limit: 5 });
      const found = claims.find((c) => c.id === seed.id);
      expect(found).toBeUndefined();

      const [row] = await getDatabase()
        .select({
          status: objectDeletionOutbox.status,
          attempts: objectDeletionOutbox.attempts,
        })
        .from(objectDeletionOutbox)
        .where(eq(objectDeletionOutbox.id, seed.id));
      // 未被改动，仍是 pending 且 attempt 未递增
      expect(row?.status).toBe('pending');
      expect(row?.attempts).toBe(0);
    });

    it('availableAt 到期后 pending 行可被领取（F-6）', async () => {
      const seed = await seedPending({
        storageKey: 'available-expire',
        availableAt: new Date(Date.now() + 60 * 60 * 1_000),
      });
      await getDatabase()
        .update(objectDeletionOutbox)
        .set({ availableAt: new Date(Date.now() - 1_000) })
        .where(eq(objectDeletionOutbox.id, seed.id));

      const claims = await repo.claimBatch({ limit: 5 });
      const claim = claims.find((c) => c.id === seed.id);
      expect(claim).toBeDefined();
      expect(claim!.attempt).toBe(1);
    });

    it('failed 终态行不再被领取（F-14）', async () => {
      // lifecycle check 要求 failed 行 failureCode 非空且 claimedAt/completedAt 为空，
      // 因此先以 pending 插入再整体更新为合法 failed 终态。
      const seed = await seedPending({ storageKey: 'terminal-failed' });
      await getDatabase()
        .update(objectDeletionOutbox)
        .set({
          status: 'failed',
          failureCode: 'object_delete_failed',
          claimedAt: null,
          completedAt: null,
        })
        .where(eq(objectDeletionOutbox.id, seed.id));

      const claims = await repo.claimBatch({ limit: 5 });
      const found = claims.find((c) => c.id === seed.id);
      expect(found).toBeUndefined();
    });

    it('completed 终态行不再被领取（F-15）', async () => {
      const seed = await seedPending({ storageKey: 'terminal-completed' });
      await getDatabase()
        .update(objectDeletionOutbox)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(objectDeletionOutbox.id, seed.id));

      const claims = await repo.claimBatch({ limit: 5 });
      const found = claims.find((c) => c.id === seed.id);
      expect(found).toBeUndefined();
    });
  },
);
