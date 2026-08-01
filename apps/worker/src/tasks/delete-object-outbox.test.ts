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

const avatarClaim = {
  id: '70000000-0000-4000-8000-000000000007',
  objectKind: 'avatar' as const,
  storageKey: 'avatars/user-avatar.png',
  sourceType: 'user_avatar' as const,
  sourceId: '80000000-0000-4000-8000-000000000008',
  attempt: 1,
};

describe('delete object outbox task', () => {
  it('完成幂等物理删除后 complete 传入 attempt', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([assetClaim]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };
    const deleter = { delete: vi.fn().mockResolvedValue(undefined) };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, {
      logger: { info: vi.fn(), error: vi.fn() },
    } as never);

    expect(deleter.delete).toHaveBeenCalledWith(assetClaim);
    expect(repository.complete).toHaveBeenCalledWith(assetClaim.id, 1);
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('删除失败只记录稳定错误码传入 attempt', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([assetClaim]),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const deleter = {
      delete: vi.fn().mockRejectedValue(new Error('private stack detail')),
    };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, {
      logger: { info: vi.fn(), error: vi.fn() },
    } as never);

    expect(repository.fail).toHaveBeenCalledWith(assetClaim.id, {
      failureCode: 'object_delete_failed',
      attempt: 1,
    });
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('object_not_found 幂等 complete（对象已不存在=目标达成）', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([assetClaim]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };
    const deleter = {
      delete: vi
        .fn()
        .mockRejectedValue(
          new ObjectStorageError('object_not_found', 'missing'),
        ),
    };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, {
      logger: { info: vi.fn(), error: vi.fn() },
    } as never);

    expect(repository.complete).toHaveBeenCalledWith(assetClaim.id, 1);
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('object_not_found 后 complete 也失败时记录错误日志', async () => {
    const errorLog = vi.fn();
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([assetClaim]),
      complete: vi.fn().mockRejectedValue(new Error('db gone')),
      fail: vi.fn(),
    };
    const deleter = {
      delete: vi
        .fn()
        .mockRejectedValue(
          new ObjectStorageError('object_not_found', 'missing'),
        ),
    };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, {
      logger: { info: vi.fn(), error: errorLog },
    } as never);

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('object_delete_complete_failed claim='),
    );
  });

  it('fail 自身失败时记录错误日志并继续处理剩余 claim', async () => {
    const errorLog = vi.fn();
    const claim2 = { ...assetClaim, id: 'claim-2' };
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([assetClaim, claim2]),
      complete: vi.fn(),
      fail: vi.fn(async (id: string) => {
        if (id === assetClaim.id) throw new Error('db transient');
      }),
    };
    const deleter = {
      delete: vi.fn().mockRejectedValue(new Error('always fails')),
    };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, {
      logger: { info: vi.fn(), error: errorLog },
    } as never);

    expect(repository.fail).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        'object_delete_fail_record_failed claim=10000000',
      ),
    );
  });

  it('支持 artifact 类型的对象删除', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([artifactClaim]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };
    const deleter = { delete: vi.fn().mockResolvedValue(undefined) };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, {
      logger: { info: vi.fn(), error: vi.fn() },
    } as never);

    expect(deleter.delete).toHaveBeenCalledWith(artifactClaim);
    expect(repository.complete).toHaveBeenCalledWith(artifactClaim.id, 1);
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('avatar 对象走资产根删除', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([avatarClaim]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };
    const deleter = { delete: vi.fn().mockResolvedValue(undefined) };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, {
      logger: { info: vi.fn(), error: vi.fn() },
    } as never);

    expect(deleter.delete).toHaveBeenCalledWith(avatarClaim);
    expect(repository.complete).toHaveBeenCalledWith(avatarClaim.id, 1);
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

    await task({ limit: 20 }, {
      logger: { info: vi.fn(), error: vi.fn() },
    } as never);

    expect(deleter.delete).toHaveBeenCalledTimes(2);
    expect(repository.complete).toHaveBeenCalledWith(assetClaim.id, 1);
    expect(repository.complete).toHaveBeenCalledWith(artifactClaim.id, 1);
  });

  it('空 claim 列表不调用 delete', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([]),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const deleter = { delete: vi.fn() };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, {
      logger: { info: vi.fn(), error: vi.fn() },
    } as never);

    expect(deleter.delete).not.toHaveBeenCalled();
  });
});
