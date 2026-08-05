/**
 * 音频留存生命周期事务逻辑（ADR-0022 §3、V14-F/V14-G）。
 *
 * 单一职责：把"为一批 retention 在同一事务内登记删除意图"的共享步骤
 * （读 assetVersion 的 storageKey → 写 objectDeletionOutbox → retention 转
 * deletion_requested）从 Repository 中抽出，供撤回与到期扫描复用。
 * storageKey 只在本模块事务内部流转，永不进入公共 DTO。
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { assetVersions, objectDeletionOutbox } from './schema';
import { audioRetentions } from './schema/audio-consent';
import type { RetentionRow } from './audio-retention-access';
import { AudioRetentionPersistenceError } from './audio-retention-types';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

/**
 * 为每个 active retention 登记物理删除意图：
 * 1. 读对应 assetVersion 的服务端 storageKey（仅事务内部）；
 * 2. 写 objectDeletionOutbox（objectKind=asset, sourceType=asset_version,
 *    sourceId=assetVersionId）；同一 storageKey 已有意图时幂等跳过；
 * 3. retention 转 deletion_requested 并写 deletionRequestedAt。
 * 返回实际新增删除意图数。任何一步失败都由调用方事务整体回滚。
 */
export async function enqueueDeletionIntents(
  transaction: DatabaseTransaction,
  retentions: readonly RetentionRow[],
  now: Date,
): Promise<number> {
  let deletionIntents = 0;
  for (const retention of retentions) {
    const [version] = await transaction
      .select({ storageKey: assetVersions.storageKey })
      .from(assetVersions)
      .where(eq(assetVersions.id, retention.assetVersionId))
      .limit(1);
    // FK 正常情况下保证版本存在；若数据库处于不一致状态，必须让整个
    // 撤回/到期事务回滚，不能静默提交“已撤回但没有删除意图”的半状态。
    if (!version) throw new AudioRetentionPersistenceError();
    await transaction
      .insert(objectDeletionOutbox)
      .values({
        objectKind: 'asset',
        storageKey: version.storageKey,
        sourceType: 'asset_version',
        sourceId: retention.assetVersionId,
        availableAt: now,
      })
      .onConflictDoNothing();
    const [updated] = await transaction
      .update(audioRetentions)
      .set({ status: 'deletion_requested', deletionRequestedAt: now })
      .where(
        and(
          eq(audioRetentions.id, retention.id),
          eq(audioRetentions.status, 'active'),
        ),
      )
      .returning({ id: audioRetentions.id });
    if (updated) deletionIntents += 1;
  }
  return deletionIntents;
}
