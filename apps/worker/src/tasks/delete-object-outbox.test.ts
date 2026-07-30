import { describe, expect, it, vi } from 'vitest';
import { ObjectStorageError } from '@educanvas/agent-core';
import { createDeleteObjectOutboxTask } from './delete-object-outbox';

const assetClaim = {
  id: '10000000-0000-4000-8000-000000000001',
  objectKind: 'asset' as const,
  storageKey: 'assets/0123456789abcdef/object.pdf',
  sourceType: 'asset_version' as const,
  sourceId: '20000000-0000-4000-8000-000000000001',
  attempt: 1,
  leasedUntil: new Date(Date.now() + 300_000),
};

const artifactClaim = {
  id: '30000000-0000-4000-8000-000000000003',
  objectKind: 'artifact' as const,
  storageKey:
    'artifacts/40000000-0000-4000-8000-000000000004/jobs/50000000-0000-4000-8000-000000000005/image.png',
  sourceType: 'artifact_version' as const,
  sourceId: '60000000-0000-4000-8000-000000000006',
  attempt: 1,
  leasedUntil: new Date(Date.now() + 300_000),
};

const avatarClaim = {
  id: '70000000-0000-4000-8000-000000000007',
  objectKind: 'avatar' as const,
  storageKey: 'avatars/user-avatar.png',
  sourceType: 'user_avatar' as const,
  sourceId: '80000000-0000-4000-8000-000000000008',
  attempt: 1,
  leasedUntil: new Date(Date.now() + 300_000),
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

  it('avatar 对象走资产根删除并 complete', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([avatarClaim]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };
    const deleter = { delete: vi.fn().mockResolvedValue(undefined) };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, { logger: { info: vi.fn() } } as never);

    expect(deleter.delete).toHaveBeenCalledWith(avatarClaim);
    expect(repository.complete).toHaveBeenCalledWith(avatarClaim.id);
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('ObjectStorageError 映射稳定 failureCode', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([assetClaim]),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const deleter = {
      delete: vi
        .fn()
        .mockRejectedValue(
          new ObjectStorageError('object_not_found', 'missing'),
        ),
    };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, { logger: { info: vi.fn() } } as never);

    expect(repository.fail).toHaveBeenCalledWith(assetClaim.id, {
      failureCode: 'object_not_found',
      attempt: 1,
    });
  });

  it('fail 自身失败时不中断循环，剩余 claim 继续处理', async () => {
    const claim2 = { ...assetClaim, id: 'claim-2' };
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([assetClaim, claim2]),
      complete: vi.fn(),
      fail: vi.fn(async (id: string) => {
        if (id === assetClaim.id) throw new Error('db transient error');
      }),
    };
    const deleter = {
      delete: vi.fn(async () => {
        throw new Error('always fails');
      }),
    };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    // 不应抛异常，两个 claim 都进入失败路径
    await task({ limit: 20 }, { logger: { info: vi.fn() } } as never);

    // claim-1: fail 抛异常被吞掉
    // claim-2: fail 成功调用
    expect(repository.fail).toHaveBeenCalledTimes(2);
    expect(repository.fail).toHaveBeenCalledWith('claim-2', {
      failureCode: 'object_delete_failed',
      attempt: 1,
    });
  });

  it('空 claim 列表不调用 delete', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([]),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const deleter = { delete: vi.fn() };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, { logger: { info: vi.fn() } } as never);

    expect(deleter.delete).not.toHaveBeenCalled();
  });
});
