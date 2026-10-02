import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { learningGoals } from './schema';
import { requireNotebookStudySubmissionScope } from './notebook-study-submission-scope';
import {
  StudyPlanNotFoundError,
  type PersistDiagnosticInput,
} from './study-repository-contracts';
import type { StudyCourseDefinition } from '@educanvas/teaching-core';
type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function requireStudyDiagnosticScope(
  transaction: Transaction,
  input: PersistDiagnosticInput,
  course: StudyCourseDefinition,
) {
  const [goal] = await transaction
    .select()
    .from(learningGoals)
    .where(
      and(
        eq(learningGoals.id, input.goalId),
        eq(learningGoals.studentId, input.trustedStudentId),
      ),
    )
    .limit(1);
  if (
    !goal ||
    goal.courseSlug !== course.courseSlug ||
    goal.courseVersion !== course.version ||
    goal.gradeBand !== course.gradeBand ||
    input.graded.definitionVersion !== course.diagnostic.version
  )
    throw new StudyPlanNotFoundError();
  await requireNotebookStudySubmissionScope(transaction, {
    notebookId: goal.notebookId,
    goalId: input.goalId,
    sessionId: input.sessionId,
    trustedStudentId: input.trustedStudentId,
  });
}
