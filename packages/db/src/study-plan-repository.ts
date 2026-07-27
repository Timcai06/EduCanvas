import {
  learnerGradeBandSchema,
  learnerProfileDeclarationSchema,
  studyCourseDefinitionSchema,
  teachingPreferencesSchema,
  type DiagnosticObjectiveProgress,
} from '@educanvas/teaching-core';
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  conversations,
  lessonSessions,
  notebookMemberships,
  spaces,
} from './schema';
import {
  diagnosticAttempts,
  diagnosticResponses,
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

async function loadPlanByGoal(
  executor: DatabaseExecutor,
  trustedStudentId: string,
  goalId: string,
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
        eq(lessonSessions.studentId, trustedStudentId),
        eq(lessonSessions.status, 'active'),
      ),
    )
    .orderBy(desc(lessonSessions.lastActivityAt), desc(lessonSessions.id))
    .limit(1);
  if (!session) return null;
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
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async bootstrap(input: BootstrapStudyPlanInput): Promise<StudyPlanSnapshot> {
    const course = studyCourseDefinitionSchema.parse(input.course);
    if (input.profile.gradeBand !== course.gradeBand) {
      throw new Error('学习者年级与课程目录不匹配');
    }
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`study-plan:${input.trustedStudentId}`}, 0))`,
      );
      const now = new Date();
      const [ownedSession] = await transaction
        .select({
          notebookId: conversations.spaceId,
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
      const snapshot = await loadPlanByGoal(
        transaction,
        input.trustedStudentId,
        goalId,
      );
      if (!snapshot) throw new Error('学习计划写入后无法读取');
      return snapshot;
    });
  }

  async getActiveForStudent(
    trustedStudentId: string,
  ): Promise<StudyPlanSnapshot | null> {
    const [goal] = await this.database
      .select({ id: learningGoals.id })
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
      ? loadPlanByGoal(this.database, trustedStudentId, goal.id)
      : null;
  }

  async getOwnedBySession(
    trustedStudentId: string,
    sessionId: string,
  ): Promise<StudyPlanSnapshot | null> {
    const [goal] = await this.database
      .select({ id: learningGoals.id })
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
        ),
      )
      .limit(1);
    return goal
      ? loadPlanByGoal(this.database, trustedStudentId, goal.id)
      : null;
  }
}
