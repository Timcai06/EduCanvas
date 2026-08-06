import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiSdkTurnModelGateway } from './ai-sdk-turn-model-gateway';
import { OpenAICompatibleTurnModelGateway } from './openai-compatible-turn-model-gateway';
import {
  createTurnModelGateway,
  createTurnModelGatewayFromEnvironment,
  createVisionTurnModelGateway,
} from './turn-model-gateway-factory';
import type { EnabledModelGatewayConfiguration } from './config';
import type { ModelGatewayEnvironment } from './config-primitives';

/**
 * R03：组合根只解析一次配置。用 spy 计数证明 Factory 的两种入口语义——
 * `createTurnModelGateway(config)` 接收已验证配置、内部绝不再次解析；
 * `createTurnModelGatewayFromEnvironment(env)` 只作组合根便捷入口、恰好解析一次。
 * 禁止用全局可变缓存掩盖重复解析：这里只计数纯函数调用，不引入模块级缓存。
 */
const { parseSpy } = vi.hoisted(() => ({ parseSpy: vi.fn() }));

vi.mock('./config', async (importOriginal) => {
  const original = await importOriginal<typeof import('./config')>();
  return {
    ...original,
    parseModelGatewayConfiguration: (environment: ModelGatewayEnvironment) => {
      parseSpy(environment);
      return original.parseModelGatewayConfiguration(environment);
    },
  };
});

const environment = (
  runtime: 'native' | 'ai-sdk',
): ModelGatewayEnvironment => ({
  EDUCANVAS_DEPLOYMENT_ENV: 'local',
  MODEL_GATEWAY_PROVIDER: 'deepseek',
  MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
  MODEL_GATEWAY_RUNTIME: runtime,
  MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com',
  MODEL_GATEWAY_API_KEY: 'fixture-key-never-real',
  MODEL_GATEWAY_PRIMARY_MODEL: 'explicitly-configured-model',
});

/** 手工构造的已验证配置：字段完整，与任何环境变量无关。 */
const verifiedConfiguration = (
  runtime: 'native' | 'ai-sdk' = 'native',
): EnabledModelGatewayConfiguration => ({
  enabled: true,
  environment: 'local',
  provider: 'deepseek',
  runtime,
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'fixture-key-never-real',
  modelIds: { primary: 'explicitly-configured-model' },
  timeoutMs: 30_000,
  maxOutputTokens: 2_048,
  visionEnabled: false,
  visionProvider: null,
  disableThinking: false,
  speechVoice: 'alloy',
  speechTimeoutMs: 60_000,
  speechMaxInputChars: 3_500,
  transcriptionTimeoutMs: 120_000,
  transcriptionMaxInputBytes: 25 * 1024 * 1024,
  imageTimeoutMs: 120_000,
  imageMaxOutputBytes: 8 * 1024 * 1024,
  embeddingModelVersion: null,
  embeddingTimeoutMs: 60_000,
  embeddingMaxBatch: 64,
});

afterEach(() => {
  parseSpy.mockClear();
});

describe('createTurnModelGateway（已验证配置入口）', () => {
  it('接收已验证配置直接构造，内部不再解析环境', () => {
    const gateway = createTurnModelGateway(verifiedConfiguration());
    expect(gateway).toBeInstanceOf(OpenAICompatibleTurnModelGateway);
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it('ai-sdk 运行时同样由配置决定，不依赖环境解析', () => {
    const gateway = createTurnModelGateway(verifiedConfiguration('ai-sdk'));
    expect(gateway).toBeInstanceOf(AiSdkTurnModelGateway);
    expect(parseSpy).not.toHaveBeenCalled();
  });
});

describe('createTurnModelGatewayFromEnvironment（组合根便捷入口）', () => {
  it('每次调用恰好解析一次环境', () => {
    expect(
      createTurnModelGatewayFromEnvironment(environment('native')),
    ).toBeInstanceOf(OpenAICompatibleTurnModelGateway);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('默认与显式 native 都构造原生回滚 Adapter', () => {
    const values = environment('native');
    expect(
      createTurnModelGatewayFromEnvironment({
        ...values,
        MODEL_GATEWAY_RUNTIME: undefined,
      }),
    ).toBeInstanceOf(OpenAICompatibleTurnModelGateway);
    expect(createTurnModelGatewayFromEnvironment(values)).toBeInstanceOf(
      OpenAICompatibleTurnModelGateway,
    );
  });

  it('仅在显式 ai-sdk 时构造 SDK Adapter 且不发起网络', () => {
    expect(
      createTurnModelGatewayFromEnvironment(environment('ai-sdk')),
    ).toBeInstanceOf(AiSdkTurnModelGateway);
  });
});

describe('Factory 不触碰 process.env（R03 注入纪律）', () => {
  it('process.env 被清空时注入配置仍然生效', () => {
    const keys = [
      'EDUCANVAS_DEPLOYMENT_ENV',
      'MODEL_GATEWAY_PROVIDER',
      'MODEL_GATEWAY_ALLOW_DEEPSEEK',
      'MODEL_GATEWAY_RUNTIME',
      'MODEL_GATEWAY_BASE_URL',
      'MODEL_GATEWAY_API_KEY',
      'MODEL_GATEWAY_PRIMARY_MODEL',
    ] as const;
    const saved = new Map(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) delete process.env[key];
      const gateway = createTurnModelGatewayFromEnvironment(
        environment('native'),
      );
      expect(gateway).toBeInstanceOf(OpenAICompatibleTurnModelGateway);
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('已验证配置入口与 process.env 完全无关', () => {
    const gateway = createTurnModelGateway(verifiedConfiguration());
    expect(gateway).toBeInstanceOf(OpenAICompatibleTurnModelGateway);
    expect(parseSpy).not.toHaveBeenCalled();
  });
});

describe('createVisionTurnModelGateway（已验证配置入口）', () => {
  it('有视觉 Provider 时从配置投影构造，不再次解析环境', () => {
    const configuration = {
      ...verifiedConfiguration(),
      visionProvider: {
        baseUrl: 'https://vision.invalid/api/paas/v4',
        apiKey: 'fixture-vision-key-never-real',
        modelId: 'vision-model-explicit',
        timeoutMs: 120_000,
        maxOutputTokens: 2_048,
        disableThinking: false,
      },
    };
    const gateway = createVisionTurnModelGateway(configuration);
    expect(gateway).toBeInstanceOf(OpenAICompatibleTurnModelGateway);
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it('无视觉 Provider 时返回 null 且不解析环境', () => {
    expect(createVisionTurnModelGateway(verifiedConfiguration())).toBeNull();
    expect(parseSpy).not.toHaveBeenCalled();
  });
});
