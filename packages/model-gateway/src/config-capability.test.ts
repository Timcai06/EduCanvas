import { describe, expect, it } from 'vitest';
import {
  parseCapabilityConfiguration,
  primaryProviderSupportsCapability,
  type CapabilityConfiguration,
  type OverrideCapability,
} from './config-capability';
import type { ModelGatewayEnvironment } from './config-primitives';

const speechOverride = (
  overrides: ModelGatewayEnvironment = {},
): ModelGatewayEnvironment => ({
  MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
  MODEL_GATEWAY_SPEECH_MODEL: 'explicit-speech-model',
  MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech-provider.invalid/v1',
  MODEL_GATEWAY_SPEECH_API_KEY: 'speech-fixture-key-never-real',
  ...overrides,
});

describe('parseCapabilityConfiguration', () => {
  it('完整 override 解析为独立路由且凭据与主隔离', () => {
    const result = parseCapabilityConfiguration(
      speechOverride({ MODEL_GATEWAY_SPEECH_TIMEOUT_MS: '90000' }),
      'speech',
      'openai-compatible',
      'local',
    );
    expect(result).toEqual({
      kind: 'overridden',
      override: {
        provider: 'openai-compatible',
        model: 'explicit-speech-model',
        baseUrl: 'https://speech-provider.invalid/v1',
        apiKey: 'speech-fixture-key-never-real',
        timeoutMs: 90_000,
      },
    });
  });

  it('未声明 override 且主 Provider 支持时整组继承', () => {
    const result = parseCapabilityConfiguration(
      {},
      'speech',
      'openai-compatible',
      'local',
    );
    expect(result).toEqual({ kind: 'inherited' });
  });

  it('未声明 override 且主 Provider 不支持时只关闭能力', () => {
    /* DeepSeek 只有文本能力；speech 继承声明同样不应成立。 */
    const result = parseCapabilityConfiguration(
      {},
      'speech',
      'deepseek',
      'local',
    );
    expect(result).toEqual({ kind: 'disabled' });
  });

  it.each(['speech', 'transcription', 'image', 'embedding'] as const)(
    'DeepSeek 主 Provider 不支持 %s 能力',
    (capability) => {
      expect(primaryProviderSupportsCapability('deepseek', capability)).toBe(
        false,
      );
      expect(
        parseCapabilityConfiguration({}, capability, 'deepseek', 'local'),
      ).toEqual({ kind: 'disabled' });
    },
  );

  it('声明了 override 却缺模型时关闭能力而不是整组失败', () => {
    const result = parseCapabilityConfiguration(
      speechOverride({ MODEL_GATEWAY_SPEECH_MODEL: undefined }),
      'speech',
      'openai-compatible',
      'local',
    );
    expect(result).toEqual({ kind: 'disabled' });
  });

  it('声明了 override 却缺 Base URL 时关闭能力', () => {
    const result = parseCapabilityConfiguration(
      speechOverride({ MODEL_GATEWAY_SPEECH_BASE_URL: undefined }),
      'speech',
      'openai-compatible',
      'local',
    );
    expect(result).toEqual({ kind: 'disabled' });
  });

  it('声明了 override 却缺 API Key 时关闭能力', () => {
    const result = parseCapabilityConfiguration(
      speechOverride({ MODEL_GATEWAY_SPEECH_API_KEY: undefined }),
      'speech',
      'openai-compatible',
      'local',
    );
    expect(result).toEqual({ kind: 'disabled' });
  });

  it('未知 Provider 声明关闭能力而不是抛错', () => {
    const result = parseCapabilityConfiguration(
      speechOverride({ MODEL_GATEWAY_SPEECH_PROVIDER: 'anthropic' }),
      'speech',
      'openai-compatible',
      'local',
    );
    expect(result).toEqual({ kind: 'disabled' });
  });

  it('能力不兼容的 Provider 声明关闭能力（DeepSeek 无媒体能力）', () => {
    const result = parseCapabilityConfiguration(
      speechOverride({ MODEL_GATEWAY_SPEECH_PROVIDER: 'deepseek' }),
      'speech',
      'openai-compatible',
      'local',
    );
    expect(result).toEqual({ kind: 'disabled' });
  });

  it('越界的超时声明关闭能力而不是拖垮配置', () => {
    const result = parseCapabilityConfiguration(
      speechOverride({ MODEL_GATEWAY_SPEECH_TIMEOUT_MS: '999999' }),
      'speech',
      'openai-compatible',
      'local',
    );
    expect(result).toEqual({ kind: 'disabled' });
  });

  it('非法 Base URL 关闭能力且不泄漏配置值', () => {
    const secret = 'fixture-secret-never-log';
    let result: CapabilityConfiguration;
    try {
      result = parseCapabilityConfiguration(
        speechOverride({
          MODEL_GATEWAY_SPEECH_API_KEY: secret,
          MODEL_GATEWAY_SPEECH_BASE_URL: 'not-a-url-with-secret',
        }),
        'speech',
        'openai-compatible',
        'local',
      );
    } catch (caught) {
      expect(() => {
        throw caught;
      }).not.toThrow();
      throw new Error('能力级配置错误不应抛异常');
    }
    expect(result).toEqual({ kind: 'disabled' });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('能力级配置错误不影响同一环境下其他能力解析', () => {
    /* speech 缺失 Key 关闭，embedding 仍可完整独立配置。 */
    const speechResult = parseCapabilityConfiguration(
      {
        MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
        MODEL_GATEWAY_EMBEDDING_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_EMBEDDING_MODEL: 'embed-model',
        MODEL_GATEWAY_EMBEDDING_BASE_URL: 'https://embed.invalid/v1',
        MODEL_GATEWAY_EMBEDDING_API_KEY: 'embed-key',
      },
      'speech',
      'openai-compatible',
      'local',
    );
    const embeddingResult = parseCapabilityConfiguration(
      {
        MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
        MODEL_GATEWAY_EMBEDDING_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_EMBEDDING_MODEL: 'embed-model',
        MODEL_GATEWAY_EMBEDDING_BASE_URL: 'https://embed.invalid/v1',
        MODEL_GATEWAY_EMBEDDING_API_KEY: 'embed-key',
      },
      'embedding',
      'openai-compatible',
      'local',
    );
    expect(speechResult).toEqual({ kind: 'disabled' });
    expect(embeddingResult).toEqual({
      kind: 'overridden',
      override: {
        provider: 'openai-compatible',
        model: 'embed-model',
        baseUrl: 'https://embed.invalid/v1',
        apiKey: 'embed-key',
        timeoutMs: 60_000,
      },
    });
  });

  it('staging/production 强制独立能力 Base URL 使用 https', () => {
    for (const environment of ['staging', 'production'] as const) {
      const result = parseCapabilityConfiguration(
        speechOverride({
          MODEL_GATEWAY_SPEECH_BASE_URL: 'http://insecure.invalid',
        }),
        'speech',
        'openai-compatible',
        environment,
      );
      expect(result).toEqual({ kind: 'disabled' });
    }
  });

  it('完整 override 的 trailing slash 被归一化', () => {
    const result = parseCapabilityConfiguration(
      speechOverride({
        MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech-provider.invalid/v1/',
      }),
      'speech',
      'openai-compatible',
      'local',
    );
    expect(result).toMatchObject({
      kind: 'overridden',
      override: { baseUrl: 'https://speech-provider.invalid/v1' },
    });
  });

  it('未配置能力时 timeout 使用能力专属默认值', () => {
    const result = parseCapabilityConfiguration(
      speechOverride(),
      'speech',
      'openai-compatible',
      'local',
    );
    expect(result).toMatchObject({
      kind: 'overridden',
      override: { timeoutMs: 60_000 },
    });
  });

  it('transcription 默认超时与 config-media 一致', () => {
    const result = parseCapabilityConfiguration(
      {
        MODEL_GATEWAY_TRANSCRIPTION_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_TRANSCRIPTION_MODEL: 'whisper-model',
        MODEL_GATEWAY_TRANSCRIPTION_BASE_URL: 'https://transcribe.invalid/v1',
        MODEL_GATEWAY_TRANSCRIPTION_API_KEY: 'transcribe-key',
      },
      'transcription',
      'openai-compatible',
      'local',
    );
    expect(result).toMatchObject({
      kind: 'overridden',
      override: { timeoutMs: 120_000 },
    });
  });
});
