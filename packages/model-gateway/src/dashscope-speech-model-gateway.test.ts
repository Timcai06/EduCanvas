import { describe, expect, it, vi } from 'vitest';
import { DashScopeSpeechModelGateway } from './dashscope-speech-model-gateway';
import type { DashScopeSpeechConfiguration } from './dashscope-speech-config';

const configuration: DashScopeSpeechConfiguration = {
  apiKey: 'dashscope-fixture-key',
  workspaceId: 'workspace-test',
  websocketUrl:
    'wss://workspace-test.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
  asrModel: 'paraformer-realtime-v2',
  dictationModel: 'qwen3-asr-flash',
  ttsModel: 'qwen-audio-3.0-tts-flash',
  voice: 'longanhuan_v3.6',
};

const request = {
  taskAlias: 'speech.generate' as const,
  modelAlias: 'speech' as const,
  input: '你好，我是你的学习助手。',
  format: 'mp3' as const,
  promptVersion: 'desktop-pet-v1',
  traceId: 'trace-speech',
  operationId: 'operation-speech',
};

describe('DashScopeSpeechModelGateway', () => {
  it('用北京 Workspace HTTP API 合成 MP3，并受限下载供应商音频', async () => {
    const calls: Array<{
      url: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        authorization: new Headers(init?.headers).get('authorization'),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.includes('/SpeechSynthesizer')) {
        expect(init?.redirect).toBe('error');
        return Response.json({
          request_id: 'request-tts',
          output: {
            finish_reason: 'stop',
            audio: {
              data: '',
              url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.mp3?Expires=1',
              id: 'audio-one',
              expires_at: 1,
            },
          },
          usage: { characters: 13 },
        });
      }
      return new Response(Uint8Array.from([0x49, 0x44, 0x33, 4]), {
        headers: { 'content-type': 'audio/mpeg' },
      });
    });
    const gateway = new DashScopeSpeechModelGateway(configuration, {
      fetchImpl,
      now: () => 10,
    });

    const result = await gateway.generateSpeech(request);

    expect(calls[0]).toEqual({
      url: 'https://workspace-test.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
      authorization: 'Bearer dashscope-fixture-key',
      body: {
        model: 'qwen-audio-3.0-tts-flash',
        input: {
          text: request.input,
          voice: 'longanhuan_v3.6',
          format: 'mp3',
          language_hints: ['zh'],
        },
      },
    });
    expect(calls[1]?.authorization).toBeNull();
    expect(calls[1]?.url).toBe(
      'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.mp3?Expires=1',
    );
    expect(result.bytes).toEqual(Uint8Array.from([0x49, 0x44, 0x33, 4]));
    expect(result.metadata).toMatchObject({
      provider: 'dashscope',
      providerResponseId: 'request-tts',
      resolvedModelId: 'qwen-audio-3.0-tts-flash',
    });
  });

  it('拒绝供应商返回的站外下载 URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        request_id: 'request-tts',
        output: {
          finish_reason: 'stop',
          audio: { url: 'https://attacker.example/audio.mp3' },
        },
      }),
    );
    const gateway = new DashScopeSpeechModelGateway(configuration, {
      fetchImpl,
    });

    await expect(gateway.generateSpeech(request)).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('取消第二段音频下载时返回稳定 aborted', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('/SpeechSynthesizer')) {
        return Response.json({
          request_id: 'request-tts',
          output: {
            finish_reason: 'stop',
            audio: {
              url: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.mp3',
            },
          },
        });
      }
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const gateway = new DashScopeSpeechModelGateway(configuration, {
      fetchImpl,
    });

    await expect(
      gateway.generateSpeech({ ...request, signal: controller.signal }),
    ).rejects.toMatchObject({
      normalized: { code: 'aborted', retryable: false },
    });
  });
});
