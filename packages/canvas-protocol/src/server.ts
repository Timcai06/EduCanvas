/**
 * Canvas协议约定的服务端入口。这里的类型包含答案，调用方必须在服务端边界使用，
 * 并由应用构建配置确保不会进入客户端Bundle。
 * @packageDocumentation
 */

export {
  MARKDOWN_DOCUMENT_CONTENT_VERSION,
  MARKDOWN_DOCUMENT_KIND,
  MARKDOWN_DOCUMENT_MAX_CHARS,
  markdownDocumentContentSchema,
  type MarkdownDocumentContent,
} from './artifacts/markdown-document';
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
export {
  domExplorationContentSchema,
  type DomExplorationContent,
  WEB_APP_SCHEMA_VERSION,
  WEB_APP_CAPABILITIES,
  WEB_APP_DIAGNOSTIC_CODES,
  WEB_APP_KIND,
  WEB_APP_MEDIA_TYPES,
  WEB_APP_FILES_MAX_COUNT,
  webAppContentSchema,
  type WebAppContent,
  type WebAppManifestFile,
  type WebAppDiagnosticCode,
} from './web-runtime-artifact';
export {
  validateWebRuntimePolicy,
  webRuntimePolicy,
  type WebRuntimePolicy,
  type WebRuntimePolicyErrorCode,
  type WebRuntimePolicyValidation,
} from './web-runtime-policy';
export {
  projectOwnedSourceResource,
  SourceResourceProjectionError,
  type SourceResourceProjectionInput,
} from './source-resource-projection';
export {
  ArtifactResourceProjectionError,
  projectOwnedArtifactResource,
  type ArtifactProjectionArtifact,
  type ArtifactProjectionJob,
  type ArtifactProjectionVersion,
} from './artifact-resource-projection';
