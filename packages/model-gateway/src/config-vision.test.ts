import { describe, expect, it } from 'vitest';
import {
  acceptsImageInput,
  ModelGatewayConfigurationError,
  parseModelGatewayConfiguration,
  type ModelGatewayConfigurationErrorCode,
  type ModelGatewayEnvironment,
} from './config';

const deepSeekEnvironment = (
  overrides: ModelGatewayEnvironment = {},
): ModelGatewayEnvironment => ({
  EDUCANVAS_DEPLOYMENT_ENV: 'local',
  MODEL_GATEWAY_PROVIDER: 'deepseek',
  MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
  MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com',
  MODEL_GATEWAY_API_KEY: 'fixture-key-never-real',
  MODEL_GATEWAY_PRIMARY_MODEL: 'explicitly-configured-model',
  ...overrides,
});

const withVision = (
  overrides: ModelGatewayEnvironment = {},
): ModelGatewayEnvironment =>
  deepSeekEnvironment({
    MODEL_GATEWAY_VISION_MODEL: 'vision-model-explicit',
    MODEL_GATEWAY_VISION_BASE_URL: 'https://vision.invalid/api/paas/v4',
    MODEL_GATEWAY_VISION_API_KEY: 'fixture-vision-key-never-real',
    ...overrides,
  });

const expectCode = (
  environment: ModelGatewayEnvironment,
  code: ModelGatewayConfigurationErrorCode,
): void => {
  expect(() => parseModelGatewayConfiguration(environment)).toThrowError(
    expect.objectContaining<Partial<ModelGatewayConfigurationError>>({ code }),
  );
};

describe('视觉Provider配置', () => {
  it('未配置视觉模型时视觉Provider不存在', () => {
    const config = parseModelGatewayConfiguration(deepSeekEnvironment());

    expect(config).toMatchObject({ enabled: true, visionProvider: null });
    expect(acceptsImageInput(config)).toBe(false);
  });

  it('配置完整时解析出独立的Base URL、Key与模型', () => {
    const config = parseModelGatewayConfiguration(withVision());

    expect(config).toMatchObject({
      enabled: true,
      /* 主Provider保持DeepSeek不变，视觉只是并列的第二条链路。 */
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      visionProvider: {
        baseUrl: 'https://vision.invalid/api/paas/v4',
        apiKey: 'fixture-vision-key-never-real',
        modelId: 'vision-model-explicit',
        timeoutMs: 120_000,
        maxOutputTokens: 2_048,
      },
    });
    expect(acceptsImageInput(config)).toBe(true);
  });

  it('主Provider自带读图能力时也接受图片输入', () => {
    const config = parseModelGatewayConfiguration(
      deepSeekEnvironment({ MODEL_GATEWAY_VISION: 'true' }),
    );

    expect(config).toMatchObject({ visionEnabled: true, visionProvider: null });
    expect(acceptsImageInput(config)).toBe(true);
  });

  it('禁用的配置一律不接受图片输入', () => {
    expect(acceptsImageInput(parseModelGatewayConfiguration({}))).toBe(false);
  });

  /* 半配置状态会让部署以为图片可用，直到学生真传了一张图才在Turn中途失败。 */
  it('配置了视觉模型却缺少Base URL时立即失败', () => {
    expectCode(
      withVision({ MODEL_GATEWAY_VISION_BASE_URL: undefined }),
      'MISSING_VISION_BASE_URL',
    );
  });

  it('配置了视觉模型却缺少API Key时立即失败', () => {
    expectCode(
      withVision({ MODEL_GATEWAY_VISION_API_KEY: undefined }),
      'MISSING_VISION_API_KEY',
    );
  });

  it.each([
    ['内嵌凭据', 'https://user:pass@vision.invalid/v1'],
    ['查询串', 'https://vision.invalid/v1?key=leak'],
    ['片段', 'https://vision.invalid/v1#frag'],
    ['非HTTP协议', 'ftp://vision.invalid/v1'],
    ['不可解析', 'not-a-url'],
  ])('视觉Base URL含%s时拒绝', (_label, baseUrl) => {
    expectCode(
      withVision({ MODEL_GATEWAY_VISION_BASE_URL: baseUrl }),
      'INVALID_VISION_BASE_URL',
    );
  });

  it('staging环境的视觉端点必须是HTTPS', () => {
    expectCode(
      withVision({
        EDUCANVAS_DEPLOYMENT_ENV: 'staging',
        MODEL_GATEWAY_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_BASE_URL: 'https://provider.invalid/v1',
        MODEL_GATEWAY_ALLOW_DEEPSEEK: undefined,
        MODEL_GATEWAY_VISION_BASE_URL: 'http://vision.invalid/v1',
      }),
      'INVALID_VISION_BASE_URL',
    );
  });

  /* 两种视觉来源同时声明说明部署方有两种矛盾预期，替它猜一个比直接失败更危险。 */
  it('主Provider读图与独立视觉Provider不能同时声明', () => {
    expectCode(
      withVision({ MODEL_GATEWAY_VISION: 'true' }),
      'VISION_PROVIDER_CONFLICT',
    );
  });

  it.each([
    ['MODEL_GATEWAY_VISION_TIMEOUT_MS', '4999', 'INVALID_VISION_TIMEOUT'],
    ['MODEL_GATEWAY_VISION_TIMEOUT_MS', '300001', 'INVALID_VISION_TIMEOUT'],
    [
      'MODEL_GATEWAY_VISION_MAX_OUTPUT_TOKENS',
      '0',
      'INVALID_VISION_MAX_OUTPUT_TOKENS',
    ],
    [
      'MODEL_GATEWAY_VISION_MAX_OUTPUT_TOKENS',
      '65537',
      'INVALID_VISION_MAX_OUTPUT_TOKENS',
    ],
  ] as const)('%s=%s越界时拒绝', (key, value, code) => {
    expectCode(withVision({ [key]: value }), code);
  });

  it('视觉模型ID沿用统一的形状校验', () => {
    expectCode(
      withVision({ MODEL_GATEWAY_VISION_MODEL: '非法模型名' }),
      'INVALID_MODEL_ID',
    );
  });

  it('视觉Base URL的尾部斜杠被归一化', () => {
    const config = parseModelGatewayConfiguration(
      withVision({
        MODEL_GATEWAY_VISION_BASE_URL: 'https://vision.invalid/v1/',
      }),
    );

    expect(config).toMatchObject({
      visionProvider: { baseUrl: 'https://vision.invalid/v1' },
    });
  });
});
