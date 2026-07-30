import { DrizzleAssetDerivedProcessingRepository } from '@educanvas/db';
import {
  ASSET_PREVIEW_MAX_INPUT_BYTES,
  AssetPreviewError,
  renderAssetPreview,
  supportsPreviewRendering,
} from '@educanvas/asset-processing';
import type { Task } from 'graphile-worker';
import { z } from 'zod';
import { getAssetTaskStorage, sha256Hex } from './asset-task-storage.js';

const payloadSchema = z.object({ jobId: z.string().uuid() }).strict();

/**
 * 异步渲染资产预览（PDF/DOCX -> HTML）。
 *
 * 幂等由仓储保证：`beginPreviewRenderAttempt` 只领取 queued/running 的任务，
 * `settlePreviewRender` 也只从这两个状态推进，所以 graphile-worker 的重投
 * 不会把已经 ready 的 representation 改回去。
 *
 * 失败分两类，处理方式刻意不同：
 * - **渲染失败**（损坏文件、内容为空）是确定性的，重试没有意义，直接写终态 failed，
 *   用户能立刻看到原因；
 * - **读取字节失败或未知异常**可能是瞬时的（磁盘、权限、竞态），先抛给
 *   graphile-worker 退避重试；最后一次仍失败则写稳定的通用失败码。
 */
export const renderPreviewTask: Task = async (rawPayload, helpers) => {
  const payload = payloadSchema.parse(rawPayload);
  const assets = new DrizzleAssetDerivedProcessingRepository();
  const pending = await assets.beginPreviewRenderAttempt({
    jobId: payload.jobId,
  });
  /* 任务已终结（重复投递或已被人工处置）：安静退出，不当作错误。 */
  if (!pending) return;

  try {
    if (!supportsPreviewRendering(pending.mimeType)) {
      throw new AssetPreviewError('unsupported_media_type');
    }
    if (
      pending.byteSize <= 0 ||
      pending.byteSize > ASSET_PREVIEW_MAX_INPUT_BYTES
    ) {
      throw new AssetPreviewError('preview_input_too_large');
    }
    const storage = await getAssetTaskStorage();
    const bytes = await storage.readVerified(
      pending.storageKey,
      pending.contentHash,
    );
    if (
      bytes.byteLength !== pending.byteSize ||
      bytes.byteLength > ASSET_PREVIEW_MAX_INPUT_BYTES
    ) {
      throw new AssetPreviewError('preview_input_too_large');
    }
    const result = await renderAssetPreview({
      bytes,
      mimeType: pending.mimeType,
    });

    // 将 HTML 写入对象存储
    const htmlBytes = new TextEncoder().encode(result.html);
    const contentHash = sha256Hex(htmlBytes);
    const derivedKey = `derived/preview/${payload.jobId}/${contentHash.slice(0, 16)}.html`;

    const stored = await storage.put({
      key: derivedKey,
      bytes: htmlBytes,
      contentType: 'text/html; charset=utf-8',
    });

    const settled = await assets.settlePreviewRender({
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
    if (error instanceof AssetPreviewError) {
      await assets.settlePreviewRender({
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
      await assets.settlePreviewRender({
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
