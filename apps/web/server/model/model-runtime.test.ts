import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelGatewayConfigurationError } from '@educanvas/model-gateway';
import type { ModelGatewayEnvironment } from '@educanvas/model-gateway';
import { resolveTurnModelRuntime } from './model-runtime';

vi.mock('server-only', () => ({}));

/**
 * R03：Web 组合根每次 Turn 只解析一次配置。
 *
 * spy 计数 `parseModelGatewayConfiguration` 的调用次数，证明：
 * - 一次 `resolveTurnModelRuntime(env)` 只解析一次（当前实现会经主 Factory 与
 *   视觉 Factory 重复解析共 3 次，本测试先红后绿）；
 * - 结果完全由注入的环境 Record 决定，不触碰 `process.env`；
 * - 未配置时诚实返回 null，主配置非法只抛稳定错误码、不泄漏 secret。
 *
 * 禁止用全局可变缓存掩盖重复解析：本测试只计数纯函数调用。
 *
 * mock 必须落在 `config.ts` 模块 id 而不是包入口：主 Factory 与视觉 Factory
 * 经相对路径 `./config` 导入同一解析函数，只 mock 包入口会漏掉它们内部的解析。
 */
const { parseSpy } = vi.hoisted(() => ({ parseSpy: vi.fn() }));

vi.mock(
  '../../../../packages/model-gateway/src/config',
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

const withVision = (): ModelGatewayEnvironment =>
  deepSeekEnvironment({
    MODEL_GATEWAY_VISION_MODEL: 'vision-model-explicit',
    MODEL_GATEWAY_VISION_BASE_URL: 'https://vision.invalid/api/paas/v4',
    MODEL_GATEWAY_VISION_API_KEY: 'fixture-vision-key-never-real',
  });

/** 清空所有模型网关环境变量，验证注入优先、组合根不读 process.env。 */
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
  'MODEL_GATEWAY_TIMEOUT_MS',
  'MODEL_GATEWAY_MAX_OUTPUT_TOKENS',
  'MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS',
  'MODEL_GATEWAY_VISION',
  'MODEL_GATEWAY_DISABLE_THINKING',
  'MODEL_GATEWAY_VISION_MODEL',
  'MODEL_GATEWAY_VISION_BASE_URL',
  'MODEL_GATEWAY_VISION_API_KEY',
  'MODEL_GATEWAY_VISION_TIMEOUT_MS',
  'MODEL_GATEWAY_VISION_MAX_OUTPUT_TOKENS',
  'MODEL_GATEWAY_VISION_DISABLE_THINKING',
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

describe('resolveTurnModelRuntime 单次解析（R03）', () => {
  it('一次调用恰好解析一次配置，主链路与视觉链路共享同一份配置', () => {
    const runtime = resolveTurnModelRuntime(withVision());
    expect(runtime).not.toBeNull();
    expect(runtime?.gateway).toBeDefined();
    expect(runtime?.visionGateway).not.toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('未配置视觉 Provider 时同样只解析一次', () => {
    const runtime = resolveTurnModelRuntime(deepSeekEnvironment());
    expect(runtime).not.toBeNull();
    expect(runtime?.visionGateway).toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('多次调用各自解析一次，不依赖任何模块级缓存', () => {
    resolveTurnModelRuntime(deepSeekEnvironment());
    resolveTurnModelRuntime(deepSeekEnvironment());
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });
});

describe('注入纪律：组合根不读取 process.env', () => {
  it('process.env 清空后注入配置仍然生效', () => {
    for (const key of modelGatewayEnvKeys) delete process.env[key];
    const runtime = resolveTurnModelRuntime(withVision());
    expect(runtime).not.toBeNull();
    expect(runtime?.provider).toBe('deepseek');
    expect(runtime?.nativeAssetKinds).toEqual(['image']);
  });

  it('process.env 与注入配置不一致时以注入为准', () => {
    for (const key of modelGatewayEnvKeys) delete process.env[key];
    process.env.MODEL_GATEWAY_PROVIDER = 'openai-compatible';
    process.env.MODEL_GATEWAY_BASE_URL = 'https://polluted.invalid/v1';
    process.env.MODEL_GATEWAY_API_KEY = 'polluted-key';
    process.env.MODEL_GATEWAY_PRIMARY_MODEL = 'polluted-model';
    process.env.EDUCANVAS_DEPLOYMENT_ENV = 'local';

    const runtime = resolveTurnModelRuntime(deepSeekEnvironment());
    expect(runtime?.provider).toBe('deepseek');
    expect(runtime?.gateway).toBeDefined();
  });
});

describe('配置失败语义', () => {
  it('未配置 Provider 时诚实返回 null', () => {
    expect(resolveTurnModelRuntime({})).toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('主配置非法只暴露稳定错误码，不泄漏 secret', () => {
    const secret = 'fixture-secret-never-log';
    let caught: unknown;
    try {
      resolveTurnModelRuntime(
        deepSeekEnvironment({
          MODEL_GATEWAY_API_KEY: secret,
          MODEL_GATEWAY_BASE_URL: 'https://not-allowed-deepseek-host.invalid',
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelGatewayConfigurationError);
    expect(caught).toMatchObject({ code: 'INVALID_BASE_URL' });
    expect(String(caught)).not.toContain(secret);
  });

  it('主 Provider 不支持图片时 nativeAssetKinds 不含 image', () => {
    const runtime = resolveTurnModelRuntime(deepSeekEnvironment());
    expect(runtime?.nativeAssetKinds).toEqual([]);
  });
});
