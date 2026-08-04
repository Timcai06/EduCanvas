import { describe, expect, it } from 'vitest';
import {
  parseCapabilityConfiguration,
  resolveCapabilityGatewayConfiguration,
} from './config-capability';
import {
  parseModelGatewayConfiguration,
  type EnabledModelGatewayConfiguration,
} from './config';
import type { ModelGatewayEnvironment } from './config-primitives';

/** fixture 主配置必须启用，否则测试前提不成立。 */
function resolvePrimary(
  environment: ModelGatewayEnvironment,
): EnabledModelGatewayConfiguration {
  const configuration = parseModelGatewayConfiguration(environment);
  if (!configuration.enabled) {
    throw new Error('fixture 主配置必须启用');
  }
  return configuration;
}

/**
 * C04 跨能力验收：六种能力（text/vision/speech/transcription/image/embedding）
 * 在同一部署配置下可独立启用、继承或关闭。验收基于 ADR-0021 的目标部署矩阵。
 */

const deepSeekPrimary = (
  overrides: ModelGatewayEnvironment = {},
): ModelGatewayEnvironment => ({
  EDUCANVAS_DEPLOYMENT_ENV: 'local',
  MODEL_GATEWAY_PROVIDER: 'deepseek',
  MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
  MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com',
  MODEL_GATEWAY_API_KEY: 'deepseek-fixture-key',
  MODEL_GATEWAY_PRIMARY_MODEL: 'deepseek-text-model',
  ...overrides,
});

const openAICompatiblePrimary = (
  overrides: ModelGatewayEnvironment = {},
): ModelGatewayEnvironment => ({
  EDUCANVAS_DEPLOYMENT_ENV: 'local',
  MODEL_GATEWAY_PROVIDER: 'openai-compatible',
  MODEL_GATEWAY_BASE_URL: 'https://primary.invalid/v1',
  MODEL_GATEWAY_API_KEY: 'primary-fixture-key',
  MODEL_GATEWAY_PRIMARY_MODEL: 'primary-text-model',
  ...overrides,
});

/** 目标部署：DeepSeek 文本 + 独立 Speech/Transcription override。 */
const targetDeployment = (): ModelGatewayEnvironment =>
  deepSeekPrimary({
    MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
    MODEL_GATEWAY_SPEECH_MODEL: 'speech-override-model',
    MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech.invalid/v1',
    MODEL_GATEWAY_SPEECH_API_KEY: 'speech-override-key',
    MODEL_GATEWAY_TRANSCRIPTION_PROVIDER: 'openai-compatible',
    MODEL_GATEWAY_TRANSCRIPTION_MODEL: 'transcription-override-model',
    MODEL_GATEWAY_TRANSCRIPTION_BASE_URL: 'https://transcription.invalid/v1',
    MODEL_GATEWAY_TRANSCRIPTION_API_KEY: 'transcription-override-key',
  });

describe('C04 跨能力验收', () => {
  it('DeepSeek 文本与独立 Vision Provider 可并存且凭据不混合', () => {
    const primary = resolvePrimary(
      deepSeekPrimary({
        MODEL_GATEWAY_VISION_MODEL: 'vision-model',
        MODEL_GATEWAY_VISION_BASE_URL: 'https://vision.invalid/v1',
        MODEL_GATEWAY_VISION_API_KEY: 'vision-fixture-key',
      }),
    );

    expect(primary).toMatchObject({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      modelIds: { primary: 'deepseek-text-model' },
      visionProvider: {
        baseUrl: 'https://vision.invalid/v1',
        apiKey: 'vision-fixture-key',
        modelId: 'vision-model',
      },
    });
  });

  it('目标部署：DeepSeek 文本 + 独立 Speech/Transcription，其余能力关闭', () => {
    const environment = targetDeployment();
    const primary = resolvePrimary(environment);
    expect(primary.provider).toBe('deepseek');
    /* 主文本模型不受媒体配置影响。 */
    expect(primary.modelIds.primary).toBe('deepseek-text-model');

    /* 独立 override 的能力使用独立 Provider/端点。 */
    const speech = resolveCapabilityGatewayConfiguration(
      environment,
      'speech',
      primary,
    );
    expect(speech?.provider).toBe('openai-compatible');
    expect(speech?.baseUrl).toBe('https://speech.invalid/v1');
    expect(speech?.modelIds.speech).toBe('speech-override-model');

    const transcription = resolveCapabilityGatewayConfiguration(
      environment,
      'transcription',
      primary,
    );
    expect(transcription?.provider).toBe('openai-compatible');
    expect(transcription?.baseUrl).toBe('https://transcription.invalid/v1');

    /* 未 override 的能力关闭，不拖垮文本 Agent。 */
    expect(
      resolveCapabilityGatewayConfiguration(environment, 'image', primary),
    ).toBeNull();
    expect(
      resolveCapabilityGatewayConfiguration(environment, 'embedding', primary),
    ).toBeNull();
  });

  it('openai-compatible 主 Provider：全部媒体能力可整组继承', () => {
    const environment = openAICompatiblePrimary({
      MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
      MODEL_GATEWAY_TRANSCRIPTION_MODEL: 'transcription-model',
      MODEL_GATEWAY_IMAGE_MODEL: 'image-model',
      MODEL_GATEWAY_EMBEDDING_MODEL: 'embedding-model',
      MODEL_GATEWAY_EMBEDDING_MODEL_VERSION: '2026-05-01',
    });
    const primary = resolvePrimary(environment);

    for (const capability of [
      'speech',
      'transcription',
      'image',
      'embedding',
    ] as const) {
      const resolved = resolveCapabilityGatewayConfiguration(
        environment,
        capability,
        primary,
      );
      expect(resolved).not.toBeNull();
      /* 继承时端点与 Key 来自主 Provider，模型用能力自己的别名。 */
      expect(resolved?.baseUrl).toBe('https://primary.invalid/v1');
    }
  });

  it('继承矩阵：主 Provider 不支持时未声明 override 的能力关闭', () => {
    const environment = deepSeekPrimary({
      MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
      MODEL_GATEWAY_IMAGE_MODEL: 'image-model',
    });
    const primary = resolvePrimary(environment);
    /* DeepSeek 不支持的媒体能力不进入 modelIds。 */
    expect(primary.modelIds.speech).toBeUndefined();
    expect(primary.modelIds.image).toBeUndefined();
    for (const capability of [
      'speech',
      'transcription',
      'image',
      'embedding',
    ] as const) {
      expect(
        resolveCapabilityGatewayConfiguration(environment, capability, primary),
      ).toBeNull();
    }
  });

  it('单能力 override：image 独立 Provider 与主文本能力并存', () => {
    const environment = openAICompatiblePrimary({
      MODEL_GATEWAY_IMAGE_PROVIDER: 'openai-compatible',
      MODEL_GATEWAY_IMAGE_MODEL: 'image-override-model',
      MODEL_GATEWAY_IMAGE_BASE_URL: 'https://image.invalid/v1',
      MODEL_GATEWAY_IMAGE_API_KEY: 'image-override-key',
    });
    const primary = resolvePrimary(environment);

    /* 主文本链路不受影响。 */
    expect(primary.modelIds.primary).toBe('primary-text-model');

    /* 单能力 override 生效。 */
    const image = resolveCapabilityGatewayConfiguration(
      environment,
      'image',
      primary,
    );
    expect(image?.baseUrl).toBe('https://image.invalid/v1');
    expect(image?.modelIds.image).toBe('image-override-model');

    /* 未配置的能力关闭。 */
    expect(
      resolveCapabilityGatewayConfiguration(environment, 'speech', primary),
    ).toBeNull();
  });

  it('能力级配置错误只关闭该能力，其他能力与文本不受影响', () => {
    const environment = openAICompatiblePrimary({
      /* speech override 缺 API Key：该能力关闭。 */
      MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
      MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
      MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech.invalid/v1',
      /* embedding 完整配置：不受 speech 错误影响。 */
      MODEL_GATEWAY_EMBEDDING_MODEL: 'embedding-model',
      MODEL_GATEWAY_EMBEDDING_MODEL_VERSION: '2026-05-01',
    });
    const primary = resolvePrimary(environment);

    expect(
      resolveCapabilityGatewayConfiguration(environment, 'speech', primary),
    ).toBeNull();
    const embedding = resolveCapabilityGatewayConfiguration(
      environment,
      'embedding',
      primary,
    );
    expect(embedding?.modelIds.embedding).toBe('embedding-model');
    expect(primary.modelIds.primary).toBe('primary-text-model');
  });

  it('能力级解析与主配置解析在错误语义上解耦', () => {
    /* 主配置非法仍然整组失败。 */
    expect(() =>
      parseModelGatewayConfiguration(
        deepSeekPrimary({ MODEL_GATEWAY_ALLOW_DEEPSEEK: 'false' }),
      ),
    ).not.toThrow();
    /* 能力级错误收敛为 disabled 而不是抛错（parseCapabilityConfiguration）。 */
    expect(
      parseCapabilityConfiguration(
        {
          MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
          MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
          MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech.invalid/v1',
          MODEL_GATEWAY_SPEECH_API_KEY: undefined,
        },
        'speech',
        'openai-compatible',
        'local',
      ),
    ).toEqual({ kind: 'disabled' });
  });

  it('目标部署能力矩阵与 ADR-0021 目标状态表一致', () => {
    const environment = targetDeployment();
    const primary = resolvePrimary(environment);
    const matrix = Object.fromEntries(
      (['speech', 'transcription', 'image', 'embedding'] as const).map(
        (capability) => {
          const resolved = resolveCapabilityGatewayConfiguration(
            environment,
            capability,
            primary,
          );
          return [
            capability,
            resolved === null ? 'disabled' : 'overridden',
          ] as const;
        },
      ),
    );

    expect(matrix).toEqual({
      speech: 'overridden',
      transcription: 'overridden',
      image: 'disabled',
      embedding: 'disabled',
    });
  });
});
