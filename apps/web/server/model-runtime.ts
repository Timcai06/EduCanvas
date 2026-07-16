import 'server-only';

import {
  OpenAICompatibleTurnModelGateway,
  parseModelGatewayConfiguration,
  type ModelGatewayEnvironment,
} from '@educanvas/model-gateway';
import type { TurnModelGateway } from '@educanvas/agent-core';

/**
 * Web 组合根只显式转交模型路由所需的环境变量，避免把整个 process.env
 * 传播到适配器或测试替身。任何配置异常都只携带稳定错误码。
 */
function readModelGatewayEnvironment(): ModelGatewayEnvironment {
  return {
    EDUCANVAS_DEPLOYMENT_ENV: process.env.EDUCANVAS_DEPLOYMENT_ENV,
    MODEL_GATEWAY_PROVIDER: process.env.MODEL_GATEWAY_PROVIDER,
    MODEL_GATEWAY_ALLOW_DEEPSEEK: process.env.MODEL_GATEWAY_ALLOW_DEEPSEEK,
    MODEL_GATEWAY_BASE_URL: process.env.MODEL_GATEWAY_BASE_URL,
    MODEL_GATEWAY_API_KEY: process.env.MODEL_GATEWAY_API_KEY,
    MODEL_GATEWAY_PRIMARY_MODEL: process.env.MODEL_GATEWAY_PRIMARY_MODEL,
    MODEL_GATEWAY_FAST_MODEL: process.env.MODEL_GATEWAY_FAST_MODEL,
    MODEL_GATEWAY_STRUCTURED_MODEL: process.env.MODEL_GATEWAY_STRUCTURED_MODEL,
    MODEL_GATEWAY_TIMEOUT_MS: process.env.MODEL_GATEWAY_TIMEOUT_MS,
    MODEL_GATEWAY_MAX_OUTPUT_TOKENS:
      process.env.MODEL_GATEWAY_MAX_OUTPUT_TOKENS,
  };
}

export interface ResolvedTurnModelRuntime {
  gateway: TurnModelGateway;
  provider: string;
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

  return {
    gateway: new OpenAICompatibleTurnModelGateway(configuration),
    provider: configuration.provider,
  };
}
