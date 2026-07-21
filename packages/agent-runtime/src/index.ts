/** EduCanvas通用Agent运行时的公共入口。 @packageDocumentation */
export {
  UnsupportedAgentInputModalityError,
  buildAssetContext,
  type AgentInputCapabilities,
  type BuiltAssetContext,
  type MaterializedAssetInput,
} from './asset-context';
export {
  CONVERSATION_CONTEXT_VERSION,
  buildConversationContext,
  type ConversationContextMessage,
  type ConversationContextOptions,
  type ConversationContextSnapshot,
} from './conversation-context';
export { LocalObjectStorage } from './local-object-storage';
export {
  MAX_RESPONSE_CHARACTERS,
  MAX_TOOL_ARGUMENT_BYTES,
  MAX_TOOL_CALLS_PER_TURN,
  validateModelRun,
  isAborted,
  type ModelRunFailure,
  type ModelRunResult,
  type ModelRunSuccess,
  type ParsedToolCall,
} from './turn-engine';
export {
  AgentToolRegistry,
  type AgentTool,
  type AgentToolContext,
  type AgentToolExecution,
  type AgentToolFailureCode,
} from './agent-tools';
export {
  AgentLoopEngine,
  type AgentLoopCommand,
  type AgentLoopEvent,
  type AgentLoopPrompt,
  type AgentLoopToolBatch,
  type AgentLoopToolSuccess,
} from './agent-loop';
export { type TurnApplicationPort } from './turn-application';
export {
  ToolKernel,
  ToolOutcomeUnknownError,
  toolPolicyDimensions,
  toolRiskLevels,
  toolSources,
  type ToolAdapterInvocationContext,
  type ToolKernelAdapter,
  type ToolKernelFailureCode,
  type ToolKernelResult,
  type ToolKernelTrustedContext,
  type ToolPolicyDimension,
  type ToolRiskLevel,
  type ToolSource,
} from './tool-kernel';
