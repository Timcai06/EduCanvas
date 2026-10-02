import {
  learnerGradeBandSchema,
  learnerProfileDeclarationSchema,
  studyCourseDefinitionSchema,
} from '@educanvas/teaching-core';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import { NotebookAccessNotFoundError } from './notebook-access';
import { lockLearningNotebookAuthority } from './learning-session-notebook-scope';
import {
  loadActiveNotebookStudyPlan,
  loadPlanByGoal,
  readNotebookStudyResumeCandidate,
} from './study-plan-context';
import { enqueueCourseKnowledgePublication } from './course-knowledge-publication';
import {
  conversations,
  lessonSessions,
  notebookMemberships,
  spaces,
} from './schema';
import {
  learnerProfiles,
  learningGoals,
  learningObjectives,
} from './schema/study';
import {
  StudyPlanNotFoundError,
  type BootstrapStudyPlanInput,
  type DiagnosticAttemptSnapshot,
  type StudyPlanSnapshot,
} from './study-repository-contracts';
type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;
async function upsertProfile(
  transaction: DatabaseTransaction,
  input: BootstrapStudyPlanInput,
  now: Date,
): Promise<void> {
  const profile = learnerProfileDeclarationSchema.parse(input.profile);
  const [existing] = await transaction
    .select()
    .from(learnerProfiles)
    .where(eq(learnerProfiles.studentId, input.trustedStudentId))
    .limit(1);
  const same =
    existing &&
    existing.ageBand === profile.ageBand &&
    existing.defaultGradeBand === profile.gradeBand &&
    existing.declarationSource === profile.declarationSource &&
    existing.declaredByUserId === input.declaredByUserId &&
    JSON.stringify(existing.preferences) ===
      JSON.stringify(profile.preferences);
  if (same) return;
  if (!existing) {
    await transaction.insert(learnerProfiles).values({
      studentId: input.trustedStudentId,
      ageBand: profile.ageBand,
      defaultGradeBand: profile.gradeBand,
      declarationSource: profile.declarationSource,
      declaredByUserId: input.declaredByUserId,
      preferences: profile.preferences,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }
  await transaction
    .update(learnerProfiles)
    .set({
      ageBand: profile.ageBand,
      defaultGradeBand: profile.gradeBand,
      declarationSource: profile.declarationSource,
      declaredByUserId: input.declaredByUserId,
      preferences: profile.preferences,
      version: sql`${learnerProfiles.version} + 1`,
      updatedAt: now,
    })
    .where(eq(learnerProfiles.studentId, input.trustedStudentId));
}

/** 学习者画像与Notebook Goal/Objectives的服务端权威仓储。 */
export class DrizzleStudyPlanRepository {
  constructor(
    private readonly providedDatabase?: Database | DatabaseTransaction,
  ) {}

  private get database(): Database | DatabaseTransaction {
    return this.providedDatabase ?? getDb();
  }

  async bootstrap(input: BootstrapStudyPlanInput): Promise<StudyPlanSnapshot> {
    const course = studyCourseDefinitionSchema.parse(input.course);
    if (input.profile.gradeBand !== course.gradeBand) {
      throw new Error('学习者年级与课程目录不匹配');
    }
    return this.database.transaction(async (transaction) => {
      const [selected] = await transaction
        .select({ notebookId: lessonSessions.notebookId })
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.id, input.sessionId),
            eq(lessonSessions.studentId, input.trustedStudentId),
          ),
        )
        .limit(1);
      if (!selected?.notebookId) throw new StudyPlanNotFoundError();
      try {
        await lockLearningNotebookAuthority(
          transaction,
          selected.notebookId,
          input.trustedStudentId,
          'notebook.manage',
        );
      } catch (error) {
        if (error instanceof NotebookAccessNotFoundError)
          throw new StudyPlanNotFoundError();
        throw error;
      }
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`study-plan:${input.trustedStudentId}`}, 0))`,
      );
      const now = new Date();
      const [ownedSession] = await transaction
        .select({
          notebookId: conversations.spaceId,
          sessionNotebookId: lessonSessions.notebookId,
          gradeBand: lessonSessions.gradeBand,
          courseSlug: lessonSessions.courseSlug,
          knowledgeNodeId: lessonSessions.knowledgeNodeId,
        })
        .from(lessonSessions)
        .innerJoin(
          conversations,
          eq(conversations.id, lessonSessions.conversationId),
        )
        .innerJoin(spaces, eq(spaces.id, conversations.spaceId))
        .innerJoin(
          notebookMemberships,
          and(
            eq(notebookMemberships.notebookId, spaces.id),
            eq(notebookMemberships.userId, input.trustedStudentId),
          ),
        )
        .where(
          and(
            eq(lessonSessions.id, input.sessionId),
            eq(lessonSessions.studentId, input.trustedStudentId),
            eq(lessonSessions.status, 'active'),
            eq(conversations.ownerSubjectId, input.trustedStudentId),
            eq(conversations.status, 'active'),
            eq(spaces.ownerSubjectId, input.trustedStudentId),
            eq(spaces.status, 'active'),
            eq(notebookMemberships.role, 'owner'),
            isNull(notebookMemberships.revokedAt),
            or(
              isNull(notebookMemberships.expiresAt),
              gt(notebookMemberships.expiresAt, now),
            ),
          ),
        )
        .limit(1)
        .for('update', { of: notebookMemberships });
      if (
        !ownedSession ||
        ownedSession.sessionNotebookId !== ownedSession.notebookId ||
        ownedSession.gradeBand !== course.gradeBand ||
        ownedSession.courseSlug !== course.courseSlug ||
        ownedSession.knowledgeNodeId !== course.objectives[0]?.knowledgeNodeId
      ) {
        throw new StudyPlanNotFoundError();
      }
      await upsertProfile(transaction, input, now);
      const [existingGoal] = await transaction
        .select()
        .from(learningGoals)
        .where(
          and(
            eq(learningGoals.notebookId, ownedSession.notebookId),
            eq(learningGoals.studentId, input.trustedStudentId),
            eq(learningGoals.status, 'active'),
          ),
        )
        .limit(1);
      const sameGoal =
        existingGoal &&
        existingGoal.courseSlug === course.courseSlug &&
        existingGoal.courseVersion === course.version &&
        existingGoal.gradeBand === course.gradeBand &&
        existingGoal.topic === course.title &&
        existingGoal.desiredOutcome === input.desiredOutcome;
      let goalId = existingGoal?.id;
      if (!sameGoal) {
        if (existingGoal) {
          await transaction
            .update(learningGoals)
            .set({
              status: 'archived',
              archivedAt: now,
              updatedAt: now,
            })
            .where(eq(learningGoals.id, existingGoal.id));
        }
        const [createdGoal] = await transaction
          .insert(learningGoals)
          .values({
            notebookId: ownedSession.notebookId,
            studentId: input.trustedStudentId,
            courseSlug: course.courseSlug,
            courseVersion: course.version,
            gradeBand: course.gradeBand,
            topic: course.title,
            desiredOutcome: input.desiredOutcome,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: learningGoals.id });
        if (!createdGoal) throw new Error('学习目标写入失败');
        goalId = createdGoal.id;
        await transaction.insert(learningObjectives).values(
          course.objectives.map((objective) => ({
            goalId: createdGoal.id,
            objectiveKey: objective.objectiveKey,
            knowledgeNodeId: objective.knowledgeNodeId,
            title: objective.title,
            description: objective.description,
            sequence: objective.sequence,
            prerequisiteObjectiveKeys: objective.prerequisiteObjectiveKeys,
            createdAt: now,
          })),
        );
      }
      if (!goalId) throw new Error('活动学习目标缺少ID');
      await enqueueCourseKnowledgePublication(transaction, input, course);
      const snapshot = await loadPlanByGoal(
        transaction,
        input.trustedStudentId,
        goalId,
        undefined,
        false,
        input.sessionId,
      );
      if (!snapshot) throw new Error('学习计划写入后无法读取');
      return snapshot;
    });
  }

  async getActiveForStudent(
    trustedStudentId: string,
  ): Promise<StudyPlanSnapshot | null> {
    const [goal] = await this.database
      .select({ id: learningGoals.id, sessionId: lessonSessions.id })
      .from(learningGoals)
      .innerJoin(
        conversations,
        eq(conversations.spaceId, learningGoals.notebookId),
      )
      .innerJoin(
        lessonSessions,
        eq(lessonSessions.conversationId, conversations.id),
      )
      .where(
        and(
          eq(learningGoals.studentId, trustedStudentId),
          eq(learningGoals.status, 'active'),
          eq(lessonSessions.studentId, trustedStudentId),
          eq(lessonSessions.notebookId, learningGoals.notebookId),
          eq(lessonSessions.courseSlug, learningGoals.courseSlug),
          eq(lessonSessions.gradeBand, learningGoals.gradeBand),
          eq(lessonSessions.status, 'active'),
          eq(conversations.status, 'active'),
        ),
      )
      // 恢复旧 Notebook 不改消息活动时间，但会更新 Session.updatedAt；
      // 因此这里按当前活动 Session 选计划，不能按“最近创建的 Goal”猜当前 Notebook。
      .orderBy(
        desc(lessonSessions.updatedAt),
        desc(learningGoals.updatedAt),
        desc(learningGoals.id),
      )
      .limit(1);
    return goal
      ? loadPlanByGoal(
          this.database,
          trustedStudentId,
          goal.id,
          undefined,
          false,
          goal.sessionId,
        )
      : null;
  }

  /** Explicit Notebook selection never falls back to another Notebook's active course. */
  async getActiveForNotebook(
    trustedStudentId: string,
    notebookId: string,
    conversationId?: string,
    includeArchived = false,
  ): Promise<StudyPlanSnapshot | null> {
    return loadActiveNotebookStudyPlan(
      this.database,
      trustedStudentId,
      notebookId,
      conversationId,
      includeArchived,
    );
  }

  readNotebookStudyResumeCandidate(
    trustedStudentId: string,
    notebookId: string,
  ) {
    return readNotebookStudyResumeCandidate(
      this.database,
      trustedStudentId,
      notebookId,
    );
  }

  async getOwnedBySession(
    trustedStudentId: string,
    sessionId: string,
  ): Promise<StudyPlanSnapshot | null> {
    const [goal] = await this.database
      .select({ id: learningGoals.id, sessionId: lessonSessions.id })
      .from(learningGoals)
      .innerJoin(
        conversations,
        eq(conversations.spaceId, learningGoals.notebookId),
      )
      .innerJoin(
        lessonSessions,
        eq(lessonSessions.conversationId, conversations.id),
      )
      .where(
        and(
          eq(learningGoals.studentId, trustedStudentId),
          eq(learningGoals.status, 'active'),
          eq(lessonSessions.id, sessionId),
          eq(lessonSessions.studentId, trustedStudentId),
          eq(lessonSessions.notebookId, learningGoals.notebookId),
          eq(lessonSessions.courseSlug, learningGoals.courseSlug),
          eq(lessonSessions.gradeBand, learningGoals.gradeBand),
        ),
      )
      .limit(1);
    return goal
      ? loadPlanByGoal(
          this.database,
          trustedStudentId,
          goal.id,
          undefined,
          false,
          goal.sessionId,
        )
      : null;
  }
}
