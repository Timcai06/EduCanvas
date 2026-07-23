import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { TurnModelGateway } from '@educanvas/agent-core';
import { AiSdkTurnModelGateway } from './ai-sdk-turn-model-gateway';
import type { EnabledModelGatewayConfiguration } from './config';
import type { OpenAICompatibleTurnModelGatewayOptions } from './openai-compatible-turn-model-gateway';

/** 使用受控OpenAI-compatible Provider构造AI SDK Turn Adapter。 */
export function createAiSdkTurnModelGateway(
  configuration: EnabledModelGatewayConfiguration,
  options: OpenAICompatibleTurnModelGatewayOptions = {},
): TurnModelGateway {
  const provider = createOpenAICompatible({
    name: configuration.provider,
    baseURL: configuration.baseUrl,
    apiKey: configuration.apiKey,
    includeUsage: true,
    fetch: options.fetchImpl,
    transformRequestBody:
      configuration.provider === 'deepseek'
        ? (body) => ({ ...body, thinking: { type: 'disabled' } })
        : undefined,
  });
  return new AiSdkTurnModelGateway({
    provider: configuration.provider,
    modelIds: configuration.modelIds,
    timeoutMs: configuration.timeoutMs,
    maxOutputTokens: configuration.maxOutputTokens,
    modelFactory: (modelId) => provider(modelId),
    now: options.now,
  });
}
