/**
 * Canvas协议的服务端专用入口。这里的类型包含答案，禁止从客户端组件导入。
 * @packageDocumentation
 */

export {
  ARTIFACT_SCHEMA_VERSION,
  artifactSchema,
  validateArtifact,
  type Artifact,
  type ArtifactType,
  type ArtifactValidation,
} from './artifact';
export {
  classificationGameParamsSchema,
  type ClassificationGameParams,
} from './artifacts/classification-game';
export { quizParamsSchema, type QuizParams } from './artifacts/quiz';
export {
  artifactGradingKeySchema,
  gradeCanvasSubmission,
  prepareArtifact,
  type ArtifactGradingKey,
  type GradingDecision,
  type GradingRejectionCode,
  type GradingResult,
  type PreparedArtifact,
} from './grading';
