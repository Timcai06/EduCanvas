import { selectInitialState } from '@educanvas/teaching-core';
import { and, eq, sql } from 'drizzle-orm';
import { isAnonymousSyntheticSubjectId } from './anonymous-data-lifecycle';
import { ensurePersonalIdentity } from './gateway-repository';
import {
  learningSessionScopeCondition,
  type DatabaseTransaction,
  type LearningSessionLockScope,
} from './learning-session-locks';
import {
  conversations,
  lessonSessions,
  masteryStates,
  notebookMemberships,
  spaces,
} from './schema';

/** 在已持有 Session scope 锁的事务中建立 Notebook、Conversation 与 active Session。 */
export async function insertActiveLearningSession(
  transaction: DatabaseTransaction,
  scope: LearningSessionLockScope,
  now: Date,
): Promise<string> {
  const [existingMastery] = await transaction
    .select({ studentId: masteryStates.studentId })
    .from(masteryStates)
    .where(
      and(
        eq(masteryStates.studentId, scope.studentId),
        eq(masteryStates.knowledgeNodeId, scope.knowledgeNodeId),
      ),
    )
    .limit(1);
  const [space] = await transaction
    .insert(spaces)
    .values({
      ownerSubjectId: scope.studentId,
      kind: 'course',
      title: scope.courseSlug,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: spaces.id });
  if (!space) throw new Error('学习Space写入失败');
  const identity = await ensurePersonalIdentity(transaction, {
    userId: scope.studentId,
    kind: isAnonymousSyntheticSubjectId(scope.studentId)
      ? 'anonymous_compat'
      : 'registered',
    now,
  });
  await transaction.insert(notebookMemberships).values({
    notebookId: space.id,
    userId: identity.userId,
    role: 'owner',
    grantedByUserId: identity.userId,
    grantedAt: now,
  });
  const [conversation] = await transaction
    .insert(conversations)
    .values({
      spaceId: space.id,
      ownerSubjectId: scope.studentId,
      agentProfileId: 'k12.teacher',
      title: scope.courseSlug,
      status: 'active',
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: conversations.id });
  if (!conversation) throw new Error('学习Conversation写入失败');
  const [created] = await transaction
    .insert(lessonSessions)
    .values({
      conversationId: conversation.id,
      studentId: scope.studentId,
      gradeBand: scope.gradeBand,
      courseSlug: scope.courseSlug,
      knowledgeNodeId: scope.knowledgeNodeId,
      state: selectInitialState(Boolean(existingMastery)),
      status: 'active',
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: lessonSessions.id });
  if (!created) throw new Error('学习会话写入失败');
  return created.id;
}

/** 归档 scope 中除可选保留项之外的 active Session；调用方必须已持有 scope 锁。 */
export async function archiveActiveLearningSessionScope(
  transaction: DatabaseTransaction,
  scope: LearningSessionLockScope,
  now: Date,
  exceptSessionId?: string,
): Promise<void> {
  await transaction
    .update(lessonSessions)
    .set({ status: 'archived', archivedAt: now, updatedAt: now })
    .where(
      and(
        learningSessionScopeCondition(scope),
        eq(lessonSessions.status, 'active'),
        exceptSessionId
          ? sql`${lessonSessions.id} <> ${exceptSessionId}`
          : undefined,
      ),
    );
}
