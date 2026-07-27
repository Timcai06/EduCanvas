import { and, eq, sql } from 'drizzle-orm';
import {
  anonymousSubjectLockKey,
  isAnonymousSyntheticSubjectId,
} from './anonymous-data-lifecycle';
import { getDb } from './client';
import { lessonSessions } from './schema';

type Database = ReturnType<typeof getDb>;
export type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export interface LearningSessionLockScope {
  studentId: string;
  gradeBand: string;
  courseSlug: string;
  knowledgeNodeId: string;
}

function scopeLockKey(scope: LearningSessionLockScope): string {
  return [
    'lesson-session-scope-v2',
    scope.studentId,
    scope.gradeBand,
    scope.courseSlug,
    scope.knowledgeNodeId,
  ].join(':');
}

/** 所有改变 active Session 的事务必须按此固定顺序持有主体锁与课程 scope 锁。 */
export async function lockLearningSessionScope(
  transaction: DatabaseTransaction,
  scope: LearningSessionLockScope,
): Promise<void> {
  if (isAnonymousSyntheticSubjectId(scope.studentId)) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${anonymousSubjectLockKey(scope.studentId)}, 0))`,
    );
  }
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${scopeLockKey(scope)}, 0))`,
  );
}

export function learningSessionScopeCondition(scope: LearningSessionLockScope) {
  return and(
    eq(lessonSessions.studentId, scope.studentId),
    eq(lessonSessions.gradeBand, scope.gradeBand),
    eq(lessonSessions.courseSlug, scope.courseSlug),
    eq(lessonSessions.knowledgeNodeId, scope.knowledgeNodeId),
  );
}
