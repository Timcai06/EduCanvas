import 'server-only';

import { canvasInteractionEventSchema } from '@educanvas/canvas-protocol';
import { DrizzleLearningSessionRepository } from '@educanvas/db';
import type { GradeCanvasSubmissionOutcome } from '@educanvas/teaching-runtime';
import type {
  CanvasSubmissionInput,
  LearningPageDTO,
  ProgressDTO,
} from '@/features/learning/learning-contracts';
import {
  readAnonymousIdentity,
  type AnonymousIdentity,
} from './anonymous-identity';
import { demoLesson } from './demo-lesson';
import { gradeCanvasSubmissionService } from './teaching-runtime';

const learningSessions = new DrizzleLearningSessionRepository();

function scopeFor(studentId: string) {
  return {
    studentId,
    gradeBand: demoLesson.gradeBand,
    courseSlug: demoLesson.courseSlug,
    knowledgeNodeId: demoLesson.knowledgeNodeId,
  };
}

function toProgressDTO(input: {
  knowledgeNodeId: string;
  masteryScore: number;
  attemptCount: number;
  correctCount: number;
  hintCount: number;
  nextReviewAt: string | null;
}): ProgressDTO {
  return {
    knowledgeNodeId: input.knowledgeNodeId,
    masteryPercent: Math.round(input.masteryScore * 100),
    attemptedItems: input.attemptCount,
    correctItems: input.correctCount,
    hintCount: input.hintCount,
    nextReviewAt: input.nextReviewAt,
  };
}

/** Cookie创建由Action负责；本函数只在数据库成功bootstrap后被调用。 */
export async function bootstrapAnonymousLesson(
  identity: AnonymousIdentity,
): Promise<void> {
  await learningSessions.bootstrap({
    ...scopeFor(identity.studentId),
    completeArtifact: demoLesson.artifact,
  });
}

/** 只有已经绑定当前有效会话的Cookie才允许在start Action中继续复用。 */
export async function hasActiveAnonymousLesson(
  identity: AnonymousIdentity,
): Promise<boolean> {
  return Boolean(
    await learningSessions.getCurrentOwned(scopeFor(identity.studentId)),
  );
}

/** 页面只得到公共Artifact和公开进度，不得到session、student或判分键。 */
export async function loadLearningPageData(): Promise<LearningPageDTO | null> {
  const identity = await readAnonymousIdentity();
  if (!identity) return null;
  const snapshot = await learningSessions.getPageSnapshot(
    scopeFor(identity.studentId),
    demoLesson.artifact.artifactId,
  );
  if (!snapshot) return null;
  return {
    artifact: snapshot.artifact,
    progress: snapshot.mastery
      ? toProgressDTO({
          knowledgeNodeId: snapshot.knowledgeNodeId,
          ...snapshot.mastery,
        })
      : null,
  };
}

export type OwnedCanvasSubmissionOutcome =
  | { authenticated: false }
  | { authenticated: true; outcome: GradeCanvasSubmissionOutcome };

/** Action没有session参数；当前会话完全由可信Cookie身份和固定课程范围恢复。 */
export async function submitOwnedCanvas(
  input: CanvasSubmissionInput,
): Promise<OwnedCanvasSubmissionOutcome> {
  const parsed = canvasInteractionEventSchema.safeParse(input);
  if (!parsed.success) {
    return {
      authenticated: true,
      outcome: { ok: false, code: 'INVALID_CLIENT_EVENT' },
    };
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return { authenticated: false };
  const session = await learningSessions.getCurrentOwned(
    scopeFor(identity.studentId),
  );
  if (!session) return { authenticated: false };

  return {
    authenticated: true,
    outcome: await gradeCanvasSubmissionService.execute({
      trustedStudentId: identity.studentId,
      sessionId: session.sessionId,
      clientEvent: parsed.data,
      prerequisiteScores: [],
    }),
  };
}

export function progressFromSubmission(
  outcome: Extract<GradeCanvasSubmissionOutcome, { ok: true }>,
): ProgressDTO {
  return toProgressDTO({
    knowledgeNodeId: outcome.mastery.knowledgeNodeId,
    masteryScore: outcome.mastery.masteryScore,
    attemptCount: outcome.mastery.attemptCount,
    correctCount: outcome.mastery.correctCount,
    hintCount: outcome.mastery.hintCount,
    nextReviewAt: outcome.mastery.nextReviewAt,
  });
}
