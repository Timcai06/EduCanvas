import {
  learnerGradeBandSchema,
  learnerProfileDeclarationSchema,
  teachingPreferencesSchema,
  type DiagnosticObjectiveProgress,
} from '@educanvas/teaching-core';
import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import {
  conversations,
  lessonSessions,
  diagnosticAttempts,
  diagnosticResponses,
  learnerProfiles,
  learningGoals,
  learningObjectives,
} from './schema';
import type {
  StudyPlanSnapshot,
  DiagnosticAttemptSnapshot,
} from './study-repository-contracts';
type Database = ReturnType<typeof getDb>;
type DatabaseExecutor =
  Database | Parameters<Parameters<Database['transaction']>[0]>[0];
async function loadLatestDiagnostic(
  executor: DatabaseExecutor,
  goalId: string,
  objectives: StudyPlanSnapshot['objectives'],
): Promise<DiagnosticAttemptSnapshot | null> {
  const [attempt] = await executor
    .select()
    .from(diagnosticAttempts)
    .where(eq(diagnosticAttempts.goalId, goalId))
    .orderBy(desc(diagnosticAttempts.submittedAt), desc(diagnosticAttempts.id))
    .limit(1);
  if (!attempt) return null;
  const responses = await executor
    .select({
      objectiveId: diagnosticResponses.objectiveId,
      isCorrect: diagnosticResponses.isCorrect,
    })
    .from(diagnosticResponses)
    .where(eq(diagnosticResponses.attemptId, attempt.id));
  const responseByObjective = new Map(
    responses.map((response) => [response.objectiveId, response]),
  );
  const progress: DiagnosticObjectiveProgress[] = objectives.map(
    (objective) => {
      const response = responseByObjective.get(objective.id);
      return {
        objectiveKey: objective.objectiveKey,
        knowledgeNodeId: objective.knowledgeNodeId,
        title: objective.title,
        status: response
          ? response.isCorrect
            ? 'strength'
            : 'focus'
          : 'not_started',
        attemptedItems: response ? 1 : 0,
        correctItems: response?.isCorrect ? 1 : 0,
      };
    },
  );
  const nextObjective =
    progress.find((objective) => objective.status === 'focus') ??
    progress.find((objective) => objective.status === 'not_started') ??
    null;
  return {
    id: attempt.id,
    clientAttemptId: attempt.clientAttemptId,
    definitionVersion: attempt.definitionVersion,
    attemptedItems: attempt.attemptedItems,
    correctItems: attempt.correctItems,
    submittedAt: attempt.submittedAt.toISOString(),
    progress,
    nextObjectiveKey: nextObjective?.objectiveKey ?? null,
  };
}

export async function loadPlanByGoal(
  executor: DatabaseExecutor,
  trustedStudentId: string,
  goalId: string,
  conversationId?: string,
  includeArchived = false,
  sessionId?: string,
): Promise<StudyPlanSnapshot | null> {
  const [goal] = await executor
    .select()
    .from(learningGoals)
    .where(
      and(
        eq(learningGoals.id, goalId),
        eq(learningGoals.studentId, trustedStudentId),
      ),
    )
    .limit(1);
  if (!goal) return null;
  const [profile] = await executor
    .select()
    .from(learnerProfiles)
    .where(eq(learnerProfiles.studentId, trustedStudentId))
    .limit(1);
  if (!profile) return null;
  const objectiveRows = await executor
    .select()
    .from(learningObjectives)
    .where(eq(learningObjectives.goalId, goal.id))
    .orderBy(asc(learningObjectives.sequence));
  const objectives = objectiveRows.map((objective) => ({
    id: objective.id,
    objectiveKey: objective.objectiveKey,
    knowledgeNodeId: objective.knowledgeNodeId,
    title: objective.title,
    description: objective.description,
    sequence: objective.sequence,
    prerequisiteObjectiveKeys: objective.prerequisiteObjectiveKeys,
  }));
  if (!objectives[0]) return null;
  const [session] = await executor
    .select({ id: lessonSessions.id })
    .from(lessonSessions)
    .innerJoin(
      conversations,
      eq(conversations.id, lessonSessions.conversationId),
    )
    .where(
      and(
        eq(conversations.spaceId, goal.notebookId),
        eq(conversations.status, 'active'),
        conversationId ? eq(conversations.id, conversationId) : undefined,
        eq(lessonSessions.studentId, trustedStudentId),
        eq(lessonSessions.notebookId, goal.notebookId),
        eq(lessonSessions.gradeBand, goal.gradeBand),
        eq(lessonSessions.courseSlug, goal.courseSlug),
        eq(lessonSessions.knowledgeNodeId, objectives[0].knowledgeNodeId),
        sessionId ? eq(lessonSessions.id, sessionId) : undefined,
        includeArchived ? undefined : eq(lessonSessions.status, 'active'),
      ),
    )
    .orderBy(desc(lessonSessions.lastActivityAt), desc(lessonSessions.id))
    .limit(1);
  if (!session) return null;
  const parsedProfile = learnerProfileDeclarationSchema.parse({
    ageBand: profile.ageBand,
    gradeBand: profile.defaultGradeBand,
    declarationSource: profile.declarationSource,
    preferences: teachingPreferencesSchema.parse(profile.preferences),
  });
  const status = goal.status as 'active' | 'completed' | 'archived';
  return {
    profile: {
      studentId: profile.studentId,
      declaredByUserId: profile.declaredByUserId,
      ...parsedProfile,
      version: profile.version,
      updatedAt: profile.updatedAt.toISOString(),
    },
    goal: {
      id: goal.id,
      notebookId: goal.notebookId,
      studentId: goal.studentId,
      sessionId: session.id,
      courseSlug: goal.courseSlug,
      courseVersion: goal.courseVersion,
      gradeBand: learnerGradeBandSchema.parse(goal.gradeBand),
      topic: goal.topic,
      desiredOutcome: goal.desiredOutcome,
      status,
      version: goal.version,
    },
    objectives,
    latestDiagnostic: await loadLatestDiagnostic(executor, goal.id, objectives),
  };
}

export async function loadActiveNotebookStudyPlan(
  executor: DatabaseExecutor,
  trustedStudentId: string,
  notebookId: string,
  conversationId?: string,
  includeArchived = false,
): Promise<StudyPlanSnapshot | null> {
  await requireNotebookAccess(executor, {
    notebookId,
    trustedSubjectId: trustedStudentId,
    requiredPermission: 'notebook.read',
  });
  const [goal] = await executor
    .select({ id: learningGoals.id })
    .from(learningGoals)
    .where(
      and(
        eq(learningGoals.studentId, trustedStudentId),
        eq(learningGoals.notebookId, notebookId),
        eq(learningGoals.status, 'active'),
      ),
    )
    .limit(1);
  return goal
    ? loadPlanByGoal(
        executor,
        trustedStudentId,
        goal.id,
        conversationId,
        includeArchived,
      )
    : null;
}

export async function readNotebookStudyResumeCandidate(
  executor: DatabaseExecutor,
  trustedStudentId: string,
  notebookId: string,
) {
  await requireNotebookAccess(executor, {
    notebookId,
    trustedSubjectId: trustedStudentId,
    requiredPermission: 'notebook.read',
  });
  const [goal] = await executor
    .select()
    .from(learningGoals)
    .where(
      and(
        eq(learningGoals.notebookId, notebookId),
        eq(learningGoals.studentId, trustedStudentId),
        eq(learningGoals.status, 'active'),
      ),
    )
    .limit(1);
  if (!goal) return { kind: 'empty' as const };
  const [session] = await executor
    .select({
      id: lessonSessions.id,
      lastActivityAt: lessonSessions.lastActivityAt,
    })
    .from(lessonSessions)
    .innerJoin(
      conversations,
      eq(conversations.id, lessonSessions.conversationId),
    )
    .where(
      and(
        eq(conversations.spaceId, notebookId),
        eq(conversations.status, 'active'),
        eq(lessonSessions.studentId, trustedStudentId),
        eq(lessonSessions.status, 'archived'),
        eq(lessonSessions.notebookId, notebookId),
        eq(lessonSessions.courseSlug, goal.courseSlug),
        eq(lessonSessions.gradeBand, goal.gradeBand),
      ),
    )
    .orderBy(desc(lessonSessions.lastActivityAt), desc(lessonSessions.id))
    .limit(1);
  return session &&
    session.lastActivityAt.getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000
    ? { kind: 'resume' as const, sessionId: session.id, topic: goal.topic }
    : { kind: 'unavailable' as const };
}
