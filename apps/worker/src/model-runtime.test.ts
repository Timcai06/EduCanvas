import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelGatewayEnvironment } from '@educanvas/model-gateway';
import {
  createWorkerModelRuntime,
  resolveEmbeddingModelGateway,
  resolveSpeechModelGateway,
  resolveStructuredModelGateway,
} from './model-runtime';

/**
 * R03：Worker 组合根单次解析与能力降级。
 *
 * - `createWorkerModelRuntime(env)` 任务级入口：一次解析主配置，全部能力共享
 *   同一配置对象，多能力访问不增加解析次数；
 * - 单项能力配置错误只关闭该能力（返回 null），不污染文本与其他能力；
 * - 结果完全由注入的环境 Record 决定，不触碰 `process.env`；
 * - 既有 `resolve*` 单次调用恰好解析一次主配置。
 *
 * 禁止用全局可变缓存掩盖重复解析：只计数纯函数调用，不引入模块级缓存。
 */
const { parseSpy } = vi.hoisted(() => ({ parseSpy: vi.fn() }));

vi.mock(
  '../../../packages/model-gateway/src/config',
  async (importOriginal) => {
    const original =
      await importOriginal<typeof import('@educanvas/model-gateway')>();
    return {
      ...original,
      parseModelGatewayConfiguration: (
        environment: ModelGatewayEnvironment,
      ) => {
        parseSpy(environment);
        return original.parseModelGatewayConfiguration(environment);
      },
    };
  },
);

const openAICompatibleEnvironment = (
  overrides: ModelGatewayEnvironment = {},
): ModelGatewayEnvironment => ({
  EDUCANVAS_DEPLOYMENT_ENV: 'local',
  MODEL_GATEWAY_PROVIDER: 'openai-compatible',
  MODEL_GATEWAY_BASE_URL: 'https://primary.invalid/v1',
  MODEL_GATEWAY_API_KEY: 'primary-fixture-key',
  MODEL_GATEWAY_PRIMARY_MODEL: 'primary-text-model',
  ...overrides,
});

const deepSeekEnvironment = (
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

const modelGatewayEnvKeys = [
  'EDUCANVAS_DEPLOYMENT_ENV',
  'MODEL_GATEWAY_PROVIDER',
  'MODEL_GATEWAY_RUNTIME',
  'MODEL_GATEWAY_ALLOW_DEEPSEEK',
  'MODEL_GATEWAY_BASE_URL',
  'MODEL_GATEWAY_API_KEY',
  'MODEL_GATEWAY_PRIMARY_MODEL',
  'MODEL_GATEWAY_FAST_MODEL',
  'MODEL_GATEWAY_STRUCTURED_MODEL',
  'MODEL_GATEWAY_SPEECH_PROVIDER',
  'MODEL_GATEWAY_SPEECH_MODEL',
  'MODEL_GATEWAY_SPEECH_BASE_URL',
  'MODEL_GATEWAY_SPEECH_API_KEY',
  'MODEL_GATEWAY_TRANSCRIPTION_PROVIDER',
  'MODEL_GATEWAY_TRANSCRIPTION_MODEL',
  'MODEL_GATEWAY_TRANSCRIPTION_BASE_URL',
  'MODEL_GATEWAY_TRANSCRIPTION_API_KEY',
  'MODEL_GATEWAY_EMBEDDING_PROVIDER',
  'MODEL_GATEWAY_EMBEDDING_MODEL',
  'MODEL_GATEWAY_EMBEDDING_BASE_URL',
  'MODEL_GATEWAY_EMBEDDING_API_KEY',
  'MODEL_GATEWAY_EMBEDDING_MODEL_VERSION',
  'MODEL_GATEWAY_IMAGE_PROVIDER',
  'MODEL_GATEWAY_IMAGE_MODEL',
  'MODEL_GATEWAY_IMAGE_BASE_URL',
  'MODEL_GATEWAY_IMAGE_API_KEY',
  'MODEL_GATEWAY_TIMEOUT_MS',
  'MODEL_GATEWAY_MAX_OUTPUT_TOKENS',
  'MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS',
] as const;

const savedEnvironment = new Map(
  modelGatewayEnvKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  parseSpy.mockClear();
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('createWorkerModelRuntime 任务级单次解析（R03）', () => {
  it('一次构造只解析一次主配置，全部能力共享同一配置对象', () => {
    const runtime = createWorkerModelRuntime(
      openAICompatibleEnvironment({
        MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
        MODEL_GATEWAY_EMBEDDING_MODEL: 'embedding-model',
        MODEL_GATEWAY_EMBEDDING_MODEL_VERSION: '2026-05-01',
      }),
    );
    expect(runtime.structured).not.toBeNull();
    expect(runtime.speech).not.toBeNull();
    expect(runtime.embedding).not.toBeNull();
    expect(runtime.embeddingIdentity).not.toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('未配置主 Provider 时全部能力诚实关闭', () => {
    const runtime = createWorkerModelRuntime({});
    expect(runtime.structured).toBeNull();
    expect(runtime.speech).toBeNull();
    expect(runtime.transcription).toBeNull();
    expect(runtime.image).toBeNull();
    expect(runtime.embedding).toBeNull();
    expect(runtime.embeddingIdentity).toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });
});

describe('能力降级矩阵：单项失败不污染其他能力', () => {
  it('speech override 半配置只关闭 speech，embedding 与文本不受影响', () => {
    const runtime = createWorkerModelRuntime(
      openAICompatibleEnvironment({
        /* speech override 缺 API Key：该能力必须关闭。 */
        MODEL_GATEWAY_SPEECH_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
        MODEL_GATEWAY_SPEECH_BASE_URL: 'https://speech.invalid/v1',
        /* embedding 完整配置：不受 speech 错误影响。 */
        MODEL_GATEWAY_EMBEDDING_MODEL: 'embedding-model',
        MODEL_GATEWAY_EMBEDDING_MODEL_VERSION: '2026-05-01',
      }),
    );
    expect(runtime.speech).toBeNull();
    expect(runtime.embedding).not.toBeNull();
    expect(runtime.embeddingIdentity?.embeddingModel).toBe('embedding-model');
    expect(runtime.structured).not.toBeNull();
  });

  it('embedding 模型未声明版本只关闭 embedding，其他能力保持可用', () => {
    const runtime = createWorkerModelRuntime(
      openAICompatibleEnvironment({
        MODEL_GATEWAY_EMBEDDING_MODEL: 'embedding-model',
        MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
      }),
    );
    expect(runtime.embedding).toBeNull();
    expect(runtime.embeddingIdentity).toBeNull();
    expect(runtime.speech).not.toBeNull();
    expect(runtime.structured).not.toBeNull();
  });

  it('DeepSeek 主 Provider 下未 override 的媒体能力全部关闭', () => {
    const runtime = createWorkerModelRuntime(deepSeekEnvironment());
    expect(runtime.structured).not.toBeNull();
    expect(runtime.speech).toBeNull();
    expect(runtime.transcription).toBeNull();
    expect(runtime.image).toBeNull();
    expect(runtime.embedding).toBeNull();
  });
});

describe('注入纪律：Worker 组合根不读取 process.env', () => {
  it('process.env 清空后注入配置仍然生效', () => {
    for (const key of modelGatewayEnvKeys) delete process.env[key];
    const runtime = createWorkerModelRuntime(deepSeekEnvironment());
    expect(runtime.structured).not.toBeNull();
    /* DeepSeek 文本模型不受 process.env 干扰，能力按注入配置关闭。 */
    expect(runtime.speech).toBeNull();
  });

  it('process.env 与注入配置不一致时以注入为准', () => {
    for (const key of modelGatewayEnvKeys) delete process.env[key];
    process.env.MODEL_GATEWAY_PROVIDER = 'openai-compatible';
    process.env.MODEL_GATEWAY_BASE_URL = 'https://polluted.invalid/v1';
    process.env.MODEL_GATEWAY_API_KEY = 'polluted-key';
    process.env.MODEL_GATEWAY_PRIMARY_MODEL = 'polluted-model';
    process.env.EDUCANVAS_DEPLOYMENT_ENV = 'local';

    const runtime = createWorkerModelRuntime(deepSeekEnvironment());
    expect(runtime.structured).not.toBeNull();
    /* 若组合根误读 process.env，embedding 会因 openai-compatible 而可用——注入的
     * DeepSeek 主配置下它必须关闭。 */
    expect(runtime.embedding).toBeNull();
  });
});

describe('既有 resolve* 单次调用恰好解析一次', () => {
  it('resolveStructuredModelGateway 每次调用解析主配置一次', () => {
    for (const key of modelGatewayEnvKeys) delete process.env[key];
    for (const [key, value] of Object.entries(
      openAICompatibleEnvironment({
        MODEL_GATEWAY_SPEECH_MODEL: 'speech-model',
      }),
    )) {
      if (value !== undefined) process.env[key] = value;
    }
    expect(resolveStructuredModelGateway()).not.toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpeechModelGateway()).not.toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  it('resolveEmbeddingModelGateway 与 identity 各自解析但不共享缓存', () => {
    for (const key of modelGatewayEnvKeys) delete process.env[key];
    for (const [key, value] of Object.entries(
      openAICompatibleEnvironment({
        MODEL_GATEWAY_EMBEDDING_MODEL: 'embedding-model',
        MODEL_GATEWAY_EMBEDDING_MODEL_VERSION: '2026-05-01',
      }),
    )) {
      if (value !== undefined) process.env[key] = value;
    }
    expect(resolveEmbeddingModelGateway()).not.toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });
});
