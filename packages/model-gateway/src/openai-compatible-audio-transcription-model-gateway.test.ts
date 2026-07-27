import { describe, expect, it, vi } from 'vitest';
import type { EnabledModelGatewayConfiguration } from './config';
import { OpenAICompatibleAudioTranscriptionModelGateway } from './openai-compatible-audio-transcription-model-gateway';

const configuration: EnabledModelGatewayConfiguration = {
  enabled: true,
  environment: 'test',
  provider: 'openai-compatible',
  runtime: 'native',
  baseUrl: 'https://provider.invalid/v1',
  apiKey: 'fixture',
  modelIds: {
    primary: 'text-model',
    speech: 'speech-model',
    transcription: 'whisper-1',
  },
  timeoutMs: 30_000,
  maxOutputTokens: 2_048,
  visionEnabled: false,
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

const audioBytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);

const request = {
  taskAlias: 'audio.transcribe' as const,
  modelAlias: 'transcription' as const,
  audioBytes,
  mimeType: 'audio/mpeg' as const,
  promptVersion: 'audio-transcription-v1',
  traceId: 'trace-transcription',
  operationId: 'job-1',
};

describe('OpenAICompatibleAudioTranscriptionModelGateway', () => {
  it('调用受控 audio/transcriptions 端点并返回文本与审计元数据', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual(
          expect.objectContaining({
            authorization: 'Bearer fixture',
          }),
        );
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(
          JSON.stringify({ text: '你好世界', language: 'zh', duration: 2.5 }),
          {
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'req-transcription-1',
            },
          },
        );
      },
    );
    const gateway = new OpenAICompatibleAudioTranscriptionModelGateway(
      configuration,
      { fetchImpl: fetchImpl as typeof fetch, now: () => 10 },
    );

    const result = await gateway.transcribeAudio(request);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://provider.invalid/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.text).toBe('你好世界');
    expect(result.language).toBe('zh');
    expect(result.durationSeconds).toBe(2.5);
    expect(result.metadata).toMatchObject({
      taskAlias: 'audio.transcribe',
      modelAlias: 'transcription',
      resolvedModelId: 'whisper-1',
      providerResponseId: 'req-transcription-1',
    });
  });

  it('超过字节配额在发请求前诚实失败', async () => {
    const fetchImpl = vi.fn();
    const gateway = new OpenAICompatibleAudioTranscriptionModelGateway(
      {
        ...configuration,
        transcriptionMaxInputBytes: 1024,
      },
      { fetchImpl: fetchImpl as typeof fetch },
    );
    await expect(
      gateway.transcribeAudio({
        ...request,
        audioBytes: new Uint8Array(1025),
      }),
    ).rejects.toMatchObject({
      normalized: { code: 'output_limit', retryable: false },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('空字节在发请求前诚实失败', async () => {
    const fetchImpl = vi.fn();
    const gateway = new OpenAICompatibleAudioTranscriptionModelGateway(
      configuration,
      { fetchImpl: fetchImpl as typeof fetch },
    );
    await expect(
      gateway.transcribeAudio({
        ...request,
        audioBytes: new Uint8Array(0),
      }),
    ).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('限流不在适配器内部重试', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 429 }));
    const gateway = new OpenAICompatibleAudioTranscriptionModelGateway(
      configuration,
      { fetchImpl: fetchImpl as typeof fetch },
    );
    await expect(gateway.transcribeAudio(request)).rejects.toMatchObject({
      normalized: { code: 'rate_limit', retryable: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('拒绝非JSON响应', async () => {
    const gateway = new OpenAICompatibleAudioTranscriptionModelGateway(
      configuration,
      {
        fetchImpl: (async () =>
          new Response('not json', {
            headers: { 'content-type': 'text/plain' },
          })) as typeof fetch,
      },
    );
    await expect(gateway.transcribeAudio(request)).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
  });

  it('拒绝空文本响应', async () => {
    const gateway = new OpenAICompatibleAudioTranscriptionModelGateway(
      configuration,
      {
        fetchImpl: (async () =>
          new Response(JSON.stringify({ text: '   ' }), {
            headers: { 'content-type': 'application/json' },
          })) as typeof fetch,
      },
    );
    await expect(gateway.transcribeAudio(request)).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
  });

  it('拒绝缺少 text 字段的JSON响应', async () => {
    const gateway = new OpenAICompatibleAudioTranscriptionModelGateway(
      configuration,
      {
        fetchImpl: (async () =>
          new Response(JSON.stringify({ error: 'bad' }), {
            headers: { 'content-type': 'application/json' },
          })) as typeof fetch,
      },
    );
    await expect(gateway.transcribeAudio(request)).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
  });

  it('未配置 transcription model alias 时构造函数抛异常', () => {
    expect(
      () =>
        new OpenAICompatibleAudioTranscriptionModelGateway({
          ...configuration,
          modelIds: { primary: 'text-model' },
        }),
    ).toThrow('transcription model alias 未配置');
  });
});
