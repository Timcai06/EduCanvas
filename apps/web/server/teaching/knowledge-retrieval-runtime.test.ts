import { describe, expect, it, vi } from 'vitest';
import {
  ModelGatewayInvocationError,
  type EmbeddingModelGateway,
  type EmbeddingRequest,
  type NormalizedModelError,
} from '@educanvas/agent-core';

vi.mock('server-only', () => ({}));

const { embedQuery } = await import('./knowledge-retrieval-runtime');

/** 构造 fake embedding gateway：按预设结果/错误响应。 */
function fakeGateway(
  behavior:
    { kind: 'ok'; vector: readonly number[] } | { kind: 'throw'; error: Error },
) {
  const embed = vi.fn(
    async (request: EmbeddingRequest): Promise<{ embeddings: number[][] }> => {
      // 断言请求被正确传递（fake 不校验内容，仅保证契约形状）
      void request;
      if (behavior.kind === 'ok') {
        return { embeddings: [behavior.vector as number[]] };
      }
      throw behavior.error;
    },
  );
  // Mock 的可调用签名与接口方法签名不直接兼容，测试侧用断言收窄。
  return { embed } as unknown as EmbeddingModelGateway;
}

// PLATFORM_EMBEDDING_DIMENSIONS = 1536（agent-core model-gateway.ts）
const DIMENSIONS = 1536;
function vectorOf(value: number): number[] {
  return new Array(DIMENSIONS).fill(value);
}

function gatewayError(code: NormalizedModelError['code'], retryable: boolean) {
  return new ModelGatewayInvocationError({ code, retryable });
}

describe('embedQuery 降级原因端到端保真（Q02 最终验收）', () => {
  it('成功时返回向量且无降级原因', async () => {
    const gateway = fakeGateway({ kind: 'ok', vector: vectorOf(0.5) });
    const result = await embedQuery(gateway, {
      query: '测试',
      traceId: 't1',
      turnId: 'turn-1',
    });
    expect(result.vector).toHaveLength(DIMENSIONS);
    expect(result.degradationReason).toBeNull();
  });

  it('timeout → provider_timeout，向量为 null（FTS fallback 仍可用）', async () => {
    const gateway = fakeGateway({
      kind: 'throw',
      error: gatewayError('timeout', true),
    });
    const result = await embedQuery(gateway, {
      query: '测试',
      traceId: 't1',
      turnId: 'turn-1',
    });
    expect(result.vector).toBeNull();
    expect(result.degradationReason).toBe('provider_timeout');
  });

  it('aborted → provider_timeout', async () => {
    const gateway = fakeGateway({
      kind: 'throw',
      error: gatewayError('aborted', false),
    });
    const result = await embedQuery(gateway, {
      query: '测试',
      traceId: 't1',
      turnId: 'turn-1',
    });
    expect(result.degradationReason).toBe('provider_timeout');
  });

  it('unavailable / rate_limit → provider_unavailable', async () => {
    for (const code of ['unavailable', 'rate_limit'] as const) {
      const gateway = fakeGateway({
        kind: 'throw',
        error: gatewayError(code, true),
      });
      const result = await embedQuery(gateway, {
        query: '测试',
        traceId: 't1',
        turnId: 'turn-1',
      });
      expect(result.degradationReason).toBe('provider_unavailable');
      expect(result.vector).toBeNull();
    }
  });

  it('invalid_response → invalid_dimensions（保持既有契约映射）', async () => {
    const gateway = fakeGateway({
      kind: 'throw',
      error: gatewayError('invalid_response', false),
    });
    const result = await embedQuery(gateway, {
      query: '测试',
      traceId: 't1',
      turnId: 'turn-1',
    });
    expect(result.degradationReason).toBe('invalid_dimensions');
  });

  it('output_limit → invalid_configuration（保持既有契约映射）', async () => {
    const gateway = fakeGateway({
      kind: 'throw',
      error: gatewayError('output_limit', false),
    });
    const result = await embedQuery(gateway, {
      query: '测试',
      traceId: 't1',
      turnId: 'turn-1',
    });
    expect(result.degradationReason).toBe('invalid_configuration');
  });

  it('非网关错误保持 null（由输入侧推断分类）', async () => {
    const gateway = fakeGateway({
      kind: 'throw',
      error: new Error('unexpected'),
    });
    const result = await embedQuery(gateway, {
      query: '测试',
      traceId: 't1',
      turnId: 'turn-1',
    });
    expect(result.vector).toBeNull();
    expect(result.degradationReason).toBeNull();
  });
});
