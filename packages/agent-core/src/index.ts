/**
 * EduCanvas通用Agent领域契约的唯一公共入口。
 * @packageDocumentation
 */

export {
  assetDescriptorSchema,
  assetKindSchema,
  assetKinds,
  assetOriginSchema,
  assetOrigins,
  assetScopeSchema,
  assetScopes,
  assetStatusSchema,
  assetStatuses,
  assetVersionDescriptorSchema,
  assetVersionReferenceSchema,
  canTransitionAssetStatus,
  type AssetDescriptor,
  type AssetKind,
  type AssetOrigin,
  type AssetScope,
  type AssetStatus,
  type AssetVersionDescriptor,
  type AssetVersionReference,
} from './asset-contracts';

export {
  agentArtifactPartSchema,
  agentAssetPartSchema,
  agentMessageInputSchema,
  agentMessagePartSchema,
  agentMessageRoleSchema,
  agentMessageRoles,
  agentTextPartSchema,
  extractAgentMessageText,
  normalizeAgentMessageParts,
  referencedAssetKinds,
  referencedAssetVersions,
  type AgentArtifactPart,
  type AgentAssetPart,
  type AgentMessageInput,
  type AgentMessagePart,
  type AgentMessageRole,
  type AgentTextPart,
} from './message-contracts';

export {
  ModelGatewayInvocationError,
  modelAliasSchema,
  modelAliases,
  modelFinishReasonSchema,
  modelFinishReasons,
  modelMessageSchema,
  modelUsageSchema,
  normalizeModelGatewayError,
  normalizedModelErrorCodeSchema,
  normalizedModelErrorCodes,
  normalizedModelErrorSchema,
  providerCallMetadataSchema,
  speechTaskAliasSchema,
  speechTaskAliases,
  streamingTaskAliasSchema,
  streamingTaskAliases,
  structuredTaskAliasSchema,
  structuredTaskAliases,
  taskAliasSchema,
  taskAliases,
  turnModelEventSchema,
  turnModelPhaseSchema,
  turnModelPhases,
  type ModelAbortSignal,
  type ModelAlias,
  type ModelFinishReason,
  type ModelMessage,
  type ModelToolDefinition,
  type ModelToolResult,
  type ModelUsage,
  type NormalizedModelError,
  type ProviderCallMetadata,
  type SpeechTaskAlias,
  type StreamAgentTextRequest,
  type StreamingTaskAlias,
  type StreamTurnTextRequest,
  type StructuredTaskAlias,
  type TaskAlias,
  type TurnModelEvent,
  type TurnModelPhase,
} from './model-contracts';

export type {
  ModelGateway,
  SpeechAudioFormat,
  SpeechModelGateway,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
  StructuredModelGateway,
  StructuredModelRequest,
  StructuredModelResult,
  TurnModelGateway,
} from './model-gateway';

export {
  agentModelRunStatuses,
  agentModelRunStatusSchema,
  type AgentModelRunLedgerPort,
  type AgentModelRunProviderResult,
  type AgentModelRunSnapshot,
  type AgentModelRunStatus,
  type AgentModelRunTerminalStatus,
  type CreateAgentModelRunInput,
} from './model-run-ledger';

export {
  isTurnApplicationTerminalEvent,
  turnApplicationCommandSchema,
  turnApplicationEventSchema,
  turnApplicationFailureCodeSchema,
  turnApplicationFailureCodes,
  turnApplicationProtocolVersion,
  validateTurnApplicationEventSequence,
  type TurnApplicationCommand,
  type TurnApplicationEvent,
  type TurnApplicationFailureCode,
} from './turn-application-contracts';

export type {
  AgentTurnContextLedgerPort,
  AgentTurnContextMaterial,
  AgentTurnContextSnapshot,
} from './turn-context-ledger';

export {
  agentToolCallStatusSchema,
  agentToolCallStatuses,
  agentToolEffectSchema,
  agentToolExposureSchema,
  type AgentToolAuditValueSummary,
  type AgentToolCallLedgerPort,
  type AgentToolCallSnapshot,
  type AgentToolCallStatus,
  type AgentToolCallTerminalStatus,
  type AgentToolEffect,
  type AgentToolExposure,
  type CreateAgentToolCallInput,
} from './tool-call-ledger';

export {
  toolEffectLedgerStatuses,
  type ToolEffectLedgerPort,
  type ToolEffectLedgerSnapshot,
  type ToolEffectLedgerStatus,
  type ToolEffectLedgerTerminalStatus,
} from './tool-effect-ledger';

export {
  ObjectStorageError,
  isValidObjectKey,
  type ObjectStoragePort,
  type StoredObject,
} from './object-storage-contracts';
