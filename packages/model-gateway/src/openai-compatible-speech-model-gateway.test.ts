import { describe, expect, it, vi } from 'vitest';
import type { EnabledModelGatewayConfiguration } from './config';
import { OpenAICompatibleSpeechModelGateway } from './openai-compatible-speech-model-gateway';

const configuration: EnabledModelGatewayConfiguration = {
  enabled: true,
  environment: 'test',
  provider: 'openai-compatible',
  runtime: 'native',
  baseUrl: 'https://provider.invalid/v1',
  apiKey: 'fixture',
  modelIds: { primary: 'text-model', speech: 'speech-model' },
  timeoutMs: 30_000,
  maxOutputTokens: 2_048,
  speechVoice: 'alloy',
  speechTimeoutMs: 60_000,
  speechMaxInputChars: 3_500,
};

const request = {
  taskAlias: 'speech.generate' as const,
  modelAlias: 'speech' as const,
  input: '这是一段音频概览。',
  format: 'mp3' as const,
  promptVersion: 'audio-overview-v1',
  traceId: 'trace-speech',
  operationId: 'job-1',
};

describe('OpenAICompatibleSpeechModelGateway', () => {
  it('调用受控 speech 端点并返回二进制与审计元数据', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          model: 'speech-model',
          voice: 'alloy',
          input: request.input,
          response_format: 'mp3',
        });
        return new Response(new Uint8Array([0x49, 0x44, 0x33, 1]), {
          headers: { 'content-type': 'audio/mpeg', 'x-request-id': 'req-1' },
        });
      },
    );
    const gateway = new OpenAICompatibleSpeechModelGateway(configuration, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => 10,
    });

    const result = await gateway.generateSpeech(request);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://provider.invalid/v1/audio/speech',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(Array.from(result.bytes)).toEqual([0x49, 0x44, 0x33, 1]);
    expect(result.metadata).toMatchObject({
      taskAlias: 'speech.generate',
      modelAlias: 'speech',
      resolvedModelId: 'speech-model',
      providerResponseId: 'req-1',
    });
  });

  it('超过字符配额在发请求前诚实失败', async () => {
    const fetchImpl = vi.fn();
    const gateway = new OpenAICompatibleSpeechModelGateway(
      { ...configuration, speechMaxInputChars: 80 },
      { fetchImpl: fetchImpl as typeof fetch },
    );
    await expect(
      gateway.generateSpeech({ ...request, input: '长'.repeat(81) }),
    ).rejects.toMatchObject({
      normalized: { code: 'output_limit', retryable: false },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('限流不在适配器内部重试', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 429 }));
    const gateway = new OpenAICompatibleSpeechModelGateway(configuration, {
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(gateway.generateSpeech(request)).rejects.toMatchObject({
      normalized: { code: 'rate_limit', retryable: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('拒绝200 JSON伪装成音频', async () => {
    const gateway = new OpenAICompatibleSpeechModelGateway(configuration, {
      fetchImpl: (async () =>
        new Response('{"error":"not audio"}', {
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    });
    await expect(gateway.generateSpeech(request)).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
  });
});
