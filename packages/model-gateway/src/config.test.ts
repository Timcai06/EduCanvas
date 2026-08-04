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
        MODEL_GATEWAY_TRANSCRIPTION_MODEL: 'transcription-explicit',
        MODEL_GATEWAY_TRANSCRIPTION_TIMEOUT_MS: '90000',
        MODEL_GATEWAY_TRANSCRIPTION_MAX_INPUT_BYTES: '10485760',
      }),
    ).toMatchObject({
      enabled: true,
      modelIds: {
        primary: 'primary-explicit',
        fast: 'fast-explicit',
        speech: 'speech-explicit',
        transcription: 'transcription-explicit',
      },
      speechVoice: 'coral',
      speechTimeoutMs: 60_000,
      speechMaxInputChars: 3_500,
      transcriptionTimeoutMs: 90_000,
      transcriptionMaxInputBytes: 10 * 1024 * 1024,
    });
  });

  it('DeepSeek 主 Provider 下 speech alias 不产生别名且不整组失败（ADR-0021）', () => {
    const configuration = parseModelGatewayConfiguration(
      deepSeekEnvironment({ MODEL_GATEWAY_SPEECH_MODEL: 'tts-model' }),
    );
    expect(configuration.enabled).toBe(true);
    expect(
      (configuration as { modelIds: Record<string, string> }).modelIds.speech,
    ).toBeUndefined();
  });

  it('DeepSeek 主 Provider 下 transcription alias 不产生别名且不整组失败', () => {
    const configuration = parseModelGatewayConfiguration(
      deepSeekEnvironment({
        MODEL_GATEWAY_TRANSCRIPTION_MODEL: 'whisper-model',
      }),
    );
    expect(configuration.enabled).toBe(true);
    expect(
      (configuration as { modelIds: Record<string, string> }).modelIds
        .transcription,
    ).toBeUndefined();
  });

  it('DeepSeek 主 Provider 下 image alias 不产生别名且不整组失败', () => {
    const configuration = parseModelGatewayConfiguration(
      deepSeekEnvironment({ MODEL_GATEWAY_IMAGE_MODEL: 'image-model' }),
    );
    expect(configuration.enabled).toBe(true);
    expect(
      (configuration as { modelIds: Record<string, string> }).modelIds.image,
    ).toBeUndefined();
  });

  it('未配置 image 模型时不产生 image 别名，配置后使用显式上限', () => {
    const base = {
      EDUCANVAS_DEPLOYMENT_ENV: 'production',
      MODEL_GATEWAY_PROVIDER: 'openai-compatible',
      MODEL_GATEWAY_BASE_URL: 'https://provider.invalid/v1',
      MODEL_GATEWAY_API_KEY: 'fixture',
      MODEL_GATEWAY_PRIMARY_MODEL: 'primary-explicit',
    };

    expect(parseModelGatewayConfiguration(base)).toMatchObject({
      enabled: true,
      modelIds: { primary: 'primary-explicit' },
      imageTimeoutMs: 120_000,
      imageMaxOutputBytes: 8 * 1024 * 1024,
    });
    expect(
      (
        parseModelGatewayConfiguration(base) as {
          modelIds: Record<string, string>;
        }
      ).modelIds.image,
    ).toBeUndefined();

    expect(
      parseModelGatewayConfiguration({
        ...base,
        MODEL_GATEWAY_IMAGE_MODEL: 'image-explicit',
        MODEL_GATEWAY_IMAGE_TIMEOUT_MS: '90000',
        MODEL_GATEWAY_IMAGE_MAX_OUTPUT_BYTES: '2097152',
      }),
    ).toMatchObject({
      enabled: true,
      modelIds: { primary: 'primary-explicit', image: 'image-explicit' },
      imageTimeoutMs: 90_000,
      imageMaxOutputBytes: 2 * 1024 * 1024,
    });
  });

  it('DeepSeek 主 Provider 下 embedding alias 不产生别名且不整组失败', () => {
    const configuration = parseModelGatewayConfiguration(
      deepSeekEnvironment({ MODEL_GATEWAY_EMBEDDING_MODEL: 'embed-model' }),
    );
    expect(configuration.enabled).toBe(true);
    expect(
      (configuration as { modelIds: Record<string, string> }).modelIds
        .embedding,
    ).toBeUndefined();
  });

  it('配置 embedding 模型必须同时声明版本，否则向量无法判定可比较性', () => {
    const base = {
      EDUCANVAS_DEPLOYMENT_ENV: 'production',
      MODEL_GATEWAY_PROVIDER: 'openai-compatible',
      MODEL_GATEWAY_BASE_URL: 'https://provider.invalid/v1',
      MODEL_GATEWAY_API_KEY: 'fixture',
      MODEL_GATEWAY_PRIMARY_MODEL: 'primary-explicit',
    };

    /* 未启用向量检索的部署不被这个必填项卡住。 */
    expect(parseModelGatewayConfiguration(base)).toMatchObject({
      enabled: true,
      embeddingModelVersion: null,
      embeddingTimeoutMs: 60_000,
      embeddingMaxBatch: 64,
    });

    expect(() =>
      parseModelGatewayConfiguration({
        ...base,
        MODEL_GATEWAY_EMBEDDING_MODEL: 'embed-model',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ModelGatewayConfigurationError>>({
        code: 'MISSING_EMBEDDING_MODEL_VERSION',
      }),
    );

    expect(
      parseModelGatewayConfiguration({
        ...base,
        MODEL_GATEWAY_EMBEDDING_MODEL: 'embed-model',
        MODEL_GATEWAY_EMBEDDING_MODEL_VERSION: '2026-05-01',
        MODEL_GATEWAY_EMBEDDING_MAX_BATCH: '32',
      }),
    ).toMatchObject({
      modelIds: { embedding: 'embed-model' },
      embeddingModelVersion: '2026-05-01',
      embeddingMaxBatch: 32,
    });
  });

  it('越界的图像上限以稳定错误码拒绝', () => {
    for (const [key, code] of [
      ['MODEL_GATEWAY_IMAGE_TIMEOUT_MS', 'INVALID_IMAGE_TIMEOUT'],
      [
        'MODEL_GATEWAY_IMAGE_MAX_OUTPUT_BYTES',
        'INVALID_IMAGE_MAX_OUTPUT_BYTES',
      ],
    ] as const) {
      expect(() =>
        parseModelGatewayConfiguration({
          EDUCANVAS_DEPLOYMENT_ENV: 'production',
          MODEL_GATEWAY_PROVIDER: 'openai-compatible',
          MODEL_GATEWAY_BASE_URL: 'https://provider.invalid/v1',
          MODEL_GATEWAY_API_KEY: 'fixture',
          MODEL_GATEWAY_PRIMARY_MODEL: 'primary-explicit',
          [key]: '999999999',
        }),
      ).toThrowError(
        expect.objectContaining<Partial<ModelGatewayConfigurationError>>({
          code,
        }),
      );
    }
  });
});
