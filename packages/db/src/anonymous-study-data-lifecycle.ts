import { eq, inArray } from 'drizzle-orm';
import { getDb } from './client';
import {
  diagnosticAttempts,
  diagnosticResponses,
  learnerProfiles,
  learningGoals,
  learningObjectives,
} from './schema/study';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

interface StudyDeletionContext {
  transaction: DatabaseTransaction;
  subjectId: string;
}

async function deleteDiagnosticResponses(
  context: StudyDeletionContext,
): Promise<number> {
  const attempts = await context.transaction
    .select({ id: diagnosticAttempts.id })
    .from(diagnosticAttempts)
    .where(eq(diagnosticAttempts.studentId, context.subjectId));
  if (attempts.length === 0) return 0;
  return (
    await context.transaction
      .delete(diagnosticResponses)
      .where(
        inArray(
          diagnosticResponses.attemptId,
          attempts.map((attempt) => attempt.id),
        ),
      )
      .returning({ attemptId: diagnosticResponses.attemptId })
  ).length;
}

async function deleteDiagnosticAttempts(
  context: StudyDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(diagnosticAttempts)
      .where(eq(diagnosticAttempts.studentId, context.subjectId))
      .returning({ id: diagnosticAttempts.id })
  ).length;
}

async function deleteLearningObjectives(
  context: StudyDeletionContext,
): Promise<number> {
  const goals = await context.transaction
    .select({ id: learningGoals.id })
    .from(learningGoals)
    .where(eq(learningGoals.studentId, context.subjectId));
  if (goals.length === 0) return 0;
  return (
    await context.transaction
      .delete(learningObjectives)
      .where(
        inArray(
          learningObjectives.goalId,
          goals.map((goal) => goal.id),
        ),
      )
      .returning({ id: learningObjectives.id })
  ).length;
}

async function deleteLearningGoals(
  context: StudyDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(learningGoals)
      .where(eq(learningGoals.studentId, context.subjectId))
      .returning({ id: learningGoals.id })
  ).length;
}

async function deleteLearnerProfiles(
  context: StudyDeletionContext,
): Promise<number> {
  return (
    await context.transaction
      .delete(learnerProfiles)
      .where(eq(learnerProfiles.studentId, context.subjectId))
      .returning({ studentId: learnerProfiles.studentId })
  ).length;
}

/** 匿名主体的 P1 学习计划删除闭包；顺序先叶子后根，不依赖数据库级联。 */
export const anonymousStudyLifecycleDefinitions = [
  {
    tableName: 'diagnostic_responses',
    ownershipPath: 'attempt_id -> diagnostic_attempts.student_id',
    deleteRows: deleteDiagnosticResponses,
  },
  {
    tableName: 'diagnostic_attempts',
    ownershipPath: 'student_id',
    deleteRows: deleteDiagnosticAttempts,
  },
  {
    tableName: 'learning_objectives',
    ownershipPath: 'goal_id -> learning_goals.student_id',
    deleteRows: deleteLearningObjectives,
  },
  {
    tableName: 'learning_goals',
    ownershipPath: 'student_id',
    deleteRows: deleteLearningGoals,
  },
  {
    tableName: 'learner_profiles',
    ownershipPath: 'student_id',
    deleteRows: deleteLearnerProfiles,
  },
] as const;
