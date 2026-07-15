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
