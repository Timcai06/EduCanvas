import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveSpeechGateway } from './speech-gateway';

const configured = (
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  EDUCANVAS_DEPLOYMENT_ENV: 'local',
  MODEL_GATEWAY_PROVIDER: 'openai-compatible',
  MODEL_GATEWAY_PRIMARY_MODEL: 'text-model',
  MODEL_GATEWAY_BASE_URL: 'https://provider.invalid/v1',
  MODEL_GATEWAY_API_KEY: 'fixture-key',
  MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
  ...overrides,
});

describe('resolveSpeechGateway', () => {
  it('显式 speech 能力配置返回非流式 Speech Port', () => {
    const gateway = resolveSpeechGateway(configured());

    expect(gateway).not.toBeNull();
    expect(gateway?.generateSpeech).toEqual(expect.any(Function));
  });

  it('缺少或非法 speech 配置时按不可用返回 null', () => {
    expect(
      resolveSpeechGateway(
        configured({ MODEL_GATEWAY_SPEECH_MODEL: undefined }),
      ),
    ).toBeNull();
    expect(
      resolveSpeechGateway(
        configured({
          MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
          MODEL_GATEWAY_SPEECH_BASE_URL: 'bad',
          MODEL_GATEWAY_SPEECH_API_KEY: 'speech-fixture-key',
        }),
      ),
    ).toBeNull();
  });
});
