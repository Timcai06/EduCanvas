/** V15 音频硬删除 Worker 的行为场景；共享环境与清理由 support 模块负责。 */
import { randomUUID } from 'node:crypto';
import { ObjectStorageError } from '@educanvas/agent-core';
import {
  audioRetentions,
  objectDeletionOutbox,
  platformUsers,
  type ObjectDeletionClaim,
} from '@educanvas/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  cleanup,
  database,
  ids,
  makeLogger,
  makeTask,
  objectExists,
  objectStorageRoot,
  outboxRepository,
  outboxRow,
  realDeleter,
  retentionRepository,
  seedAudioAssetVersion,
  seedConsent,
  seedOutboxRow,
  seedUser,
  storage,
  track,
  writeObject,
} from './delete-object-outbox.integration-support.js';

describe('V15 音频硬删除 Worker（真实 PostgreSQL + 隔离对象存储）', () => {
  it('D1 撤回产生 pending Outbox 与 deletion_requested 留存', async () => {
    const subject = await seedUser();
    const consent = await seedConsent(subject);
    const { versionId, storageKey } = await seedAudioAssetVersion(subject);
    await writeObject(storageKey);
    const retention = await retentionRepository.createRetention({
      consentId: consent.id,
      subjectUserId: subject,
      assetVersionId: versionId,
    });
    ids.retentions.push(retention.retentionId);

    const revoke = await retentionRepository.revokeConsent({
      consentId: consent.id,
      requesterUserId: subject,
    });
    expect(revoke.deletionIntents).toBe(1);

    const outbox = await database
      .select()
      .from(objectDeletionOutbox)
      .where(eq(objectDeletionOutbox.sourceId, versionId));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.status).toBe('pending');
    expect(outbox[0]!.objectKind).toBe('asset');
    expect(outbox[0]!.sourceType).toBe('asset_version');
    expect(outbox[0]!.storageKey).toBe(storageKey);
    ids.outbox.push(outbox[0]!.id);

    const retentionRows = await database
      .select({ status: audioRetentions.status })
      .from(audioRetentions)
      .where(eq(audioRetentions.id, retention.retentionId));
    expect(retentionRows[0]!.status).toBe('deletion_requested');
  });

  it('D2 撤回删除被 Worker 消费：对象真实删除后 Outbox 才 completed，再跑幂等', async () => {
    const subject = await seedUser();
    const consent = await seedConsent(subject);
    const { versionId, storageKey } = await seedAudioAssetVersion(subject);
    await writeObject(storageKey);
    const retention = await retentionRepository.createRetention({
      consentId: consent.id,
      subjectUserId: subject,
      assetVersionId: versionId,
    });
    ids.retentions.push(retention.retentionId);
    await retentionRepository.revokeConsent({
      consentId: consent.id,
      requesterUserId: subject,
    });
    const [outbox] = await database
      .select({ id: objectDeletionOutbox.id })
      .from(objectDeletionOutbox)
      .where(eq(objectDeletionOutbox.sourceId, versionId));
    ids.outbox.push(outbox!.id);

    const { lines, logger } = makeLogger();
    const task = makeTask(outboxRepository, realDeleter);
    await task({ limit: 20 }, { logger } as never);

    // 对象必须真实不存在，且 Outbox 只有在删除完成后才 completed
    expect(await objectExists(storageKey)).toBe(false);
    const after = await outboxRow(outbox!.id);
    expect(after?.status).toBe('completed');
    expect(after?.completedAt).not.toBeNull();

    // 幂等：再次执行不报错、不新增行
    await task({ limit: 20 }, { logger } as never);
    const again = await outboxRow(outbox!.id);
    expect(again?.status).toBe('completed');
    const all = await database
      .select()
      .from(objectDeletionOutbox)
      .where(eq(objectDeletionOutbox.sourceId, versionId));
    expect(all).toHaveLength(1);
  });

  it('E1 到期扫描产生删除意图，Worker 删除后 completed，二次扫描幂等', async () => {
    const subject = await seedUser();
    const consent = await seedConsent(subject);
    const { versionId, storageKey } = await seedAudioAssetVersion(subject);
    await writeObject(storageKey);
    // expiresAt 是数据库不可变字段，Repository 也拒绝过去时间：真实到期场景
    // 只能直接构造已到期行（INSERT 触发器仍校验 consent 有效且不晚于 createdAt）。
    const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1_000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const retention = track(
      ids.retentions,
      await database
        .insert(audioRetentions)
        .values({
          subjectUserId: subject,
          consentId: consent.id,
          consentPurpose: 'audio_retention',
          assetVersionId: versionId,
          createdAt,
          expiresAt: expiredAt,
        })
        .returning()
        .then((rows) => rows[0]!),
    );

    const scan = await retentionRepository.scanExpiredRetentions({ limit: 10 });
    expect(scan.deletionIntents).toBe(1);

    const [outbox] = await database
      .select({ id: objectDeletionOutbox.id })
      .from(objectDeletionOutbox)
      .where(eq(objectDeletionOutbox.sourceId, versionId));
    expect(outbox).toBeDefined();
    ids.outbox.push(outbox!.id);
    const retentionRows = await database
      .select({ status: audioRetentions.status })
      .from(audioRetentions)
      .where(eq(audioRetentions.id, retention.id));
    expect(retentionRows[0]!.status).toBe('deletion_requested');

    await makeTask(outboxRepository, realDeleter)({ limit: 20 }, {
      logger: { info: () => undefined, error: () => undefined },
    } as never);

    expect(await objectExists(storageKey)).toBe(false);
    const after = await outboxRow(outbox!.id);
    expect(after?.status).toBe('completed');

    // 第二次扫描/执行不重复删除或创建意图
    const scanAgain = await retentionRepository.scanExpiredRetentions({
      limit: 10,
    });
    expect(scanAgain.scanned).toBe(0);
    const all = await database
      .select()
      .from(objectDeletionOutbox)
      .where(eq(objectDeletionOutbox.sourceId, versionId));
    expect(all).toHaveLength(1);
  });

  it('F3 对象已不存在时删除视为幂等成功并 completed', async () => {
    const missingKey = `audio-missing-${randomUUID()}`;
    const row = await seedOutboxRow({ storageKey: missingKey });
    expect(await objectExists(missingKey)).toBe(false);

    await makeTask()({ limit: 20 }, {
      logger: { info: () => undefined, error: () => undefined },
    } as never);

    const after = await outboxRow(row.id);
    expect(after?.status).toBe('completed');
  });

  it('F4 对象存储临时失败退回 pending 并退避，到期后可重试成功', async () => {
    const subject = await seedUser();
    const { storageKey } = await seedAudioAssetVersion(subject);
    await writeObject(storageKey);
    const row = await seedOutboxRow({ storageKey });

    // 第一次删除抛稳定 ObjectStorageError（模拟存储瞬时故障）
    let failNext = true;
    const flakyDeleter = {
      delete: async (claim: ObjectDeletionClaim) => {
        if (failNext) {
          failNext = false;
          throw new ObjectStorageError('storage_unavailable', 'temporary');
        }
        await storage.delete(claim.storageKey);
      },
    };
    const { lines, logger } = makeLogger();
    await makeTask(outboxRepository, flakyDeleter)({ limit: 20 }, {
      logger,
    } as never);

    const failed = await outboxRow(row.id);
    expect(failed?.status).toBe('pending');
    expect(failed?.failureCode).toBe('storage_unavailable');
    expect(failed?.availableAt!.getTime()).toBeGreaterThan(Date.now());
    // 日志只含稳定失败码，不泄漏 storageKey
    expect(lines.join('\n')).not.toContain(storageKey);

    // availableAt 到期后可重新领取并成功
    await database
      .update(objectDeletionOutbox)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(objectDeletionOutbox.id, row.id));
    await makeTask(outboxRepository, flakyDeleter)({ limit: 20 }, {
      logger,
    } as never);

    expect(await objectExists(storageKey)).toBe(false);
    const done = await outboxRow(row.id);
    expect(done?.status).toBe('completed');
  });

  it('F11 删除成功但 complete 写入失败：不伪造 completed，恢复后可完成', async () => {
    const subject = await seedUser();
    const { storageKey } = await seedAudioAssetVersion(subject);
    await writeObject(storageKey);
    const row = await seedOutboxRow({ storageKey });

    let failComplete = true;
    const flakyRepository = {
      claimBatch: (input: { limit: number }) =>
        outboxRepository.claimBatch(input),
      complete: async (id: string, attempt: number) => {
        if (failComplete) {
          failComplete = false;
          throw new Error('db unavailable');
        }
        await outboxRepository.complete(id, attempt);
      },
      fail: (id: string, input: { failureCode: string; attempt: number }) =>
        outboxRepository.fail(id, input),
    };
    await makeTask(flakyRepository, realDeleter)({ limit: 20 }, {
      logger: { info: () => undefined, error: () => undefined },
    } as never);

    // 对象已被删除，但 Outbox 绝不能伪装 completed
    expect(await objectExists(storageKey)).toBe(false);
    const after = await outboxRow(row.id);
    expect(after?.status).not.toBe('completed');
    // 走 fail 分支退回 pending，带稳定失败码，可查询可恢复
    expect(after?.status).toBe('pending');
    expect(after?.failureCode).toBe('object_delete_failed');

    await database
      .update(objectDeletionOutbox)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(objectDeletionOutbox.id, row.id));
    await makeTask(flakyRepository, realDeleter)({ limit: 20 }, {
      logger: { info: () => undefined, error: () => undefined },
    } as never);

    const done = await outboxRow(row.id);
    expect(done?.status).toBe('completed');
  });

  it('F12 删除失败且 fail 写入失败：保留可恢复状态并记录稳定日志', async () => {
    const subject = await seedUser();
    const { storageKey } = await seedAudioAssetVersion(subject);
    await writeObject(storageKey);
    const row = await seedOutboxRow({ storageKey });

    const failingDeleter = {
      delete: async () => {
        throw new ObjectStorageError('storage_unavailable', 'temporary');
      },
    };
    const failingRepository = {
      claimBatch: (input: { limit: number }) =>
        outboxRepository.claimBatch(input),
      complete: (id: string, attempt: number) =>
        outboxRepository.complete(id, attempt),
      fail: async () => {
        throw new Error('db unavailable');
      },
    };
    const { lines, logger } = makeLogger();
    await makeTask(failingRepository, failingDeleter)({ limit: 20 }, {
      logger,
    } as never);

    // fail 未生效：行仍 processing（未伪装成功，也未丢失 claim）
    const stuck = await outboxRow(row.id);
    expect(stuck?.status).toBe('processing');
    expect(lines.join('\n')).toContain(
      `object_delete_fail_record_failed claim=${row.id} kind=asset`,
    );
    expect(lines.join('\n')).not.toContain(storageKey);
    expect(lines.join('\n')).not.toContain('temporary');

    // 租约过期后恢复：重新领取并成功删除
    await database
      .update(objectDeletionOutbox)
      .set({ claimedAt: new Date(Date.now() - 2 * 60 * 60 * 1_000) })
      .where(eq(objectDeletionOutbox.id, row.id));
    await makeTask(outboxRepository, realDeleter)({ limit: 20 }, {
      logger,
    } as never);

    expect(await objectExists(storageKey)).toBe(false);
    const done = await outboxRow(row.id);
    expect(done?.status).toBe('completed');
    expect(done?.attempts).toBeGreaterThan(1);
  });

  it('F13 第 10 次失败进入 failed 终态且不再领取', async () => {
    const subject = await seedUser();
    const { storageKey } = await seedAudioAssetVersion(subject);
    await writeObject(storageKey);
    const row = await seedOutboxRow({ storageKey, attempts: 9 });

    const failingDeleter = {
      delete: async () => {
        throw new ObjectStorageError('storage_unavailable', 'temporary');
      },
    };
    await makeTask(outboxRepository, failingDeleter)({ limit: 20 }, {
      logger: { info: () => undefined, error: () => undefined },
    } as never);

    const failed = await outboxRow(row.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.failureCode).toBe('storage_unavailable');

    // failed 终态不再被领取
    const claims = await outboxRepository.claimBatch({ limit: 20 });
    expect(claims.find((c) => c.id === row.id)).toBeUndefined();
    // 对象保留（删除从未成功）
    expect(await objectExists(storageKey)).toBe(true);
  });

  it('F16 两个 Worker 并发处理同一 Outbox 恰好一个完成删除', async () => {
    const subject = await seedUser();
    const { storageKey } = await seedAudioAssetVersion(subject);
    await writeObject(storageKey);
    const row = await seedOutboxRow({ storageKey });

    const task = makeTask(outboxRepository, realDeleter);
    await Promise.all([
      task({ limit: 20 }, {
        logger: { info: () => undefined, error: () => undefined },
      } as never),
      task({ limit: 20 }, {
        logger: { info: () => undefined, error: () => undefined },
      } as never),
    ]);

    expect(await objectExists(storageKey)).toBe(false);
    const done = await outboxRow(row.id);
    expect(done?.status).toBe('completed');
    expect(done?.attempts).toBe(1);
  });

  it('F18 Worker 领取后崩溃（租约过期）可恢复继续删除，attempt 递增', async () => {
    const subject = await seedUser();
    const { storageKey } = await seedAudioAssetVersion(subject);
    await writeObject(storageKey);
    const row = await seedOutboxRow({ storageKey });

    // 模拟 worker 领取后崩溃：claim 拿到但从不 complete
    const claims = await outboxRepository.claimBatch({ limit: 20 });
    const claim = claims.find((c) => c.id === row.id);
    expect(claim).toBeDefined();
    const stuck = await outboxRow(row.id);
    expect(stuck?.status).toBe('processing');
    expect(stuck?.attempts).toBe(1);

    // 租约过期后新 worker 恢复执行
    await database
      .update(objectDeletionOutbox)
      .set({ claimedAt: new Date(Date.now() - 2 * 60 * 60 * 1_000) })
      .where(eq(objectDeletionOutbox.id, row.id));
    await makeTask()({ limit: 20 }, {
      logger: { info: () => undefined, error: () => undefined },
    } as never);

    expect(await objectExists(storageKey)).toBe(false);
    const done = await outboxRow(row.id);
    expect(done?.status).toBe('completed');
    expect(done?.attempts).toBe(2);
  });

  it('F17 一条失败不阻断同批另一条成功', async () => {
    const subject = await seedUser();
    const { storageKey } = await seedAudioAssetVersion(subject);
    await writeObject(storageKey);
    const good = await seedOutboxRow({ storageKey });
    const bad = await seedOutboxRow({
      storageKey: `audio-bad-${randomUUID()}`,
    });

    const mixedDeleter = {
      delete: async (claim: ObjectDeletionClaim) => {
        if (claim.id === bad.id) {
          throw new ObjectStorageError('storage_unavailable', 'temporary');
        }
        await storage.delete(claim.storageKey);
      },
    };
    await makeTask(outboxRepository, mixedDeleter)({ limit: 20 }, {
      logger: { info: () => undefined, error: () => undefined },
    } as never);

    const goodAfter = await outboxRow(good.id);
    const badAfter = await outboxRow(bad.id);
    expect(goodAfter?.status).toBe('completed');
    expect(badAfter?.status).toBe('pending');
    expect(badAfter?.failureCode).toBe('storage_unavailable');
    expect(await objectExists(storageKey)).toBe(false);
  });

  it('F19 全链路日志不泄漏 storageKey、宿主路径、堆栈', async () => {
    const subject = await seedUser();
    const consent = await seedConsent(subject);
    const { versionId, storageKey } = await seedAudioAssetVersion(subject);
    await writeObject(storageKey);
    const retention = await retentionRepository.createRetention({
      consentId: consent.id,
      subjectUserId: subject,
      assetVersionId: versionId,
    });
    ids.retentions.push(retention.retentionId);
    await retentionRepository.revokeConsent({
      consentId: consent.id,
      requesterUserId: subject,
    });
    const [outbox] = await database
      .select({ id: objectDeletionOutbox.id })
      .from(objectDeletionOutbox)
      .where(eq(objectDeletionOutbox.sourceId, versionId));
    ids.outbox.push(outbox!.id);

    const { lines, logger } = makeLogger();
    const task = makeTask();
    await task({ limit: 20 }, { logger } as never);
    await task({ limit: 20 }, { logger } as never);

    const allLogs = lines.join('\n');
    expect(allLogs).not.toContain(storageKey);
    expect(allLogs).not.toContain(objectStorageRoot);
    expect(allLogs).not.toContain('at ');
    expect(allLogs).not.toContain('Error:');
    // 成功路径只输出批次计数，不出现 claimId 之外的自由内容
    expect(allLogs).toContain('claimed=');
    expect(allLogs).toContain('completed=');
  });

  it('F20 测试清理完备：结束后无本文件创建的 Outbox/留存/版本残留', async () => {
    const subject = await seedUser();
    const consent = await seedConsent(subject);
    const { versionId } = await seedAudioAssetVersion(subject);
    const retention = await retentionRepository.createRetention({
      consentId: consent.id,
      subjectUserId: subject,
      assetVersionId: versionId,
    });
    ids.retentions.push(retention.retentionId);
    await retentionRepository.revokeConsent({
      consentId: consent.id,
      requesterUserId: subject,
    });

    await cleanup();
    // 共享集成库可能被其他测试写入：只断言本文件创建的实体全部清理干净
    const mine = await database
      .select({ id: objectDeletionOutbox.id })
      .from(objectDeletionOutbox)
      .where(eq(objectDeletionOutbox.sourceId, versionId));
    expect(mine).toHaveLength(0);
    const userRows = await database
      .select({ id: platformUsers.id })
      .from(platformUsers)
      .where(eq(platformUsers.id, subject));
    expect(userRows).toHaveLength(0);
  });
});
