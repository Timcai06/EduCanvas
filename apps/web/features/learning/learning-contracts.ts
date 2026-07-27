import type {
  CanvasInteractionEvent,
  PublicArtifact,
} from '@educanvas/canvas-protocol';
import type {
  DiagnosticObjectiveStatus,
  LearnerAgeBand,
  LearnerDeclarationSource,
  LearnerGradeBand,
  PublicDiagnostic,
  TeachingPreferences,
} from '@educanvas/teaching-core';
import type { InitialChatMessageDTO } from '@/features/chat/messages';

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
  study: StudyProgressDTO;
  initialMessages: readonly InitialChatMessageDTO[];
  initialSessions: readonly LearningSessionSummaryDTO[];
  currentSessionId: string | null;
}

/** 浏览器可编辑的是显式声明和教学偏好，不包含模型推断字段。 */
export interface CreateStudyPlanInputDTO {
  ageBand: LearnerAgeBand;
  gradeBand: LearnerGradeBand;
  declarationSource: Exclude<LearnerDeclarationSource, 'school_asserted'>;
  desiredOutcome: string;
  preferences: TeachingPreferences;
}

export interface StudyObjectiveProgressDTO {
  objectiveKey: string;
  title: string;
  status: DiagnosticObjectiveStatus;
}

/** Notebook 级目标与诊断结果的公开投影，不暴露 student/session/答案键。 */
export interface StudyProgressDTO {
  topic: string;
  desiredOutcome: string;
  objectives: readonly StudyObjectiveProgressDTO[];
  nextObjectiveKey: string | null;
}

/** 初始诊断题面只含版本、题目和选项，内部 objective 映射与答案都留在服务端。 */
export interface StudyDiagnosticDTO {
  topic: string;
  desiredOutcome: string;
  diagnostic: PublicDiagnostic;
}

export interface SubmitDiagnosticInputDTO {
  attemptId: string;
  answers: readonly {
    questionId: string;
    selectedOptionId: string;
  }[];
}

export type StudyActionResultDTO =
  | { status: 'invalid'; message: string }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; requestId: string; message: string };

/** Sidebar projection; ownership and pagination internals stay server-only. */
export interface LearningSessionSummaryDTO {
  id: string;
  title: string;
  courseTitle: string;
  status: 'active' | 'archived';
  lastActivityAt: string;
  hasInterruptedTurn: boolean;
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
