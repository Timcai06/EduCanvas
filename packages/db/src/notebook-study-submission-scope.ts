import { and, eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import {
  conversations,
  learningGoals,
  lessonSessions,
  notebookMemberships,
} from './schema';
import { StudyPlanNotFoundError } from './study-repository-contracts';

export interface NotebookStudySubmissionScope {
  notebookId: string;
  sessionId: string;
  goalId: string;
  trustedStudentId: string;
}
type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lock the exact page's authority and curriculum before writing learning facts. */
export async function requireNotebookStudySubmissionScope(
  transaction: Transaction,
  scope: NotebookStudySubmissionScope,
) {
  if (
    ![scope.notebookId, scope.sessionId, scope.goalId].every((id) =>
      uuid.test(id),
    )
  )
    throw new StudyPlanNotFoundError();
  await transaction
    .select({ notebookId: notebookMemberships.notebookId })
    .from(notebookMemberships)
    .where(
      and(
        eq(notebookMemberships.notebookId, scope.notebookId),
        eq(notebookMemberships.userId, scope.trustedStudentId),
      ),
    )
    .for('update');
  await requireNotebookAccess(transaction, {
    notebookId: scope.notebookId,
    trustedSubjectId: scope.trustedStudentId,
    requiredPermission: 'conversation.reply',
  });
  const [row] = await transaction
    .select({ id: lessonSessions.id })
    .from(learningGoals)
    .innerJoin(
      lessonSessions,
      eq(lessonSessions.notebookId, learningGoals.notebookId),
    )
    .innerJoin(
      conversations,
      eq(conversations.id, lessonSessions.conversationId),
    )
    .where(
      and(
        eq(learningGoals.id, scope.goalId),
        eq(learningGoals.notebookId, scope.notebookId),
        eq(learningGoals.studentId, scope.trustedStudentId),
        eq(learningGoals.status, 'active'),
        eq(lessonSessions.id, scope.sessionId),
        eq(lessonSessions.studentId, scope.trustedStudentId),
        eq(lessonSessions.status, 'active'),
        eq(lessonSessions.courseSlug, learningGoals.courseSlug),
        eq(lessonSessions.gradeBand, learningGoals.gradeBand),
        eq(conversations.spaceId, scope.notebookId),
        eq(conversations.status, 'active'),
        sql`${lessonSessions.knowledgeNodeId} = (select knowledge_node_id from learning_objectives where goal_id = ${scope.goalId} order by sequence limit 1)`,
      ),
    )
    .limit(1)
    .for('update', { of: [learningGoals, lessonSessions, conversations] });
  if (!row) throw new StudyPlanNotFoundError();
}
