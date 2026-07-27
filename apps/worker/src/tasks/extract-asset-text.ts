import { access } from 'node:fs/promises';
import path from 'node:path';
import { DrizzleAssetRepository } from '@educanvas/db';
import {
  AssetExtractionError,
  extractAssetText,
} from '@educanvas/asset-processing';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import type { Task } from 'graphile-worker';
import { z } from 'zod';

const payloadSchema = z.object({ jobId: z.string().uuid() }).strict();

async function findWorkspaceRoot(): Promise<string> {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      await access(path.join(current, 'pnpm-workspace.yaml'));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error('workspace_root_not_found');
}

/* 与 delete-object-outbox 使用同一套根解析：资产对象与 Artifact 对象存在不同根下，
   用错根会静默读不到文件并被当成解析失败。 */
let assetStorage: Promise<LocalObjectStorage> | null = null;
function getAssetStorage(): Promise<LocalObjectStorage> {
  assetStorage ??= (async () => {
    const root = process.env.ASSET_STORAGE_ROOT
      ? path.resolve(process.env.ASSET_STORAGE_ROOT)
      : path.join(await findWorkspaceRoot(), 'uploads');
    return new LocalObjectStorage(root);
  })();
  return assetStorage;
}

/**
 * 异步抽取来源文本（ADR-0010）。
 *
 * 幂等由仓储保证：`beginTextExtractionAttempt` 只领取 queued/running 的任务，
 * `settleTextExtraction` 也只从这两个状态推进，所以 graphile-worker 的重投
 * 不会把已经 ready 的资产改回去，也不会重复追加文本 representation。
 *
 * 失败分两类，处理方式刻意不同：
 * - **解析失败**（扫描件、编码错误）是确定性的，重试没有意义，直接写终态 failed，
 *   用户能立刻看到原因；
 * - **读取字节失败或未知异常**可能是瞬时的（磁盘、权限、竞态），先抛给
 *   graphile-worker 退避重试；最后一次仍失败则写稳定的通用失败码。
 */
export const extractAssetText_: Task = async (rawPayload, helpers) => {
  const payload = payloadSchema.parse(rawPayload);
  const assets = new DrizzleAssetRepository();
  const pending = await assets.beginTextExtractionAttempt({
    jobId: payload.jobId,
  });
  /* 任务已终结（重复投递或已被人工处置）：安静退出，不当作错误。 */
  if (!pending) return;

  try {
    const storage = await getAssetStorage();
    const bytes = await storage.read(pending.storageKey);
    const extractedText = await extractAssetText({
      bytes,
      mimeType: pending.mimeType,
    });
    await assets.settleTextExtraction({
      jobId: payload.jobId,
      outcome: { status: 'ready', extractedText },
    });
  } catch (error) {
    if (error instanceof AssetExtractionError) {
      await assets.settleTextExtraction({
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
      await assets.settleTextExtraction({
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

export { extractAssetText_ as extractAssetTextTask };
