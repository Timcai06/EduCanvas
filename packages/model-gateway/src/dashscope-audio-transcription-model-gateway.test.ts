import { describe, expect, it, vi } from 'vitest';
import { DashScopeAudioTranscriptionModelGateway } from './dashscope-audio-transcription-model-gateway';
import type { DashScopeSpeechConfiguration } from './dashscope-speech-config';

const configuration: DashScopeSpeechConfiguration = {
  apiKey: 'dashscope-fixture-key',
  workspaceId: 'workspace-test',
  websocketUrl:
    'wss://workspace-test.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
  asrModel: 'qwen3-asr-flash',
  dictationModel: 'qwen3-asr-flash',
  ttsModel: 'qwen-audio-3.0-tts-flash',
  voice: 'longanhuan_v3.6',
};

describe('DashScopeAudioTranscriptionModelGateway', () => {
  it('用 data URL 调用 Qwen ASR chat/completions 并归一化中文文本', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer dashscope-fixture-key',
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        model: 'qwen3-asr-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: 'data:audio/webm;base64,GkXfoA==' },
              },
            ],
          },
        ],
        stream: false,
        asr_options: { language: 'zh', enable_itn: true },
      });
      return Response.json(
        {
          choices: [
            {
              message: {
                content: '  帮我复习分数  ',
                annotations: [{ type: 'audio_info', language: 'zh' }],
              },
            },
          ],
          usage: { seconds: 1.5 },
        },
        { headers: { 'x-request-id': 'request-asr' } },
      );
    });
    const gateway = new DashScopeAudioTranscriptionModelGateway(configuration, {
      fetchImpl,
      now: () => 10,
    });

    const result = await gateway.transcribeAudio({
      taskAlias: 'audio.transcribe',
      modelAlias: 'transcription',
      audioBytes: Uint8Array.from([0x1a, 0x45, 0xdf, 0xa0]),
      mimeType: 'audio/webm',
      promptVersion: 'desktop-pet-v1',
      traceId: 'trace-asr',
      operationId: 'operation-asr',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://workspace-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toMatchObject({
      text: '帮我复习分数',
      language: 'zh',
      durationSeconds: 1.5,
      metadata: {
        provider: 'dashscope',
        providerResponseId: 'request-asr',
        resolvedModelId: 'qwen3-asr-flash',
      },
    });
  });

  it('流式拒绝超过上限的供应商 JSON 响应', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024));
        controller.enqueue(Uint8Array.of(1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const gateway = new DashScopeAudioTranscriptionModelGateway(configuration, {
      fetchImpl: (async () =>
        new Response(body, {
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    });

    await expect(
      gateway.transcribeAudio({
        taskAlias: 'audio.transcribe',
        modelAlias: 'transcription',
        audioBytes: Uint8Array.of(1),
        mimeType: 'audio/webm',
        promptVersion: 'desktop-pet-v1',
        traceId: 'trace-asr',
        operationId: 'operation-asr',
      }),
    ).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
    expect(cancelled).toBe(true);
  });
});
