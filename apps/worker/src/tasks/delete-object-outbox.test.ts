import { describe, expect, it, vi } from 'vitest';
import { createDeleteObjectOutboxTask } from './delete-object-outbox';

const claim = {
  id: '10000000-0000-4000-8000-000000000001',
  objectKind: 'asset' as const,
  storageKey: 'assets/0123456789abcdef/object.pdf',
  sourceType: 'asset_version' as const,
  sourceId: '20000000-0000-4000-8000-000000000001',
  attempt: 1,
};

describe('delete object outbox task', () => {
  it('完成幂等物理删除后提交Outbox', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([claim]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };
    const deleter = { delete: vi.fn().mockResolvedValue(undefined) };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, { logger: { info: vi.fn() } } as never);

    expect(deleter.delete).toHaveBeenCalledWith(claim);
    expect(repository.complete).toHaveBeenCalledWith(claim.id);
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('删除失败只记录稳定错误码并保留重试', async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([claim]),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const deleter = {
      delete: vi.fn().mockRejectedValue(new Error('private stack detail')),
    };
    const task = createDeleteObjectOutboxTask(repository, deleter);

    await task({ limit: 20 }, { logger: { info: vi.fn() } } as never);

    expect(repository.fail).toHaveBeenCalledWith(claim.id, {
      failureCode: 'object_delete_failed',
      attempt: 1,
    });
    expect(repository.complete).not.toHaveBeenCalled();
  });
});
