import { describe, expect, it } from 'vitest';
import { canvasResourceErrorSchema } from './resource-errors';

describe('canvasResourceErrorSchema', () => {
  it('接受稳定且可展示的公共错误', () => {
    expect(
      canvasResourceErrorSchema.safeParse({
        code: 'runtime_unavailable',
        message: '当前运行环境不可用。',
        retryable: true,
      }).success,
    ).toBe(true);
  });

  it('拒绝堆栈等额外诊断字段', () => {
    expect(
      canvasResourceErrorSchema.safeParse({
        code: 'resource_not_found',
        message: '资源不存在或无权访问。',
        retryable: false,
        stack: '/private/storage/resource.ts:42',
      }).success,
    ).toBe(false);
  });
});
