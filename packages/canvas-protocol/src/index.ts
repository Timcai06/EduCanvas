/**
 * Canvas 协议包的唯一公共入口。
 * 集中导出可避免调用方依赖内部文件布局，并让协议演进保持在 ADR-0002 的受控边界内。
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
  learningEventTypes,
  learningEventSchema,
  type LearningEvent,
  type LearningEventType,
} from './events';
