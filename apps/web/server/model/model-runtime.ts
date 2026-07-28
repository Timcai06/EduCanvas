import 'server-only';

import {
  acceptsImageInput,
  createTurnModelGatewayFromEnvironment,
  createVisionTurnModelGatewayFromEnvironment,
  parseModelGatewayConfiguration,
  type ModelGatewayEnvironment,
} from '@educanvas/model-gateway';
import type { AssetKind, TurnModelGateway } from '@educanvas/agent-core';

/**
 * Web 组合根只显式转交模型路由所需的环境变量，避免把整个 process.env
 * 传播到适配器或测试替身。任何配置异常都只携带稳定错误码。
 */
function readModelGatewayEnvironment(): ModelGatewayEnvironment {
  return {
    EDUCANVAS_DEPLOYMENT_ENV: process.env.EDUCANVAS_DEPLOYMENT_ENV,
    MODEL_GATEWAY_PROVIDER: process.env.MODEL_GATEWAY_PROVIDER,
    MODEL_GATEWAY_RUNTIME: process.env.MODEL_GATEWAY_RUNTIME,
    MODEL_GATEWAY_ALLOW_DEEPSEEK: process.env.MODEL_GATEWAY_ALLOW_DEEPSEEK,
    MODEL_GATEWAY_BASE_URL: process.env.MODEL_GATEWAY_BASE_URL,
    MODEL_GATEWAY_API_KEY: process.env.MODEL_GATEWAY_API_KEY,
    MODEL_GATEWAY_PRIMARY_MODEL: process.env.MODEL_GATEWAY_PRIMARY_MODEL,
    MODEL_GATEWAY_FAST_MODEL: process.env.MODEL_GATEWAY_FAST_MODEL,
    MODEL_GATEWAY_STRUCTURED_MODEL: process.env.MODEL_GATEWAY_STRUCTURED_MODEL,
    MODEL_GATEWAY_TIMEOUT_MS: process.env.MODEL_GATEWAY_TIMEOUT_MS,
    MODEL_GATEWAY_MAX_OUTPUT_TOKENS:
      process.env.MODEL_GATEWAY_MAX_OUTPUT_TOKENS,
    MODEL_GATEWAY_VISION: process.env.MODEL_GATEWAY_VISION,
    MODEL_GATEWAY_VISION_MODEL: process.env.MODEL_GATEWAY_VISION_MODEL,
    MODEL_GATEWAY_VISION_BASE_URL: process.env.MODEL_GATEWAY_VISION_BASE_URL,
    MODEL_GATEWAY_VISION_API_KEY: process.env.MODEL_GATEWAY_VISION_API_KEY,
    MODEL_GATEWAY_VISION_TIMEOUT_MS:
      process.env.MODEL_GATEWAY_VISION_TIMEOUT_MS,
    MODEL_GATEWAY_VISION_MAX_OUTPUT_TOKENS:
      process.env.MODEL_GATEWAY_VISION_MAX_OUTPUT_TOKENS,
  };
}

export interface ResolvedTurnModelRuntime {
  gateway: TurnModelGateway;
  provider: string;
  /** 当前 Provider 能直接消费、无需转成文本的输入模态。 */
  nativeAssetKinds: readonly AssetKind[];
  /**
   * 承接图片输入的独立 Provider；主 Provider 自带读图能力或未配置视觉时为 null。
   * 调用方按本轮是否真的含图片选择，不能无条件替换主 Gateway（ADR-0017）。
   */
  visionGateway: TurnModelGateway | null;
}

/**
 * 每次 Turn 在服务端解析一次配置；未配置时返回 null，由应用服务写入诚实失败态。
 * 这里不做隐式 fallback，也不会把 API Key、模型 ID 或配置对象返回给浏览器。
 */
export function resolveTurnModelRuntime(
  environment: ModelGatewayEnvironment = readModelGatewayEnvironment(),
): ResolvedTurnModelRuntime | null {
  const configuration = parseModelGatewayConfiguration(environment);
  if (!configuration.enabled) return null;
  const gateway = createTurnModelGatewayFromEnvironment(environment);
  if (gateway === null) return null;

  return {
    gateway,
    provider: configuration.provider,
    /* 能力来自与 gateway 同一份配置，避免物化层与 Adapter 各持一份判断。 */
    nativeAssetKinds: acceptsImageInput(configuration)
      ? (['image'] as const)
      : [],
    visionGateway: createVisionTurnModelGatewayFromEnvironment(environment),
  };
}
