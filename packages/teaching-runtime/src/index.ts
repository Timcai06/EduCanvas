/** EduCanvas阶段一教学应用服务公共入口。 @packageDocumentation */

export {
  GradeCanvasSubmissionService,
  type ArtifactGradingKeyReader,
  type GradeCanvasSubmissionCommand,
  type GradeCanvasSubmissionOutcome,
  type GradeCanvasSubmissionRejection,
} from './grade-submission';
export {
  ProgressTeachingStateService,
  progressTeachingStateCommandSchema,
  teachingProgressionPolicySchema,
  type ProgressTeachingStateCommand,
  type ProgressTeachingStateOutcome,
  type ProgressTeachingStateRejectionCode,
  type TeachingProgressionPolicy,
  type TeachingProgressionPolicyReader,
} from './state-transition';
export {
  defineTeachingTool,
  type RegisteredTeachingTool,
  type TeachingToolHandlerContext,
  type TeachingToolEffect,
  type TeachingToolExposure,
} from './teaching-tool';
export { adaptTeachingTool } from './tool-kernel-adapter';
export {
  TEACHING_TURN_ANSWER_PROMPT_VERSION,
  TEACHING_TURN_SYNTHESIS_PROMPT_VERSION,
  createTeachingTurnPromptMessages,
  type TeachingTurnPromptInput,
  type TeachingTurnPromptMessages,
} from './teaching-prompt';
export {
  K12_TEACHING_SYSTEM_POLICY,
  K12_TEACHING_SYSTEM_POLICY_VERSION,
  TEACHING_OUTPUT_CONTEXT_TAIL_CHARACTERS,
  TEACHING_OUTPUT_MAX_UNBROKEN_BUFFER_CHARACTERS,
  TeachingOutputSafetyGate,
  type TeachingOutputSafetyGateFinishResult,
  type TeachingOutputSafetyGatePushResult,
} from './teaching-safety';
export {
  observableProviderAliases,
  recordTeachingMetric,
  teachingMetricNames,
  type ObservableProviderAlias,
  type TeachingMetricEvent,
  type TeachingMetricName,
  type TeachingObservabilityPort,
} from './observability';
