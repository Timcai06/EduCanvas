import type { ProgressDTO } from '@/features/learning/learning-contracts';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import type { OwnedStudyContext } from '../study/study-service';

export function scopeFor(
  identity: AnonymousIdentity,
  context: OwnedStudyContext,
) {
  return {
    studentId: identity.studentId,
    gradeBand: context.plan.goal.gradeBand,
    courseSlug: context.plan.goal.courseSlug,
    // 受信课程目录保证至少六个目标。
    knowledgeNodeId: context.course.objectives[0]!.knowledgeNodeId,
  };
}

export function toProgressDTO(input: {
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
