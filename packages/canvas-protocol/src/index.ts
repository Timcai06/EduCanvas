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
  GENERATED_IMAGE_CONTENT_VERSION,
  generatedImageMetadataSchema,
  type GeneratedImageMetadata,
} from './artifacts/generated-image';
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
  canvasAnnotationGeometrySchema,
  canvasAnnotationKinds,
  canvasAnnotationPens,
  canvasAnnotationSchema,
  canvasAnnotationSources,
  createCanvasAnnotationSchema,
  type CanvasAnnotation,
  type CanvasAnnotationGeometry,
  type CanvasAnnotationKind,
  type CanvasAnnotationSource,
  type CreateCanvasAnnotation,
} from './resource-annotation';
export {
  CANVAS_RENDERER_MANIFEST_VERSION,
  canvasRendererManifestSchema,
  rendererSupportsResource,
  type CanvasRendererManifest,
} from './renderer-manifest';
export {
  canvasNonWebOpenModes,
  canvasNonWebUnavailableReasons,
  projectCanvasResourceForNonWeb,
  type CanvasNonWebOpenMode,
  type CanvasNonWebProjection,
  type CanvasNonWebUnavailableReason,
} from './non-web-projection';
export {
  canvasResourceErrorCodes,
  canvasResourceErrorCodeSchema,
  canvasResourceErrorSchema,
  type CanvasResourceError,
  type CanvasResourceErrorCode,
} from './resource-errors';
export {
  WEB_RUNTIME_PROTOCOL_VERSION,
  createWebRuntimeSession,
  hostToSandboxMessageSchema,
  reduceWebRuntimeMessage,
  sandboxToHostMessageSchema,
  webRuntimeBindingSchema,
  webRuntimeFailureCodeSchema,
  webRuntimeFailureCodes,
  webRuntimeMessageSchema,
  webRuntimePreflightResultSchema,
  webRuntimePreflightFailureCodeSchema,
  webRuntimePreflightFailureCodes,
  webRuntimePreflightStatusSchema,
  webRuntimeMessageDirectionSchema,
  webRuntimeMessageDirections,
  type HostToSandboxMessage,
  type SandboxToHostMessage,
  type WebRuntimeBinding,
  type WebRuntimeFailureCode,
  type WebRuntimeMessage,
  type WebRuntimePreflightResult,
  type WebRuntimePreflightFailureCode,
  type WebRuntimePreflightStatus,
  type WebRuntimeMessageDirection,
  type WebRuntimeSessionState,
  type WebRuntimeTerminalType,
  type WebRuntimeValidationResult,
} from './web-runtime-contract';
