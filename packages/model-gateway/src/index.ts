/** EduCanvas供应商适配器公共入口。供应商原始类型不会从此处导出。 @packageDocumentation */

export {
  ModelGatewayConfigurationError,
  acceptsImageInput,
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
export type { VisionProviderConfiguration } from './config-vision';
export {
  overrideCapabilities,
  parseCapabilityConfiguration,
  primaryProviderSupportsCapability,
  resolveCapabilityGatewayConfiguration,
  type CapabilityConfiguration,
  type CapabilityOverrideConfiguration,
  type OverrideCapability,
} from './config-capability';
export {
  OpenAICompatibleTurnModelGateway,
  type OpenAICompatibleTurnModelGatewayOptions,
} from './openai-compatible-turn-model-gateway';
export {
  createTurnModelGateway,
  createTurnModelGatewayFromEnvironment,
  createVisionTurnModelGateway,
  createVisionTurnModelGatewayFromEnvironment,
} from './turn-model-gateway-factory';
export {
  OpenAICompatibleStructuredModelGateway,
  type OpenAICompatibleStructuredModelGatewayOptions,
} from './openai-compatible-structured-model-gateway';
export {
  OpenAICompatibleSpeechModelGateway,
  type OpenAICompatibleSpeechModelGatewayOptions,
} from './openai-compatible-speech-model-gateway';
export {
  OpenAICompatibleAudioTranscriptionModelGateway,
  type OpenAICompatibleAudioTranscriptionModelGatewayOptions,
} from './openai-compatible-audio-transcription-model-gateway';
export {
  DashScopeSpeechModelGateway,
  type DashScopeSpeechModelGatewayOptions,
} from './dashscope-speech-model-gateway';
export {
  DashScopeAudioTranscriptionModelGateway,
  type DashScopeAudioTranscriptionModelGatewayOptions,
} from './dashscope-audio-transcription-model-gateway';
export {
  parseDashScopeSpeechConfiguration,
  type DashScopeSpeechConfiguration,
  type DashScopeSpeechResolution,
} from './dashscope-speech-config';
export {
  OpenAICompatibleImageGenerationModelGateway,
  type OpenAICompatibleImageGenerationModelGatewayOptions,
} from './openai-compatible-image-generation-model-gateway';
export {
  EMBEDDING_INSTRUCTION_VERSION,
  OpenAICompatibleEmbeddingModelGateway,
  type OpenAICompatibleEmbeddingModelGatewayOptions,
} from './openai-compatible-embedding-model-gateway';
export {
  resolveDashScopeSpeechAvailability,
  resolveDashScopeStreamingSpeechGateway,
  resolveDashScopeStreamingTranscriptionGateway,
  type DashScopeUnavailableReason,
} from './dashscope-speech-resolver';
