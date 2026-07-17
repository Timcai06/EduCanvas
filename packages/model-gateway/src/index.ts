/** EduCanvas供应商适配器公共入口。供应商原始类型不会从此处导出。 @packageDocumentation */

export {
  ModelGatewayConfigurationError,
  deploymentEnvironments,
  modelGatewayConfigurationErrorCodes,
  openAICompatibleProviders,
  parseModelGatewayConfiguration,
  type DeploymentEnvironment,
  type DisabledModelGatewayConfiguration,
  type EnabledModelGatewayConfiguration,
  type ModelGatewayConfiguration,
  type ModelGatewayConfigurationErrorCode,
  type ModelGatewayEnvironment,
  type OpenAICompatibleProvider,
} from './config';
export {
  OpenAICompatibleTurnModelGateway,
  createTurnModelGatewayFromEnvironment,
  type OpenAICompatibleTurnModelGatewayOptions,
} from './openai-compatible-turn-model-gateway';
export {
  OpenAICompatibleStructuredModelGateway,
  type OpenAICompatibleStructuredModelGatewayOptions,
} from './openai-compatible-structured-model-gateway';
