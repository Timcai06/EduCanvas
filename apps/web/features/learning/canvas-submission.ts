import type {
  CanvasSubmissionDraft,
  CanvasSubmissionInput,
} from './learning-contracts';
import { CANVAS_INTERACTION_SCHEMA_VERSION } from '@educanvas/canvas-protocol';

/** 把 Renderer 草稿补成不可信客户端事件；身份与判分事实仍由服务端恢复。 */
export function createCanvasSubmissionInput(
  draft: CanvasSubmissionDraft,
): CanvasSubmissionInput {
  const eventBase = {
    schemaVersion: CANVAS_INTERACTION_SCHEMA_VERSION,
    eventId: crypto.randomUUID(),
    artifactId: draft.artifactId,
    occurredAt: new Date().toISOString(),
  };

  if (draft.type === 'quiz_answer_submitted') {
    return { ...eventBase, type: draft.type, payload: { ...draft.payload } };
  }
  if (draft.type === 'code_completion_submitted') {
    return {
      ...eventBase,
      type: draft.type,
      payload: { source: draft.payload.source },
    };
  }
  return {
    ...eventBase,
    type: draft.type,
    payload: {
      assignments: draft.payload.assignments.map((assignment) => ({
        ...assignment,
      })),
    },
  };
}
