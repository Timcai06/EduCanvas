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
export {
  CONTEXT_ENGINE_VERSION,
  ContextEngineInputError,
  buildAgentContext,
  type BuiltAgentContext,
  type ContextMemoryInput,
  type ContextSegment,
  type ContextSegmentKind,
} from './context-engine';
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
export { type AgentTool, type AgentToolContext } from './local-tool';
export { adaptAgentTool } from './agent-tool-adapter';
export {
  AgentLoopEngine,
  type AgentLoopCommand,
  type AgentLoopEvent,
  type AgentLoopModelRunLifecycle,
  type AgentLoopPrompt,
  type AgentLoopToolBatch,
  type AgentLoopToolSuccess,
} from './agent-loop';
export {
  TurnApplicationService,
  type TurnApplicationCancellationPort,
  type TurnApplicationContextCandidate,
  type TurnApplicationContextPlan,
  type TurnApplicationLifecyclePort,
  type TurnApplicationLifecycleSnapshot,
  type TurnApplicationOutputGuardFinishResult,
  type TurnApplicationOutputGuardPort,
  type TurnApplicationOutputGuardPushResult,
  type TurnApplicationPort,
  type TurnApplicationPreflightDecision,
  type TurnApplicationProfileEvent,
  type TurnApplicationProfilePlan,
  type TurnApplicationProfilePort,
  type TurnApplicationTracePort,
  type TurnApplicationTraceSpan,
} from './turn-application';
export {
  ToolKernel,
  ToolEffectReconciler,
  ToolOutcomeUnknownError,
  toolPolicyDimensions,
  toolRiskLevels,
  toolSources,
  type ToolAdapterApprovalContext,
  type ToolAdapterApprovalPreparation,
  type ToolAdapterInvocationContext,
  type ManualToolEffectReconciliation,
  type ToolEffectReconcileResult,
  type ToolEffectReconciliationAuthorizerPort,
  type ToolEffectReconciliationPrincipal,
  type ToolEffectReconciliationTarget,
  type ToolEffectVerificationInput,
  type ToolEffectVerificationVerdict,
  type ToolEffectVerifier,
  type ToolKernelAdapter,
  type ToolKernelFailureCode,
  type ToolKernelPolicyContext,
  type ToolKernelResult,
  type ToolKernelTrustedContext,
  type ToolPolicyDimension,
  type ToolRiskLevel,
  type ToolSource,
} from './tool-kernel';
