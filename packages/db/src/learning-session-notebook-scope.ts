import { and, eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  learningSessionScopeCondition,
  type LearningSessionLockScope,
} from './learning-session-locks';
import { requireNotebookAccess } from './notebook-access';
import {
  conversations,
  lessonSessions,
  notebookMemberships,
  spaces,
} from './schema';
type Database = ReturnType<typeof getDb>;
type Executor =
  Database | Parameters<Parameters<Database['transaction']>[0]>[0];

type NotebookSessionScope = {
  notebookId?: string;
  sessionId?: string;
};

type LearningCourseScope = NotebookSessionScope & {
  studentId: string;
  gradeBand: string;
  courseSlug: string;
};

type LearningOwnedScope = LearningCourseScope & {
  knowledgeNodeId: string;
};

export function learningSessionNotebookCondition(scope: NotebookSessionScope) {
  return and(
    scope.notebookId
      ? sql`${lessonSessions.notebookId} = ${scope.notebookId} and ${lessonSessions.conversationId} in (select id from conversations where space_id = ${scope.notebookId} and status = 'active')`
      : undefined,
    scope.sessionId ? eq(lessonSessions.id, scope.sessionId) : undefined,
  );
}

export function learningSessionCourseCondition(scope: LearningCourseScope) {
  return and(
    eq(lessonSessions.studentId, scope.studentId),
    eq(lessonSessions.gradeBand, scope.gradeBand),
    eq(lessonSessions.courseSlug, scope.courseSlug),
    learningSessionNotebookCondition(scope),
  );
}

export function learningOwnedSessionCondition(scope: LearningOwnedScope) {
  return and(
    learningSessionScopeCondition(scope),
    learningSessionNotebookCondition(scope),
  );
}

/** Lock membership before scope/Session locks, and recheck committed authority. */
export async function lockLearningNotebookAuthority(
  executor: Executor,
  notebookId: string,
  studentId: string,
  requiredPermission: 'notebook.manage' | 'conversation.reply',
) {
  await executor
    .select({ id: notebookMemberships.notebookId })
    .from(notebookMemberships)
    .where(
      and(
        eq(notebookMemberships.notebookId, notebookId),
        eq(notebookMemberships.userId, studentId),
      ),
    )
    .for('update');
  await executor
    .select({ id: spaces.id })
    .from(spaces)
    .where(eq(spaces.id, notebookId))
    .for('share');
  await requireNotebookAccess(executor, {
    notebookId,
    trustedSubjectId: studentId,
    requiredPermission,
  });
}

/** Derive a selected Session's immutable Notebook before locking or changing active records. */
export async function resolveLearningSessionNotebookScope(
  executor: Executor,
  scope: LearningSessionLockScope,
  sessionId: string,
  lockAuthorization = false,
): Promise<LearningSessionLockScope | null> {
  const [session] = await executor
    .select({
      notebookId: lessonSessions.notebookId,
      conversationId: lessonSessions.conversationId,
    })
    .from(lessonSessions)
    .where(
      and(
        eq(lessonSessions.id, sessionId),
        learningSessionScopeCondition(scope),
      ),
    )
    .limit(1);
  if (!session) return null;
  if (!session.notebookId)
    return session.conversationId === null ? scope : null;
  if (lockAuthorization) {
    const authorized = await lockLearningNotebookAuthority(
      executor,
      session.notebookId,
      scope.studentId,
      'conversation.reply',
    ).then(
      () => true,
      () => false,
    );
    if (!authorized) return null;
  }
  const [conversation] = await executor
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, session.conversationId!),
        eq(conversations.spaceId, session.notebookId),
        eq(conversations.status, 'active'),
      ),
    )
    .limit(1);
  if (!conversation) return null;
  const access = await requireNotebookAccess(executor, {
    notebookId: session.notebookId,
    trustedSubjectId: scope.studentId,
    requiredPermission: 'notebook.read',
  }).catch(() => null);
  return access ? { ...scope, notebookId: session.notebookId } : null;
}
