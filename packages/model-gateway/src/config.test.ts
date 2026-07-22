import { describe, expect, it } from 'vitest';
import {
  ModelGatewayConfigurationError,
  parseModelGatewayConfiguration,
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

describe('parseModelGatewayConfiguration', () => {
  it('未配置Provider时诚实返回disabled', () => {
    expect(parseModelGatewayConfiguration({})).toEqual({
      enabled: false,
      environment: 'local',
      reason: 'not_configured',
    });
  });

  it('启用真实Provider时必须显式声明部署环境以防生产误落入local策略', () => {
    expect(() =>
      parseModelGatewayConfiguration({
        MODEL_GATEWAY_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_BASE_URL: 'https://provider.invalid/v1',
        MODEL_GATEWAY_API_KEY: 'fixture',
        MODEL_GATEWAY_PRIMARY_MODEL: 'primary-explicit',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ModelGatewayConfigurationError>>({
        code: 'INVALID_ENVIRONMENT',
      }),
    );
  });

  it.each(['local', 'development', 'shared-dev', 'test'] as const)(
    'DeepSeek在%s环境默认关闭且必须显式启用',
    (environment) => {
      expect(
        parseModelGatewayConfiguration(
          deepSeekEnvironment({
            EDUCANVAS_DEPLOYMENT_ENV: environment,
            MODEL_GATEWAY_ALLOW_DEEPSEEK: undefined,
          }),
        ),
      ).toEqual({
        enabled: false,
        environment,
        reason: 'deepseek_not_enabled',
      });

      expect(
        parseModelGatewayConfiguration(
          deepSeekEnvironment({ EDUCANVAS_DEPLOYMENT_ENV: environment }),
        ),
      ).toMatchObject({
        enabled: true,
        provider: 'deepseek',
        runtime: 'native',
        modelIds: { primary: 'explicitly-configured-model' },
        timeoutMs: 30_000,
        maxOutputTokens: 2_048,
      });
    },
  );

  it('Turn Adapter默认native且只接受显式ai-sdk候选', () => {
    expect(
      parseModelGatewayConfiguration(
        deepSeekEnvironment({ MODEL_GATEWAY_RUNTIME: 'ai-sdk' }),
      ),
    ).toMatchObject({ enabled: true, runtime: 'ai-sdk' });
    expect(() =>
      parseModelGatewayConfiguration(
        deepSeekEnvironment({ MODEL_GATEWAY_RUNTIME: 'automatic' }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ModelGatewayConfigurationError>>({
        code: 'INVALID_RUNTIME',
      }),
    );
  });

  it.each(['staging', 'production'] as const)(
    '在%s环境硬拒绝DeepSeek，即使显式启用',
    (environment) => {
      expect(() =>
        parseModelGatewayConfiguration(
          deepSeekEnvironment({ EDUCANVAS_DEPLOYMENT_ENV: environment }),
        ),
      ).toThrowError(
        expect.objectContaining<Partial<ModelGatewayConfigurationError>>({
          code: 'DEEPSEEK_FORBIDDEN',
        }),
      );
    },
  );

  it('要求模型ID显式配置且不把供应商候选写成代码默认值', () => {
    expect(() =>
      parseModelGatewayConfiguration(
        deepSeekEnvironment({ MODEL_GATEWAY_PRIMARY_MODEL: undefined }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ModelGatewayConfigurationError>>({
        code: 'MISSING_PRIMARY_MODEL',
      }),
    );
  });

  it('配置异常不泄漏API Key、URL或模型值', () => {
    const secret = 'fixture-secret-never-log';
    let error: unknown;
    try {
      parseModelGatewayConfiguration(
        deepSeekEnvironment({
          MODEL_GATEWAY_API_KEY: secret,
          MODEL_GATEWAY_BASE_URL: 'not-a-valid-url-with-secret',
        }),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'INVALID_BASE_URL' });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(String(error)).not.toContain('not-a-valid-url-with-secret');
  });

  it('拒绝无法安全放入Authorization header的API Key且不回显', () => {
    const secret = 'fixture-secret\r\ninjected-header: true';
    let error: unknown;
    try {
      parseModelGatewayConfiguration(
        deepSeekEnvironment({ MODEL_GATEWAY_API_KEY: secret }),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'INVALID_API_KEY' });
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it('生产OpenAI-compatible路由要求HTTPS并解析可选alias', () => {
    expect(() =>
      parseModelGatewayConfiguration({
        EDUCANVAS_DEPLOYMENT_ENV: 'production',
        MODEL_GATEWAY_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_BASE_URL: 'http://provider.invalid',
        MODEL_GATEWAY_API_KEY: 'fixture',
        MODEL_GATEWAY_PRIMARY_MODEL: 'primary-explicit',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ModelGatewayConfigurationError>>({
        code: 'INVALID_BASE_URL',
      }),
    );

    expect(
      parseModelGatewayConfiguration({
        EDUCANVAS_DEPLOYMENT_ENV: 'production',
        MODEL_GATEWAY_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_BASE_URL: 'https://provider.invalid/v1',
        MODEL_GATEWAY_API_KEY: 'fixture',
        MODEL_GATEWAY_PRIMARY_MODEL: 'primary-explicit',
        MODEL_GATEWAY_FAST_MODEL: 'fast-explicit',
        MODEL_GATEWAY_SPEECH_MODEL: 'speech-explicit',
        MODEL_GATEWAY_SPEECH_VOICE: 'coral',
      }),
    ).toMatchObject({
      enabled: true,
      modelIds: {
        primary: 'primary-explicit',
        fast: 'fast-explicit',
        speech: 'speech-explicit',
      },
      speechVoice: 'coral',
      speechTimeoutMs: 60_000,
      speechMaxInputChars: 3_500,
    });
  });

  it('DeepSeek 不接受 speech alias，避免把不支持的端点当可用', () => {
    expect(() =>
      parseModelGatewayConfiguration(
        deepSeekEnvironment({ MODEL_GATEWAY_SPEECH_MODEL: 'tts-model' }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ModelGatewayConfigurationError>>({
        code: 'SPEECH_UNSUPPORTED_PROVIDER',
      }),
    );
  });
});
