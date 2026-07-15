/** EduCanvas阶段一教学应用服务公共入口。 @packageDocumentation */

export {
  GradeCanvasSubmissionService,
  type ArtifactGradingKeyReader,
  type GradeCanvasSubmissionCommand,
  type GradeCanvasSubmissionOutcome,
  type GradeCanvasSubmissionRejection,
} from './grade-submission';
export {
  TeachingToolExecutor,
  defineTeachingTool,
  rawTeachingToolCallSchema,
  toolExecutionRejectionCodes,
  type ModelTeachingToolDescriptor,
  type RawTeachingToolCall,
  type RegisteredTeachingTool,
  type TeachingToolExecutorOptions,
  type TeachingToolHandlerContext,
  type ToolBatchExecutionResult,
  type ToolEffect,
  type ToolExecutionAuditRecord,
  type ToolExecutionFailure,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolExecutionRejectionCode,
  type ToolExecutionSuccess,
  type ToolExposure,
  type TrustedToolExecutionContext,
} from './tool-executor';
export {
  TEACHING_TURN_PROMPT_VERSION,
  TEACHING_TURN_TASK_ALIAS,
  TeachingTurnOrchestrator,
  teachingTurnCommandSchema,
  teachingTurnPlanSchema,
  type TeachingTurnCommand,
  type TeachingTurnModelMetadata,
  type TeachingTurnOutcome,
  type TeachingTurnPlan,
  type TeachingTurnRejectionCode,
  type TeachingTurnStayDecision,
  type TeachingTurnToolFailure,
} from './turn-orchestrator';
