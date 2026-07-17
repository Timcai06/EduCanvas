/**
 * Canvas协议约定的服务端入口。这里的类型包含答案，调用方必须在服务端边界使用，
 * 并由应用构建配置确保不会进入客户端Bundle。
 * @packageDocumentation
 */

export {
  ARTIFACT_SCHEMA_VERSION,
  artifactSchema,
  gradableArtifactSchema,
  validateArtifact,
  type Artifact,
  type ArtifactType,
  type ArtifactValidation,
  type GradableArtifact,
} from './artifact';
export {
  classificationGameParamsSchema,
  type ClassificationGameParams,
} from './artifacts/classification-game';
export { quizParamsSchema, type QuizParams } from './artifacts/quiz';
export {
  pipelineFlowParamsSchema,
  pipelineFlowSlotSchema,
  pipelineFlowSlots,
  type PipelineFlowParams,
  type PipelineFlowSlot,
} from './artifacts/pipeline-flow';
export {
  artifactGradingKeySchema,
  gradeCanvasSubmission,
  prepareArtifact,
  projectRenderableArtifact,
  type ArtifactGradingKey,
  type GradingDecision,
  type GradingRejectionCode,
  type GradingResult,
  type PreparedArtifact,
} from './grading';
