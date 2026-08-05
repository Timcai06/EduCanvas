import { describe, expect, it } from 'vitest';
import { DrizzleObjectDeletionOutboxRepository } from './object-deletion-outbox-repository';

/**
 * 输入校验单测（V15-B）：limit/leaseTimeoutMs/attempt 必须有限整数且有界。
 * 校验发生在访问 database 之前；注入 fake database 让"校验通过"的路径
 * 立即抛非 RangeError，从而只观测校验行为，不触碰真实数据库。
 */
const fakeDatabase = {
  transaction: async (): Promise<never> => {
    throw new Error('unexpected database access');
  },
  update: (): never => {
    throw new Error('unexpected database access');
  },
} as never;

const repository = new DrizzleObjectDeletionOutboxRepository(fakeDatabase);

/** 断言：校验放行后走到数据库层（错误不再是 RangeError）。 */
async function expectValidationPassed(promise: Promise<unknown>) {
  await expect(
    promise.catch((error: unknown) => {
      expect(error).not.toBeInstanceOf(RangeError);
      throw error;
    }),
  ).rejects.toThrow('unexpected database access');
}

describe('DrizzleObjectDeletionOutboxRepository 输入校验', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['小数', 3.7],
    ['越界下限', 0],
    ['越界上限', 201],
  ])('claimBatch 拒绝非法 limit（%s）', async (_label, limit) => {
    await expect(repository.claimBatch({ limit })).rejects.toThrow(RangeError);
  });

  it('claimBatch 接受合法 limit 边界（1 与 200）', async () => {
    await expectValidationPassed(repository.claimBatch({ limit: 1 }));
    await expectValidationPassed(repository.claimBatch({ limit: 200 }));
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['小数', 1.5],
    ['越界下限', 0],
    ['越界上限', 24 * 60 * 60 * 1_000 + 1],
  ])(
    'claimBatch 拒绝非法 leaseTimeoutMs（%s）',
    async (_label, leaseTimeoutMs) => {
      await expect(repository.claimBatch({ leaseTimeoutMs })).rejects.toThrow(
        RangeError,
      );
    },
  );

  it('claimBatch 省略可选输入时使用默认值并放行', async () => {
    await expectValidationPassed(repository.claimBatch({}));
  });

  it('claimBatch 拒绝 Invalid Date 的 now', async () => {
    await expect(
      repository.claimBatch({ now: new Date(Number.NaN) }),
    ).rejects.toThrow(RangeError);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['小数', 2.5],
    ['越界下限', 0],
    ['越界上限', 101],
  ])('complete 拒绝非法 attempt（%s）', async (_label, attempt) => {
    await expect(repository.complete('id', attempt)).rejects.toThrow(
      RangeError,
    );
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['小数', 2.5],
    ['越界下限', 0],
    ['越界上限', 101],
  ])('fail 拒绝非法 attempt（%s）', async (_label, attempt) => {
    await expect(
      repository.fail('id', { failureCode: 'test', attempt }),
    ).rejects.toThrow(RangeError);
  });

  it('fail 的合法 attempt 放行到数据库层', async () => {
    await expectValidationPassed(
      repository.fail('id', { failureCode: 'test', attempt: 10 }),
    );
  });
});
