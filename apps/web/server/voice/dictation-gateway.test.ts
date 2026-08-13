import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveDictationGateway } from './dictation-gateway';

const environment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  DASHSCOPE_API_KEY: 'd'.repeat(32),
  DASHSCOPE_WORKSPACE_ID: 'workspace-test',
  DASHSCOPE_ASR_MODEL: 'qwen3-asr-flash',
});

describe('resolveDictationGateway', () => {
  it('桌宠非流式听写复用已配置的 DashScope 语音账户', () => {
    expect(resolveDictationGateway(environment())?.constructor.name).toBe(
      'DashScopeAudioTranscriptionModelGateway',
    );
  });

  it('显式 capability override 优先于 DashScope 默认桌宠听写', () => {
    const gateway = resolveDictationGateway({
      ...environment(),
      EDUCANVAS_DEPLOYMENT_ENV: 'local',
      MODEL_GATEWAY_PROVIDER: 'deepseek',
      MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
      MODEL_GATEWAY_PRIMARY_MODEL: 'deepseek-chat',
      MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com/v1',
      MODEL_GATEWAY_API_KEY: 'fixture-key',
      MODEL_GATEWAY_TRANSCRIPTION_PROVIDER: 'openai-compatible',
      MODEL_GATEWAY_TRANSCRIPTION_MODEL: 'whisper-model',
      MODEL_GATEWAY_TRANSCRIPTION_BASE_URL:
        'https://transcription.example.test/v1',
      MODEL_GATEWAY_TRANSCRIPTION_API_KEY: 'transcription-fixture-key',
    });

    expect(gateway?.constructor.name).toBe(
      'OpenAICompatibleAudioTranscriptionModelGateway',
    );
  });

  it('非法显式 capability override 不会静默回退 DashScope', () => {
    expect(
      resolveDictationGateway({
        ...environment(),
        EDUCANVAS_DEPLOYMENT_ENV: 'local',
        MODEL_GATEWAY_PROVIDER: 'deepseek',
        MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
        MODEL_GATEWAY_PRIMARY_MODEL: 'deepseek-chat',
        MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com/v1',
        MODEL_GATEWAY_API_KEY: 'fixture-key',
        MODEL_GATEWAY_TRANSCRIPTION_PROVIDER: 'openai-compatible',
      }),
    ).toBeNull();
  });
});
