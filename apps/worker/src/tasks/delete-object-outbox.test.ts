import { describe, expect, it, vi } from 'vitest';
import { createDeleteObjectOutboxTask } from './delete-object-outbox';

const assetClaim = {
  id: '10000000-0000-4000-8000-000000000001',
  objectKind: 'asset' as const,
  storageKey: 'assets/0123456789abcdef/object.pdf',
  sourceType: 'asset_version' as const,
  sourceId: '20000000-0000-4000-8000-000000000001',
  attempt: 1,
};

const artifactClaim = {
  id: '30000000-0000-4000-8000-000000000003',
  objectKind: 'artifact' as const,
  storageKey:
    'artifacts/40000000-0000-4000-8000-000000000004/jobs/50000000-0000-4000-8000-000000000005/image.png',
  sourceType: 'artifact_version' as const,
  sourceId: '60000000-0000-4000-8000-000000000006',
  attempt: 1,
};

describe('delete object outbox task', () => {
  it('完成幂等物理删除后提交Outbox', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([assetClaim]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };
    const deleter = { delete: vi.fn().mockResolvedValue(undefined) };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, { logger: { info: vi.fn() } } as never);

    expect(deleter.delete).toHaveBeenCalledWith(assetClaim);
    expect(repository.complete).toHaveBeenCalledWith(assetClaim.id);
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('删除失败只记录稳定错误码并保留重试', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([assetClaim]),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const deleter = {
      delete: vi.fn().mockRejectedValue(new Error('private stack detail')),
    };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, { logger: { info: vi.fn() } } as never);

    expect(repository.fail).toHaveBeenCalledWith(assetClaim.id, {
      failureCode: 'object_delete_failed',
      attempt: 1,
    });
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('支持 artifact 类型的对象删除', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([artifactClaim]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };
    const deleter = { delete: vi.fn().mockResolvedValue(undefined) };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, { logger: { info: vi.fn() } } as never);

    expect(deleter.delete).toHaveBeenCalledWith(artifactClaim);
    expect(repository.complete).toHaveBeenCalledWith(artifactClaim.id);
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('混合 asset 和 artifact 批次全部完成', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([assetClaim, artifactClaim]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };
    const deleter = { delete: vi.fn().mockResolvedValue(undefined) };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, { logger: { info: vi.fn() } } as never);

    expect(deleter.delete).toHaveBeenCalledTimes(2);
    expect(repository.complete).toHaveBeenCalledWith(assetClaim.id);
    expect(repository.complete).toHaveBeenCalledWith(artifactClaim.id);
  });
});
