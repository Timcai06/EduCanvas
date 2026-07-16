/**
 * EduCanvas通用Agent领域契约的唯一公共入口。
 * @packageDocumentation
 */

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
  StructuredModelGateway,
  StructuredModelRequest,
  StructuredModelResult,
  TurnModelGateway,
} from './model-gateway';
