import { describe, expect, it } from 'vitest';
import {
  RETRIEVAL_DEGRADATION_REASONS,
  embeddingGatewayErrorToRetrievalDegradation,
  type RetrievalDegradationReason,
} from './retrieval-degradation';

describe('RetrievalDegradationReason 契约', () => {
  it('reason 恰好是计划 Q02 冻结的 9 个，且不随实现漂移', () => {
    expect(RETRIEVAL_DEGRADATION_REASONS).toEqual([
      'not_configured',
      'invalid_configuration',
      'provider_timeout',
      'provider_unavailable',
      'invalid_dimensions',
      'corpus_not_embedded',
      'vector_query_timeout',
      'extension_unavailable',
      'fallback_fts',
    ]);
  });

  it('全 9 个 reason 可用于低基数标签（封闭联合可穷举）', () => {
    // 编译期穷举守卫：switch 覆盖全部 reason 时不落入 default 分支。
    const labelOf = (reason: RetrievalDegradationReason): string => {
      switch (reason) {
        case 'not_configured':
          return 'no capability';
        case 'invalid_configuration':
          return 'config mismatch';
        case 'provider_timeout':
          return 'provider slow';
        case 'provider_unavailable':
          return 'provider down';
        case 'invalid_dimensions':
          return 'bad vector';
        case 'corpus_not_embedded':
          return 'no corpus vectors';
        case 'vector_query_timeout':
          return 'ann timeout';
        case 'extension_unavailable':
          return 'no pgvector';
        case 'fallback_fts':
          return 'unclassified';
      }
    };
    for (const reason of RETRIEVAL_DEGRADATION_REASONS) {
      expect(labelOf(reason).length).toBeGreaterThan(0);
    }
  });
});

describe('embeddingGatewayErrorToRetrievalDegradation', () => {
  const errorWithCode = (code: string) => ({ normalized: { code } });

  it('超时与客户端中止 → provider_timeout', () => {
    expect(
      embeddingGatewayErrorToRetrievalDegradation(errorWithCode('timeout')),
    ).toBe('provider_timeout');
    expect(
      embeddingGatewayErrorToRetrievalDegradation(errorWithCode('aborted')),
    ).toBe('provider_timeout');
  });

  it('不可用与限流 → provider_unavailable', () => {
    expect(
      embeddingGatewayErrorToRetrievalDegradation(errorWithCode('unavailable')),
    ).toBe('provider_unavailable');
    expect(
      embeddingGatewayErrorToRetrievalDegradation(errorWithCode('rate_limit')),
    ).toBe('provider_unavailable');
  });

  it('响应不可用（维度/顺序/NaN 校验失败）→ invalid_dimensions', () => {
    expect(
      embeddingGatewayErrorToRetrievalDegradation(
        errorWithCode('invalid_response'),
      ),
    ).toBe('invalid_dimensions');
  });

  it('输入超限 → invalid_configuration', () => {
    expect(
      embeddingGatewayErrorToRetrievalDegradation(
        errorWithCode('output_limit'),
      ),
    ).toBe('invalid_configuration');
  });

  it('未归一化的错误码 → fallback_fts（不新增高基数标签）', () => {
    expect(
      embeddingGatewayErrorToRetrievalDegradation(errorWithCode('unknown')),
    ).toBe('fallback_fts');
  });
});
