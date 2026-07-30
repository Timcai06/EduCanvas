import { DrizzleAssetDerivedProcessingRepository } from '@educanvas/db';
import {
  ASSET_THUMBNAIL_MAX_INPUT_BYTES,
  AssetThumbnailError,
  generateThumbnail,
  supportsThumbnailGeneration,
} from '@educanvas/asset-processing';
import type { Task } from 'graphile-worker';
import { z } from 'zod';
import { getAssetTaskStorage, sha256Hex } from './asset-task-storage.js';

const payloadSchema = z.object({ jobId: z.string().uuid() }).strict();

/**
 * 异步生成资产缩略图（图片 -> JPEG 缩略图）。
 *
 * 幂等由仓储保证：`beginThumbnailGenerationAttempt` 只领取 queued/running 的任务，
 * `settleThumbnailGeneration` 也只从这两个状态推进，所以 graphile-worker 的重投
 * 不会把已经 ready 的 representation 改回去。
 *
 * 失败分两类，处理方式刻意不同：
 * - **处理失败**（损坏文件、格式不支持）是确定性的，重试没有意义，直接写终态 failed，
 *   用户能立刻看到原因；
 * - **读取字节失败或未知异常**可能是瞬时的（磁盘、权限、竞态），先抛给
 *   graphile-worker 退避重试；最后一次仍失败则写稳定的通用失败码。
 */
export const generateThumbnailTask: Task = async (rawPayload, helpers) => {
  const payload = payloadSchema.parse(rawPayload);
  const assets = new DrizzleAssetDerivedProcessingRepository();
  const pending = await assets.beginThumbnailGenerationAttempt({
    jobId: payload.jobId,
  });
  /* 任务已终结（重复投递或已被人工处置）：安静退出，不当作错误。 */
  if (!pending) return;

  try {
    if (!supportsThumbnailGeneration(pending.mimeType)) {
      throw new AssetThumbnailError('unsupported_media_type');
    }
    if (
      pending.byteSize <= 0 ||
      pending.byteSize > ASSET_THUMBNAIL_MAX_INPUT_BYTES
    ) {
      throw new AssetThumbnailError('thumbnail_input_too_large');
    }
    const storage = await getAssetTaskStorage();
    const bytes = await storage.readVerified(
      pending.storageKey,
      pending.contentHash,
    );
    if (
      bytes.byteLength !== pending.byteSize ||
      bytes.byteLength > ASSET_THUMBNAIL_MAX_INPUT_BYTES
    ) {
      throw new AssetThumbnailError('thumbnail_input_too_large');
    }
    const result = await generateThumbnail({
      bytes,
      mimeType: pending.mimeType,
    });

    // 将缩略图写入对象存储
    const contentHash = sha256Hex(result.bytes);
    const derivedKey = `derived/thumbnail/${payload.jobId}/${contentHash.slice(0, 16)}.jpg`;

    const stored = await storage.put({
      key: derivedKey,
      bytes: result.bytes,
      contentType: 'image/jpeg',
    });

    const settled = await assets.settleThumbnailGeneration({
      jobId: payload.jobId,
      outcome: {
        status: 'ready',
        derivedStorageKey: stored.key,
        checksum: stored.checksum,
        byteSize: stored.sizeBytes,
      },
    });
    if (!settled) await storage.delete(stored.key);
  } catch (error) {
    if (error instanceof AssetThumbnailError) {
      await assets.settleThumbnailGeneration({
        jobId: payload.jobId,
        outcome: { status: 'failed', failureCode: error.code },
      });
      return;
    }
    /*
     * Graphile 在领取任务时已把 helpers.job.attempts 加一。最后一次仍失败时，
     * 不能只让队列永久失败而把业务账本留在 running；只落稳定失败码，不保存
     * 原始异常、路径或堆栈。较早的尝试继续抛出，由 Graphile 按策略退避重试。
     */
    if (helpers.job.attempts >= helpers.job.max_attempts) {
      await assets.settleThumbnailGeneration({
        jobId: payload.jobId,
        outcome: {
          status: 'failed',
          failureCode: 'asset_processing_exhausted',
        },
      });
      return;
    }
    throw error;
  }
};
