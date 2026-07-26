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
 * 异步抽取来源文本（ADR-0025）。
 *
 * 幂等由仓储保证：`loadPendingExtraction` 只返回仍处于 queued/running 的任务，
 * `settleTextExtraction` 也只从这两个状态推进，所以 graphile-worker 的重投
 * 不会把已经 ready 的资产改回去，也不会重复追加文本 representation。
 *
 * 失败分两类，处理方式刻意不同：
 * - **解析失败**（扫描件、编码错误）是确定性的，重试没有意义，直接写终态 failed，
 *   用户能立刻看到原因；
 * - **读取字节失败或未知异常**可能是瞬时的（磁盘、权限、竞态），抛出去交给
 *   graphile-worker 按 max_attempts 重试，不写终态。
 */
export const extractAssetText_: Task = async (rawPayload) => {
  const payload = payloadSchema.parse(rawPayload);
  const assets = new DrizzleAssetRepository();
  const pending = await assets.loadPendingExtraction({ jobId: payload.jobId });
  /* 任务已终结（重复投递或已被人工处置）：安静退出，不当作错误。 */
  if (!pending) return;

  const storage = await getAssetStorage();
  const bytes = await storage.read(pending.storageKey);

  let extractedText: string;
  try {
    extractedText = await extractAssetText({
      bytes,
      mimeType: pending.mimeType,
    });
  } catch (error) {
    if (error instanceof AssetExtractionError) {
      await assets.settleTextExtraction({
        jobId: payload.jobId,
        outcome: { status: 'failed', failureCode: error.code },
      });
      return;
    }
    throw error;
  }

  await assets.settleTextExtraction({
    jobId: payload.jobId,
    outcome: { status: 'ready', extractedText },
  });
};

export { extractAssetText_ as extractAssetTextTask };
