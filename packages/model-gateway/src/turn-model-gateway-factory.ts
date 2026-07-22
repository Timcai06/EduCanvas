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
): OpenAICompatibleTurnModelGateway | null {
  const config = parseModelGatewayConfiguration(environment);
  return config.enabled
    ? new OpenAICompatibleTurnModelGateway(config, options)
    : null;
}
