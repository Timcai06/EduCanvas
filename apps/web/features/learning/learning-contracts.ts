import type {
  CanvasInteractionEvent,
  PublicArtifact,
} from '@educanvas/canvas-protocol';

/** 浏览器可见的学习进度投影；不包含匿名身份、会话ID或数据库版本。 */
export interface ProgressDTO {
  knowledgeNodeId: string;
  masteryPercent: number;
  attemptedItems: number;
  correctItems: number;
  hintCount: number;
  nextReviewAt: string | null;
}

/** Server Component 加载后传入客户端工作区的最小公开数据。 */
export interface LearningPageDTO {
  artifact: PublicArtifact;
  progress: ProgressDTO | null;
}

/** Renderer 只描述学生选择；事件身份与时间由客户端工作区统一补齐。 */
export type CanvasSubmissionDraft =
  | {
      type: 'quiz_answer_submitted';
      artifactId: string;
      payload: {
        questionId: string;
        selectedOptionId: string;
      };
    }
  | {
      type: 'classification_submitted';
      artifactId: string;
      payload: {
        assignments: readonly {
          itemId: string;
          categoryId: string;
        }[];
      };
    };

/** Server Action 接收的完整不可信交互；仍须在服务端重新运行协议校验。 */
export type CanvasSubmissionInput = Extract<
  CanvasInteractionEvent,
  { type: CanvasSubmissionDraft['type'] }
>;

export interface CanvasFeedbackDTO {
  attemptedItems: number;
  correctItems: number;
  itemResults: readonly { itemId: string; isCorrect: boolean }[];
  message: string | null;
}

/** Server Action 仅返回可公开、可序列化且穷尽可处理的结果。 */
export type SubmitCanvasResultDTO =
  | {
      status: 'success';
      replayed: boolean;
      feedback: CanvasFeedbackDTO;
      progress: ProgressDTO;
    }
  | {
      status: 'invalid';
      code: string;
      message: string;
    }
  | {
      status: 'unauthorized';
      message: string;
    }
  | {
      status: 'error';
      requestId: string;
      message: string;
    };
