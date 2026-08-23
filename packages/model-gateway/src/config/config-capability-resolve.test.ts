import { describe, expect, it } from 'vitest';
import { resolveCapabilityGatewayConfiguration } from './config-capability';
import {
  parseModelGatewayConfiguration,
  type EnabledModelGatewayConfiguration,
} from './config';
import type { ModelGatewayEnvironment } from './config-primitives';

/** 主配置 fixture：openai-compatible 主 Provider，文本模型显式配置。 */
const primaryEnvironment = (
  overrides: ModelGatewayEnvironment = {},
): ModelGatewayEnvironment => ({
  EDUCANVAS_DEPLOYMENT_ENV: 'local',
  MODEL_GATEWAY_PROVIDER: 'openai-compatible',
  MODEL_GATEWAY_BASE_URL: 'https://primary.invalid/v1',
  MODEL_GATEWAY_API_KEY: 'primary-fixture-key',
  MODEL_GATEWAY_PRIMARY_MODEL: 'primary-model',
  ...overrides,
});

const resolvePrimary = (
  environmentValues: ModelGatewayEnvironment,
): EnabledModelGatewayConfiguration | null => {
  const configuration = parseModelGatewayConfiguration(environmentValues);
  return configuration.enabled ? configuration : null;
};

describe('resolveCapabilityGatewayConfiguration', () => {
  it('主配置未启用时能力一律不可用', () => {
    expect(
      resolveCapabilityGatewayConfiguration({}, 'speech', null),
    ).toBeNull();
  });

  it('继承主 Provider：未声明 override 且别名存在时返回主配置', () => {
    const environment = primaryEnvironment({
      MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
    });
    const resolved = resolveCapabilityGatewayConfiguration(
      environment,
      'speech',
      resolvePrimary(environment),
    );
    expect(resolved).not.toBeNull();
    expect(resolved?.modelIds.speech).toBe('speech-model');
    expect(resolved?.baseUrl).toBe('https://primary.invalid/v1');
  });

  it('继承主 Provider：未声明 override 且别名缺失时能力关闭', () => {
    const environment = primaryEnvironment();
    expect(
      resolveCapabilityGatewayConfiguration(
        environment,
        'speech',
        resolvePrimary(environment),
      ),
    ).toBeNull();
  });

  it('完整 override 投影独立 Base URL/Key/模型/超时，主凭据被替换', () => {
    const environment = primaryEnvironment({
      MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
      MODEL_GATEWAY_SPEECH_MODEL: 'speech-override-model',
      MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech-override.invalid/v1',
      MODEL_GATEWAY_SPEECH_API_KEY: 'speech-override-key',
      MODEL_GATEWAY_SPEECH_TIMEOUT_MS: '45000',
    });
    const resolved = resolveCapabilityGatewayConfiguration(
      environment,
      'speech',
      resolvePrimary(environment),
    );
    expect(resolved).toMatchObject({
      baseUrl: 'https://speech-override.invalid/v1',
      apiKey: 'speech-override-key',
      modelIds: { speech: 'speech-override-model' },
      speechTimeoutMs: 45_000,
    });
  });

  it('override 不改变主文本模型与其他别名', () => {
    const environment = primaryEnvironment({
      MODEL_GATEWAY_FAST_MODEL: 'fast-model',
      MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
      MODEL_GATEWAY_SPEECH_MODEL: 'speech-override-model',
      MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech-override.invalid/v1',
      MODEL_GATEWAY_SPEECH_API_KEY: 'speech-override-key',
    });
    const resolved = resolveCapabilityGatewayConfiguration(
      environment,
      'speech',
      resolvePrimary(environment),
    );
    expect(resolved?.modelIds.primary).toBe('primary-model');
    expect(resolved?.modelIds.fast).toBe('fast-model');
  });

  it('DeepSeek 主 Provider + 独立 speech override：文本 Agent 保持可用', () => {
    /* C04 目标部署：DeepSeek 文本 + 独立 Speech。 */
    const environment = {
      EDUCANVAS_DEPLOYMENT_ENV: 'local',
      MODEL_GATEWAY_PROVIDER: 'deepseek',
      MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
      MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com',
      MODEL_GATEWAY_API_KEY: 'deepseek-fixture-key',
      MODEL_GATEWAY_PRIMARY_MODEL: 'deepseek-model',
      MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
      MODEL_GATEWAY_SPEECH_MODEL: 'speech-override-model',
      MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech-override.invalid/v1',
      MODEL_GATEWAY_SPEECH_API_KEY: 'speech-override-key',
    };
    const primary = resolvePrimary(environment);
    expect(primary?.provider).toBe('deepseek');
    const resolved = resolveCapabilityGatewayConfiguration(
      environment,
      'speech',
      primary,
    );
    expect(resolved?.provider).toBe('openai-compatible');
    expect(resolved?.modelIds.speech).toBe('speech-override-model');
  });

  it('DeepSeek 主 Provider + 未声明 override：speech 能力关闭但文本可用', () => {
    const environment = {
      EDUCANVAS_DEPLOYMENT_ENV: 'local',
      MODEL_GATEWAY_PROVIDER: 'deepseek',
      MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
      MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com',
      MODEL_GATEWAY_API_KEY: 'deepseek-fixture-key',
      MODEL_GATEWAY_PRIMARY_MODEL: 'deepseek-model',
      MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
    };
    const primary = resolvePrimary(environment);
    expect(primary?.provider).toBe('deepseek');
    expect(
      resolveCapabilityGatewayConfiguration(environment, 'speech', primary),
    ).toBeNull();
  });

  it('能力级配置错误只关闭该能力，文本 Agent 不受影响', () => {
    /* override 缺 Key：speech 关闭，主配置仍然 enabled。 */
    const environment = primaryEnvironment({
      MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
      MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
      MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech.invalid/v1',
      MODEL_GATEWAY_SPEECH_API_KEY: undefined,
    });
    const primary = resolvePrimary(environment);
    expect(primary).not.toBeNull();
    expect(
      resolveCapabilityGatewayConfiguration(environment, 'speech', primary),
    ).toBeNull();
  });

  it.each([
    [
      'speech',
      'MODEL_GATEWAY_SPEECH_MODEL',
      'speech-model',
      'MODEL_GATEWAY_SPEECH_VOICE',
      'bad voice',
    ],
    [
      'transcription',
      'MODEL_GATEWAY_TRANSCRIPTION_MODEL',
      'transcription-model',
      'MODEL_GATEWAY_TRANSCRIPTION_MAX_INPUT_BYTES',
      '999999999',
    ],
    [
      'image',
      'MODEL_GATEWAY_IMAGE_MODEL',
      'image-model',
      'MODEL_GATEWAY_IMAGE_MAX_OUTPUT_BYTES',
      '999999999',
    ],
    [
      'embedding',
      'MODEL_GATEWAY_EMBEDDING_MODEL',
      'embedding-model',
      'MODEL_GATEWAY_EMBEDDING_MAX_BATCH',
      '999999999',
    ],
  ] as const)(
    '%s 配额非法时只关闭该能力，主文本配置保持 enabled',
    (capability, modelKey, model, invalidKey, invalidValue) => {
      const environment = primaryEnvironment({
        [modelKey]: model,
        ...(capability === 'embedding'
          ? { MODEL_GATEWAY_EMBEDDING_MODEL_VERSION: 'v1' }
          : {}),
        [invalidKey]: invalidValue,
      });
      const primary = resolvePrimary(environment);
      expect(primary).not.toBeNull();
      expect(primary?.modelIds.primary).toBe('primary-model');
      expect(
        resolveCapabilityGatewayConfiguration(environment, capability, primary),
      ).toBeNull();
    },
  );

  it('embedding 缺模型版本时只关闭 embedding，不拖垮文本配置', () => {
    const environment = primaryEnvironment({
      MODEL_GATEWAY_EMBEDDING_MODEL: 'embedding-model',
    });
    const primary = resolvePrimary(environment);
    expect(primary).not.toBeNull();
    expect(primary?.modelIds.primary).toBe('primary-model');
    expect(
      resolveCapabilityGatewayConfiguration(environment, 'embedding', primary),
    ).toBeNull();
  });

  it('非法媒体模型 ID 只关闭当前能力，不拖垮文本配置', () => {
    const environment = primaryEnvironment({
      MODEL_GATEWAY_SPEECH_MODEL: '非法 模型',
    });
    const primary = resolvePrimary(environment);
    expect(primary).not.toBeNull();
    expect(primary?.modelIds.primary).toBe('primary-model');
    expect(
      resolveCapabilityGatewayConfiguration(environment, 'speech', primary),
    ).toBeNull();
  });
});
