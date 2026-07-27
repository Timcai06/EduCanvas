/**
 * Canvas协议的浏览器安全公共入口；完整答案只能从`@educanvas/canvas-protocol/server`导入。
 * @packageDocumentation
 */

export {
  publicArtifactSchema,
  publicClassificationItemSchema,
  publicQuizQuestionSchema,
  validatePublicArtifact,
  type PublicArtifact,
  type PublicArtifactType,
} from './public-artifact';
export {
  CANVAS_INTERACTION_SCHEMA_VERSION,
  canvasInteractionEventTypes,
  canvasInteractionEventSchema,
  type CanvasInteractionEvent,
  type CanvasInteractionEventType,
} from './events';
export {
  pipelineFlowParamsSchema,
  pipelineFlowSlotSchema,
  pipelineFlowSlots,
  type PipelineFlowParams,
  type PipelineFlowSlot,
} from './artifacts/pipeline-flow';
export {
  MIND_MAP_CONTENT_VERSION,
  mindMapContentSchema,
  type MindMapContent,
  type MindMapNode,
} from './artifacts/mind-map';
export {
  SLIDES_CONTENT_VERSION,
  slidesContentSchema,
  type Slide,
  type SlidesContent,
} from './artifacts/slides';
export {
  FLASHCARDS_CONTENT_VERSION,
  flashcardsContentSchema,
  type Flashcard,
  type FlashcardsContent,
} from './artifacts/flashcards';
export {
  AUDIO_OVERVIEW_CONTENT_VERSION,
  audioOverviewMetadataSchema,
  type AudioOverviewMetadata,
} from './artifacts/audio-overview';
export {
  NOTE_MARKDOWN_MAX_CHARS,
  NOTE_CONTENT_VERSION,
  noteContentSchema,
  type NoteContent,
} from './artifacts/note';
export {
  CANVAS_RESOURCE_SCHEMA_VERSION,
  canvasRepresentationKinds,
  canvasRepresentationKindSchema,
  canvasResourceActions,
  canvasResourceActionSchema,
  canvasResourceKinds,
  canvasResourceKindSchema,
  canvasResourceSchema,
  canvasResourceStatuses,
  canvasResourceStatusSchema,
  canvasRuntimeKinds,
  canvasRuntimeKindSchema,
  canvasRuntimeRequirementSchema,
  canvasTrustTiers,
  canvasTrustTierSchema,
  validateCanvasResource,
  type CanvasRepresentationKind,
  type CanvasResource,
  type CanvasResourceAction,
  type CanvasResourceKind,
  type CanvasResourceValidation,
  type CanvasRuntimeKind,
  type CanvasRuntimeRequirement,
  type CanvasTrustTier,
} from './resource';
export {
  CANVAS_RENDERER_MANIFEST_VERSION,
  canvasRendererManifestSchema,
  rendererSupportsResource,
  type CanvasRendererManifest,
} from './renderer-manifest';
export {
  canvasResourceErrorCodes,
  canvasResourceErrorCodeSchema,
  canvasResourceErrorSchema,
  type CanvasResourceError,
  type CanvasResourceErrorCode,
} from './resource-errors';
