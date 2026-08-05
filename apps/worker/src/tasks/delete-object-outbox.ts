import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  DrizzleObjectDeletionOutboxRepository,
  type ObjectDeletionClaim,
} from '@educanvas/db';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import { ObjectStorageError } from '@educanvas/agent-core';
import type { Task } from 'graphile-worker';
import { z } from 'zod';

const payloadSchema = z
  .object({
    limit: z.number().int().min(1).max(200).default(50),
    _cron: z
      .object({
        ts: z.string().min(1),
        backfilled: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

interface OutboxRepository {
  claimBatch(input: { limit: number }): Promise<readonly ObjectDeletionClaim[]>;
  complete(id: string, attempt: number): Promise<void>;
  fail(
    id: string,
    input: { failureCode: string; attempt: number },
  ): Promise<void>;
}

interface ObjectDeleter {
  delete(claim: ObjectDeletionClaim): Promise<void>;
}

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

class LocalDeletionAdapter implements ObjectDeleter {
  private assetStorage: Promise<LocalObjectStorage> | null = null;
  private artifactStorage: Promise<LocalObjectStorage> | null = null;

  private getAssetStorage(): Promise<LocalObjectStorage> {
    this.assetStorage ??= (async () => {
      const root = process.env.ASSET_STORAGE_ROOT
        ? path.resolve(process.env.ASSET_STORAGE_ROOT)
        : path.join(await findWorkspaceRoot(), 'uploads');
      return new LocalObjectStorage(root);
    })();
    return this.assetStorage;
  }

  private getArtifactStorage(): Promise<LocalObjectStorage> {
    this.artifactStorage ??= (async () => {
      const root = process.env.OBJECT_STORAGE_ROOT
        ? path.resolve(process.env.OBJECT_STORAGE_ROOT)
        : path.join(await findWorkspaceRoot(), 'uploads', 'artifacts');
      return new LocalObjectStorage(root);
    })();
    return this.artifactStorage;
  }

  async delete(claim: ObjectDeletionClaim): Promise<void> {
    if (claim.objectKind === 'asset' || claim.objectKind === 'avatar') {
      await (await this.getAssetStorage()).delete(claim.storageKey);
    } else if (claim.objectKind === 'artifact') {
      await (await this.getArtifactStorage()).delete(claim.storageKey);
    } else {
      throw new ObjectStorageError(
        'invalid_key',
        '当前删除适配器不支持此对象类型',
      );
    }
  }
}

/**
 * 后台删除 cron 任务（graphile-worker 周期性调用）。消费 objectDeletionOutbox：
 * - 幂等：claimBatch 单写者领取 + complete/fail 必须携带匹配 attempt；对象已不存在
 *   （object_not_found）视为删除目标已达成，直接 complete；
 * - 失败写入 fail 并按 attempt 指数退避重试，超过 MAX_OBJECT_DELETION_ATTEMPTS
 *   进入终态 failed，仅记录 failureCode，不抛给调度器造成队列堆积；
 * - 删除失败不回滚已归档产物：归档是用户可见的业务事实（数据已“删除”），
 *   物理对象清理只是资源回收，重试即可；恢复产物会让已删除数据重新出现，
 *   违背删除承诺。
 */
export function createDeleteObjectOutboxTask(
  repository: OutboxRepository = new DrizzleObjectDeletionOutboxRepository(),
  deleter: ObjectDeleter = new LocalDeletionAdapter(),
): Task {
  return async (payload, helpers) => {
    const { limit } = payloadSchema.parse(payload);
    const claims = await repository.claimBatch({ limit });
    let completed = 0;
    let failed = 0;
    for (const claim of claims) {
      try {
        await deleter.delete(claim);
        await repository.complete(claim.id, claim.attempt);
        completed += 1;
      } catch (error) {
        // 对象已不存在 = 删除目标已达成，幂等 complete
        if (
          error instanceof ObjectStorageError &&
          error.code === 'object_not_found'
        ) {
          try {
            await repository.complete(claim.id, claim.attempt);
            completed += 1;
          } catch {
            helpers.logger.error(
              `object_delete_complete_failed claim=${claim.id}`,
            );
          }
          continue;
        }
        const failureCode =
          error instanceof ObjectStorageError
            ? error.code
            : 'object_delete_failed';
        try {
          await repository.fail(claim.id, {
            failureCode,
            attempt: claim.attempt,
          });
          failed += 1;
        } catch {
          helpers.logger.error(
            `object_delete_fail_record_failed claim=${claim.id}`,
          );
        }
      }
    }
    helpers.logger.info(
      `对象删除Outbox处理完成,claimed=${claims.length},completed=${completed},failed=${failed}`,
    );
  };
}

export const deleteObjectOutbox = createDeleteObjectOutboxTask();
