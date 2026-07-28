import { PLATFORM_EMBEDDING_DIMENSIONS } from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';
import type { EnabledModelGatewayConfiguration } from './config';
import { OpenAICompatibleEmbeddingModelGateway } from './openai-compatible-embedding-model-gateway';

const configuration: EnabledModelGatewayConfiguration = {
  enabled: true,
  environment: 'test',
  provider: 'openai-compatible',
  runtime: 'native',
  baseUrl: 'https://provider.invalid/v1',
  apiKey: 'fixture',
  modelIds: { primary: 'text-model', embedding: 'embedding-model' },
  timeoutMs: 30_000,
  maxOutputTokens: 2_048,
  visionEnabled: false,
  visionProvider: null,
  speechVoice: 'alloy',
  speechTimeoutMs: 60_000,
  speechMaxInputChars: 3_500,
  transcriptionTimeoutMs: 120_000,
  transcriptionMaxInputBytes: 25 * 1024 * 1024,
  imageTimeoutMs: 120_000,
  imageMaxOutputBytes: 8 * 1024 * 1024,
  embeddingModelVersion: '2026-05-01',
  embeddingTimeoutMs: 60_000,
  embeddingMaxBatch: 64,
};

const request = {
  taskAlias: 'retrieval.embed' as const,
  modelAlias: 'embedding' as const,
  purpose: 'passage' as const,
  inputs: ['神经网络由多层神经元组成', '训练通过误差更新权重'],
  promptVersion: 'knowledge-passage-embedding-v1',
  traceId: 'trace-embedding',
  operationId: 'document-1',
};

const vectorOf = (seed: number): number[] =>
  new Array<number>(PLATFORM_EMBEDDING_DIMENSIONS).fill(seed);

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function createGateway(fetchImpl: unknown, now: () => number = () => 10) {
  return new OpenAICompatibleEmbeddingModelGateway(configuration, {
    fetchImpl: fetchImpl as typeof fetch,
    now,
  });
}

describe('OpenAICompatibleEmbeddingModelGateway', () => {
  it('调用受控 embeddings 端点并返回完整向量身份', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          model: 'embedding-model',
          input: request.inputs,
          dimensions: PLATFORM_EMBEDDING_DIMENSIONS,
          encoding_format: 'float',
        });
        return jsonResponse(
          {
            data: [
              { index: 0, embedding: vectorOf(0.1) },
              { index: 1, embedding: vectorOf(0.2) },
            ],
            usage: { prompt_tokens: 12 },
          },
          { 'x-request-id': 'req-1' },
        );
      },
    );

    const result = await createGateway(fetchImpl).embed(request);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://provider.invalid/v1/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]![0]).toBe(0.1);
    expect(result.descriptor).toEqual({
      provider: 'openai-compatible',
      model: 'embedding-model',
      modelVersion: '2026-05-01',
      dimensions: PLATFORM_EMBEDDING_DIMENSIONS,
      instruction: 'passage:v1',
    });
    expect(result.metadata).toMatchObject({
      taskAlias: 'retrieval.embed',
      modelAlias: 'embedding',
      resolvedModelId: 'embedding-model',
      modelRevision: '2026-05-01',
      usage: expect.objectContaining({ inputTokens: 12 }),
    });
  });

  it('query 与 passage 使用不同指令，向量身份因此不同', async () => {
    const gateway = createGateway(
      vi.fn(async () =>
        jsonResponse({ data: [{ index: 0, embedding: vectorOf(0.3) }] }),
      ),
    );

    const passage = await gateway.embed({ ...request, inputs: ['x'] });
    const query = await gateway.embed({
      ...request,
      inputs: ['x'],
      purpose: 'query',
    });

    expect(passage.descriptor.instruction).toBe('passage:v1');
    expect(query.descriptor.instruction).toBe('query:v1');
  });

  it('按 index 重排乱序响应，不依赖数组下标对齐', async () => {
    const gateway = createGateway(
      vi.fn(async () =>
        jsonResponse({
          data: [
            { index: 1, embedding: vectorOf(0.9) },
            { index: 0, embedding: vectorOf(0.1) },
          ],
        }),
      ),
    );

    const result = await gateway.embed(request);

    expect(result.embeddings[0]![0]).toBe(0.1);
    expect(result.embeddings[1]![0]).toBe(0.9);
  });

  it('重复或越界 index 按非法响应拒绝', async () => {
    for (const data of [
      [
        { index: 0, embedding: vectorOf(0.1) },
        { index: 0, embedding: vectorOf(0.2) },
      ],
      [
        { index: 0, embedding: vectorOf(0.1) },
        { index: 5, embedding: vectorOf(0.2) },
      ],
    ]) {
      const gateway = createGateway(vi.fn(async () => jsonResponse({ data })));
      await expect(gateway.embed(request)).rejects.toMatchObject({
        normalized: { code: 'invalid_response', retryable: false },
      });
    }
  });

  it('维度不符与非有限分量一律拒绝，不截断也不补零', async () => {
    const shortVector = new Array<number>(8).fill(0.1);
    const nanVector = vectorOf(0.1);
    nanVector[3] = Number.NaN;

    for (const embedding of [shortVector, nanVector]) {
      const gateway = createGateway(
        vi.fn(async () => jsonResponse({ data: [{ index: 0, embedding }] })),
      );
      await expect(
        gateway.embed({ ...request, inputs: ['x'] }),
      ).rejects.toMatchObject({
        normalized: { code: 'invalid_response', retryable: false },
      });
    }
  });

  it('条目数量与请求不符时整批拒绝', async () => {
    const gateway = createGateway(
      vi.fn(async () =>
        jsonResponse({ data: [{ index: 0, embedding: vectorOf(0.1) }] }),
      ),
    );

    await expect(gateway.embed(request)).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
  });

  it('空批、超批与空字符串在发出请求前即被拒绝', async () => {
    const fetchImpl = vi.fn();
    const gateway = createGateway(fetchImpl);

    await expect(
      gateway.embed({ ...request, inputs: [] }),
    ).rejects.toMatchObject({ normalized: { code: 'output_limit' } });
    await expect(
      gateway.embed({ ...request, inputs: new Array(65).fill('x') }),
    ).rejects.toMatchObject({ normalized: { code: 'output_limit' } });
    await expect(
      gateway.embed({ ...request, inputs: ['  '] }),
    ).rejects.toMatchObject({ normalized: { code: 'output_limit' } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('限流与服务端错误保留可重试语义', async () => {
    for (const [status, expected] of [
      [429, { code: 'rate_limit', retryable: true }],
      [503, { code: 'unavailable', retryable: true }],
      [400, { code: 'invalid_response', retryable: false }],
    ] as const) {
      const gateway = createGateway(
        vi.fn(async () => new Response('', { status })),
      );
      await expect(gateway.embed(request)).rejects.toMatchObject({
        normalized: expected,
      });
    }
  });

  it('缺少模型别名或模型版本时拒绝构造', () => {
    expect(
      () =>
        new OpenAICompatibleEmbeddingModelGateway({
          ...configuration,
          modelIds: { primary: 'text-model' },
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new OpenAICompatibleEmbeddingModelGateway({
          ...configuration,
          embeddingModelVersion: null,
        }),
    ).toThrow(TypeError);
  });
});
