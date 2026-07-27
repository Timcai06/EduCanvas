import type {
  DiagnosticObjectiveProgress,
  GradedDiagnostic,
  LearnerProfileDeclaration,
  LearningObjectiveDefinition,
  StudyCourseDefinition,
} from '@educanvas/teaching-core';

export interface BootstrapStudyPlanInput {
  trustedStudentId: string;
  declaredByUserId: string;
  sessionId: string;
  desiredOutcome: string;
  profile: LearnerProfileDeclaration;
  course: StudyCourseDefinition;
}

export interface LearnerProfileSnapshot extends LearnerProfileDeclaration {
  studentId: string;
  declaredByUserId: string;
  version: number;
  updatedAt: string;
}

export interface StudyGoalSnapshot {
  id: string;
  notebookId: string;
  studentId: string;
  sessionId: string;
  courseSlug: string;
  courseVersion: string;
  gradeBand: LearnerProfileDeclaration['gradeBand'];
  topic: string;
  desiredOutcome: string;
  status: 'active' | 'completed' | 'archived';
  version: number;
}

export interface StudyObjectiveSnapshot extends LearningObjectiveDefinition {
  id: string;
}

export interface DiagnosticAttemptSnapshot {
  id: string;
  clientAttemptId: string;
  definitionVersion: string;
  attemptedItems: number;
  correctItems: number;
  submittedAt: string;
  progress: readonly DiagnosticObjectiveProgress[];
  nextObjectiveKey: string | null;
}

export interface StudyPlanSnapshot {
  profile: LearnerProfileSnapshot;
  goal: StudyGoalSnapshot;
  objectives: readonly StudyObjectiveSnapshot[];
  latestDiagnostic: DiagnosticAttemptSnapshot | null;
}

export interface PersistDiagnosticInput {
  trustedStudentId: string;
  goalId: string;
  sessionId: string;
  course: StudyCourseDefinition;
  graded: GradedDiagnostic;
}

export interface PersistDiagnosticResult {
  replayed: boolean;
  attempt: DiagnosticAttemptSnapshot;
}

/** 所有权或活动Goal不匹配统一收敛为不可见，避免泄露其他学生的学习记录。 */
export class StudyPlanNotFoundError extends Error {
  readonly code = 'study_plan_not_found';

  constructor() {
    super('学习计划不存在或不属于当前学生');
    this.name = 'StudyPlanNotFoundError';
  }
}

/** 同一客户端attempt ID携带不同答案时拒绝，不能把冲突重试当成安全重放。 */
export class DiagnosticAttemptConflictError extends Error {
  readonly code = 'diagnostic_attempt_conflict';

  constructor() {
    super('诊断提交ID已被不同答案占用');
    this.name = 'DiagnosticAttemptConflictError';
  }
}
