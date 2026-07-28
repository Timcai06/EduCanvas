import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import { describe, expect, it, vi } from 'vitest';
import type { EnabledModelGatewayConfiguration } from './config';
import { OpenAICompatibleImageGenerationModelGateway } from './openai-compatible-image-generation-model-gateway';

const configuration: EnabledModelGatewayConfiguration = {
  enabled: true,
  environment: 'test',
  provider: 'openai-compatible',
  runtime: 'native',
  baseUrl: 'https://provider.invalid/v1',
  apiKey: 'fixture',
  modelIds: { primary: 'text-model', image: 'image-model' },
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
  embeddingModelVersion: null,
  embeddingTimeoutMs: 60_000,
  embeddingMaxBatch: 64,
};

const request = {
  taskAlias: 'image.generate' as const,
  modelAlias: 'image' as const,
  prompt: '一张展示光合作用过程的示意图',
  size: '1024x1024' as const,
  count: 1 as const,
  promptVersion: 'artifact-generated-image-v1',
  traceId: 'trace-image',
  operationId: 'job-1',
};

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function encode(bytes: readonly number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString('base64');
}

function pngPayload(extraBytes = 8): string {
  return encode([...PNG_HEADER, ...new Array<number>(extraBytes).fill(0x01)]);
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function createGateway(fetchImpl: unknown, now: () => number = () => 10) {
  return new OpenAICompatibleImageGenerationModelGateway(configuration, {
    fetchImpl: fetchImpl as typeof fetch,
    now,
  });
}

describe('OpenAICompatibleImageGenerationModelGateway', () => {
  it('调用受控 images 端点并返回位图与审计元数据', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          model: 'image-model',
          prompt: request.prompt,
          size: '1024x1024',
          n: 1,
          response_format: 'b64_json',
        });
        return jsonResponse(
          { data: [{ b64_json: pngPayload() }] },
          { 'x-request-id': 'req-1' },
        );
      },
    );

    const result = await createGateway(fetchImpl).generateImage(request);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://provider.invalid/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.images).toHaveLength(1);
    expect(result.images[0].mimeType).toBe('image/png');
    expect(result.images[0].size).toBe('1024x1024');
    expect(result.images[0].bytes.byteLength).toBe(16);
    expect(result.metadata).toMatchObject({
      provider: 'openai-compatible',
      resolvedModelId: 'image-model',
      taskAlias: 'image.generate',
      modelAlias: 'image',
      providerResponseId: 'req-1',
      finishReason: 'stop',
    });
  });

  it('识别 JPEG 与 WebP 容器，拒绝声明格式之外的字节', async () => {
    const jpeg = encode([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const webp = encode([
      0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);

    for (const [payload, expected] of [
      [jpeg, 'image/jpeg'],
      [webp, 'image/webp'],
    ] as const) {
      const result = await createGateway(
        vi.fn(async () => jsonResponse({ data: [{ b64_json: payload }] })),
      ).generateImage(request);
      expect(result.images[0].mimeType).toBe(expected);
    }
  });

  it('未知容器的字节按 invalid_response 拒绝，不按供应商声明放行', async () => {
    const gateway = createGateway(
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              b64_json: encode([
                0x3c, 0x73, 0x76, 0x67, 0x20, 0x2f, 0x3e, 0x0a,
              ]),
            },
          ],
        }),
      ),
    );

    await expect(gateway.generateImage(request)).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
  });

  it('URL 形态响应不被接受，内容事实必须自持', async () => {
    const gateway = createGateway(
      vi.fn(async () =>
        jsonResponse({ data: [{ url: 'https://provider.invalid/i.png' }] }),
      ),
    );

    await expect(gateway.generateImage(request)).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
  });

  it('多返回条目按非法响应拒绝，不静默取第一张', async () => {
    const gateway = createGateway(
      vi.fn(async () =>
        jsonResponse({
          data: [{ b64_json: pngPayload() }, { b64_json: pngPayload() }],
        }),
      ),
    );

    await expect(gateway.generateImage(request)).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
  });

  it('超过配置上限的图像按 output_limit 拒绝', async () => {
    const oversized = new Uint8Array(configuration.imageMaxOutputBytes + 1_024);
    oversized.set(PNG_HEADER);
    const gateway = createGateway(
      vi.fn(async () =>
        jsonResponse({
          data: [{ b64_json: Buffer.from(oversized).toString('base64') }],
        }),
      ),
    );

    await expect(gateway.generateImage(request)).rejects.toMatchObject({
      normalized: { code: 'output_limit', retryable: false },
    });
  });

  it('畸形 base64 不进入解码器', async () => {
    const gateway = createGateway(
      vi.fn(async () =>
        jsonResponse({ data: [{ b64_json: '!!!not-base64' }] }),
      ),
    );

    await expect(gateway.generateImage(request)).rejects.toMatchObject({
      normalized: { code: 'output_limit', retryable: false },
    });
  });

  it('空提示词与非法尺寸在发出请求前即被拒绝', async () => {
    const fetchImpl = vi.fn();
    const gateway = createGateway(fetchImpl);

    await expect(
      gateway.generateImage({ ...request, prompt: '   ' }),
    ).rejects.toBeInstanceOf(ModelGatewayInvocationError);
    await expect(
      gateway.generateImage({
        ...request,
        size: '4096x4096' as unknown as typeof request.size,
      }),
    ).rejects.toBeInstanceOf(ModelGatewayInvocationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('限流与服务端错误保留可重试语义，客户端错误不可重试', async () => {
    for (const [status, expected] of [
      [429, { code: 'rate_limit', retryable: true }],
      [503, { code: 'unavailable', retryable: true }],
      [400, { code: 'invalid_response', retryable: false }],
    ] as const) {
      const gateway = createGateway(
        vi.fn(async () => new Response('', { status })),
      );
      await expect(gateway.generateImage(request)).rejects.toMatchObject({
        normalized: expected,
      });
    }
  });

  it('外部取消收敛为 aborted，且不做内部重试', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    const gateway = createGateway(fetchImpl);

    await expect(
      gateway.generateImage({ ...request, signal: controller.signal }),
    ).rejects.toMatchObject({
      normalized: { code: 'aborted', retryable: false },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('未配置 image 模型别名时拒绝构造，不静默降级到其他别名', () => {
    expect(
      () =>
        new OpenAICompatibleImageGenerationModelGateway({
          ...configuration,
          modelIds: { primary: 'text-model' },
        }),
    ).toThrow(TypeError);
  });
});
