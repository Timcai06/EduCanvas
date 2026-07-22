/** EduCanvas供应商适配器公共入口。供应商原始类型不会从此处导出。 @packageDocumentation */

export {
  ModelGatewayConfigurationError,
  deploymentEnvironments,
  modelGatewayConfigurationErrorCodes,
  openAICompatibleProviders,
  parseModelGatewayConfiguration,
  turnModelGatewayRuntimes,
  type DeploymentEnvironment,
  type DisabledModelGatewayConfiguration,
  type EnabledModelGatewayConfiguration,
  type ModelGatewayConfiguration,
  type ModelGatewayConfigurationErrorCode,
  type ModelGatewayEnvironment,
  type OpenAICompatibleProvider,
  type TurnModelGatewayRuntime,
} from './config';
export {
  OpenAICompatibleTurnModelGateway,
  type OpenAICompatibleTurnModelGatewayOptions,
} from './openai-compatible-turn-model-gateway';
export { createTurnModelGatewayFromEnvironment } from './turn-model-gateway-factory';
export {
  OpenAICompatibleStructuredModelGateway,
  type OpenAICompatibleStructuredModelGatewayOptions,
} from './openai-compatible-structured-model-gateway';
export {
  OpenAICompatibleSpeechModelGateway,
  type OpenAICompatibleSpeechModelGatewayOptions,
} from './openai-compatible-speech-model-gateway';
