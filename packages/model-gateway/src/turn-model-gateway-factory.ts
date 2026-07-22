import type { TurnModelGateway } from '@educanvas/agent-core';
import { createAiSdkTurnModelGateway } from './ai-sdk-provider-factory';
import {
  parseModelGatewayConfiguration,
  type ModelGatewayEnvironment,
} from './config';
import {
  OpenAICompatibleTurnModelGateway,
  type OpenAICompatibleTurnModelGatewayOptions,
} from './openai-compatible-turn-model-gateway';

/** 解析显式环境并构造Turn Provider；disabled配置返回null且不触发网络。 */
export function createTurnModelGatewayFromEnvironment(
  environment: ModelGatewayEnvironment,
  options: OpenAICompatibleTurnModelGatewayOptions = {},
): TurnModelGateway | null {
  const config = parseModelGatewayConfiguration(environment);
  if (!config.enabled) return null;
  return config.runtime === 'ai-sdk'
    ? createAiSdkTurnModelGateway(config, options)
    : new OpenAICompatibleTurnModelGateway(config, options);
}
