import { describe, expect, it } from 'vitest';
import { classifyVectorQueryError } from './knowledge-hybrid-retrieval';

/**
 * 向量子查询异常 → 低基数 reason 的归类测试（Q02）。
 *
 * 超时与扩展缺失两类必须稳定识别（对应真实降级场景）；其余异常一律归入
 * `fallback_fts`，不允许出现按错误文本动态生成的高基数标签。
 */
describe('classifyVectorQueryError', () => {
  it('statement_timeout（SQLSTATE 57014）→ vector_query_timeout', () => {
    expect(
      classifyVectorQueryError({
        code: '57014',
        message: 'canceling statement due to statement timeout',
      }),
    ).toBe('vector_query_timeout');
  });

  it('仅消息、无 SQLSTATE 的超时表达 → vector_query_timeout', () => {
    expect(
      classifyVectorQueryError({ message: 'statement timeout exceeded' }),
    ).toBe('vector_query_timeout');
  });

  it('Drizzle 嵌套事务包装错误 { query, params, cause } 解包后仍识别超时', () => {
    /* 集成测试实证：savepoint 内语句失败时驱动抛包装错误，SQLSTATE 在
       cause 链上；不解包会把 57014 误归为 fallback_fts。 */
    expect(
      classifyVectorQueryError({
        query: 'select ...',
        params: ['embed-fixture'],
        cause: {
          code: '57014',
          message: 'canceling statement due to statement timeout',
        },
      }),
    ).toBe('vector_query_timeout');
    expect(
      classifyVectorQueryError({
        cause: {
          cause: { code: '42704', message: 'type "vector" does not exist' },
        },
      }),
    ).toBe('extension_unavailable');
  });

  it('pgvector 扩展缺失（type "vector" 不存在）→ extension_unavailable', () => {
    expect(
      classifyVectorQueryError({
        code: '42704',
        message: 'type "vector" does not exist',
      }),
    ).toBe('extension_unavailable');
    expect(
      classifyVectorQueryError({
        message: 'extension "vector" is not available',
      }),
    ).toBe('extension_unavailable');
  });

  it('未归类异常 → fallback_fts，且不携带异常正文', () => {
    expect(
      classifyVectorQueryError({
        code: '42501',
        message: 'permission denied for table x',
      }),
    ).toBe('fallback_fts');
    expect(classifyVectorQueryError({})).toBe('fallback_fts');
    expect(classifyVectorQueryError(undefined)).toBe('fallback_fts');
    expect(classifyVectorQueryError(new Error('connection reset'))).toBe(
      'fallback_fts',
    );
  });
});
