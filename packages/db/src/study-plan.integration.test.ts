import { gradeDiagnostic } from '@educanvas/teaching-core';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleAnonymousDataLifecycleService } from './anonymous-data-lifecycle';
import { DrizzleLearningSessionRepository } from './learning-session-repository';
import * as baseSchema from './schema';
import * as studySchema from './schema/study';
import { DrizzleStudyDiagnosticRepository } from './study-diagnostic-repository';
import { DrizzleStudyBootstrapCompensator } from './study-bootstrap-compensator';
import { DrizzleStudyPlanRepository } from './study-plan-repository';
import {
  DiagnosticAttemptConflictError,
  StudyPlanNotFoundError,
} from './study-repository-contracts';
import {
  bootstrapStudyTestPlan,
  studyTestArtifact as artifact,
  studyTestCourse as course,
  studyTestScope,
} from './study-plan.integration-support';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error(
      '集成测试数据库名必须以_integration或_test结尾，拒绝清空非测试数据库',
    );
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 10 })
  : null;
const schema = { ...baseSchema, ...studySchema };
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

function bootstrapPlan(studentId?: string) {
  return bootstrapStudyTestPlan(getDatabase(), studentId);
}

function gradeAttempt(
  attemptId: string,
  selectedOptionIds = ['q1-correct', 'q2-wrong', 'q3-correct'],
) {
  const decision = gradeDiagnostic(course, {
    attemptId,
    answers: selectedOptionIds.map((selectedOptionId, index) => ({
      questionId: `question-${index + 1}`,
      selectedOptionId,
    })),
  });
  if (!decision.ok) throw new Error(`fixture_grading_failed:${decision.code}`);
  return decision.result;
}

describeWithDatabase('学习计划与可信诊断仓储', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table mastery_states, lesson_sessions, spaces, platform_users restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('幂等建立显式画像、Notebook Goal和六节点目标图', async () => {
    const first = await bootstrapPlan();
    const second = await new DrizzleStudyPlanRepository(
      getDatabase(),
    ).bootstrap({
      trustedStudentId: first.plan.goal.studentId,
      declaredByUserId: first.plan.profile.declaredByUserId,
      sessionId: first.session.sessionId,
      desiredOutcome: first.plan.goal.desiredOutcome,
      profile: {
        ageBand: first.plan.profile.ageBand,
        gradeBand: first.plan.profile.gradeBand,
        declarationSource: first.plan.profile.declarationSource,
        preferences: first.plan.profile.preferences,
      },
      course,
    });

    expect(second.goal.id).toBe(first.plan.goal.id);
    expect(second.objectives).toHaveLength(6);
    expect(second.profile).toMatchObject({
      ageBand: '13_to_15',
      gradeBand: 'middle_school',
      declarationSource: 'self_declared',
    });
    expect(
      await new DrizzleStudyPlanRepository(getDatabase()).getOwnedBySession(
        'another-student',
        first.session.sessionId,
      ),
    ).toBeNull();
    await expect(
      getDatabase()
        .update(studySchema.learnerProfiles)
        .set({ preferences: {} })
        .where(
          eq(studySchema.learnerProfiles.studentId, first.plan.goal.studentId),
        ),
    ).rejects.toThrow();
    await getDatabase()
      .delete(baseSchema.platformUsers)
      .where(eq(baseSchema.platformUsers.id, first.plan.goal.studentId));
    expect(
      await getDatabase().select().from(studySchema.learnerProfiles),
    ).toHaveLength(0);
  });

  it('拒绝过期owner Membership的bootstrap', async () => {
    const studentId = 'expired-owner-test';
    const scope = studyTestScope(studentId);
    const sessionRepo = new DrizzleLearningSessionRepository(getDatabase());
    const { sessionId } = await sessionRepo.bootstrap({
      ...scope,
      completeArtifact: artifact,
    });
    const [conversationRow] = await getDatabase()
      .select({ spaceId: baseSchema.conversations.spaceId })
      .from(baseSchema.conversations)
      .innerJoin(
        baseSchema.lessonSessions,
        eq(
          baseSchema.lessonSessions.conversationId,
          baseSchema.conversations.id,
        ),
      )
      .where(eq(baseSchema.lessonSessions.id, sessionId))
      .limit(1);
    if (!conversationRow) throw new Error('Conversation not found');
    await getDatabase()
      .update(baseSchema.notebookMemberships)
      .set({
        grantedAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-02T00:00:00.000Z'),
      })
      .where(
        and(
          eq(
            baseSchema.notebookMemberships.notebookId,
            conversationRow.spaceId,
          ),
          eq(baseSchema.notebookMemberships.userId, studentId),
        ),
      );
    const repo = new DrizzleStudyPlanRepository(getDatabase());
    await expect(
      repo.bootstrap({
        trustedStudentId: studentId,
        declaredByUserId: studentId,
        sessionId,
        desiredOutcome: '测试过期所有权',
        profile: {
          ageBand: '13_to_15',
          gradeBand: 'middle_school',
          declarationSource: 'self_declared',
          preferences: {
            explanationOrder: 'example_first',
            responseDepth: 'balanced',
            guidance: 'step_by_step',
            modality: 'mixed',
            feedbackStyle: 'balanced',
          },
        },
        course,
      }),
    ).rejects.toBeInstanceOf(StudyPlanNotFoundError);
    expect(
      await getDatabase().select().from(studySchema.learningGoals),
    ).toHaveLength(0);
  });

  it('拒绝已撤销owner Membership的bootstrap', async () => {
    const studentId = 'revoked-owner-test';
    const scope = studyTestScope(studentId);
    const sessionRepo = new DrizzleLearningSessionRepository(getDatabase());
    const { sessionId } = await sessionRepo.bootstrap({
      ...scope,
      completeArtifact: artifact,
    });
    const [conversationRow] = await getDatabase()
      .select({ spaceId: baseSchema.conversations.spaceId })
      .from(baseSchema.conversations)
      .innerJoin(
        baseSchema.lessonSessions,
        eq(
          baseSchema.lessonSessions.conversationId,
          baseSchema.conversations.id,
        ),
      )
      .where(eq(baseSchema.lessonSessions.id, sessionId))
      .limit(1);
    if (!conversationRow) throw new Error('Conversation not found');
    await getDatabase()
      .update(baseSchema.notebookMemberships)
      .set({
        grantedAt: new Date('2026-01-01T00:00:00.000Z'),
        revokedAt: new Date('2026-01-02T00:00:00.000Z'),
      })
      .where(
        and(
          eq(
            baseSchema.notebookMemberships.notebookId,
            conversationRow.spaceId,
          ),
          eq(baseSchema.notebookMemberships.userId, studentId),
        ),
      );
    const repo = new DrizzleStudyPlanRepository(getDatabase());
    await expect(
      repo.bootstrap({
        trustedStudentId: studentId,
        declaredByUserId: studentId,
        sessionId,
        desiredOutcome: '测试已撤销所有权',
        profile: {
          ageBand: '13_to_15',
          gradeBand: 'middle_school',
          declarationSource: 'self_declared',
          preferences: {
            explanationOrder: 'example_first',
            responseDepth: 'balanced',
            guidance: 'step_by_step',
            modality: 'mixed',
            feedbackStyle: 'balanced',
          },
        },
        course,
      }),
    ).rejects.toBeInstanceOf(StudyPlanNotFoundError);
    expect(
      await getDatabase().select().from(studySchema.learningGoals),
    ).toHaveLength(0);
  });

  it('只补偿删除本次新建且仍未绑定Goal的Notebook', async () => {
    const studentId = 'unplanned-study-student';
    const orphan = await new DrizzleLearningSessionRepository(
      getDatabase(),
    ).bootstrap({
      studentId,
      gradeBand: course.gradeBand,
      courseSlug: course.courseSlug,
      knowledgeNodeId: course.objectives[0]!.knowledgeNodeId,
      completeArtifact: artifact,
    });
    const compensator = new DrizzleStudyBootstrapCompensator(getDatabase());
    expect(orphan.created).toBe(true);
    await expect(
      compensator.discardUnplannedSession({
        trustedStudentId: 'another-student',
        sessionId: orphan.sessionId,
      }),
    ).resolves.toBe(false);
    await expect(
      compensator.discardUnplannedSession({
        trustedStudentId: studentId,
        sessionId: orphan.sessionId,
      }),
    ).resolves.toBe(true);
    expect(
      await getDatabase()
        .select()
        .from(baseSchema.lessonSessions)
        .where(eq(baseSchema.lessonSessions.id, orphan.sessionId)),
    ).toHaveLength(0);

    const planned = await bootstrapPlan('planned-study-student');
    await expect(
      compensator.discardUnplannedSession({
        trustedStudentId: planned.plan.goal.studentId,
        sessionId: planned.session.sessionId,
      }),
    ).resolves.toBe(false);
  });

  it('在同一事务写诊断、状态迁移、可信事件和掌握度并安全重放', async () => {
    const { session, plan } = await bootstrapPlan();
    const repository = new DrizzleStudyDiagnosticRepository(getDatabase());
    const attemptId = randomUUID();
    const graded = gradeAttempt(attemptId);
    const first = await repository.submit({
      trustedStudentId: plan.goal.studentId,
      goalId: plan.goal.id,
      sessionId: session.sessionId,
      course,
      graded: {
        ...graded,
        correctItems: 3,
        answers: graded.answers.map((answer) => ({
          ...answer,
          isCorrect: true,
        })),
      },
    });
    const replay = await repository.submit({
      trustedStudentId: plan.goal.studentId,
      goalId: plan.goal.id,
      sessionId: session.sessionId,
      course,
      graded,
    });

    expect(first).toMatchObject({
      replayed: false,
      attempt: { attemptedItems: 3, correctItems: 2 },
    });
    expect(replay).toMatchObject({
      replayed: true,
      attempt: { id: first.attempt.id, correctItems: 2 },
    });
    const events = await getDatabase().select().from(baseSchema.learningEvents);
    expect(events).toHaveLength(4);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'state_transition',
          causationId: first.attempt.id,
          payload: expect.objectContaining({
            from: 'DIAGNOSE',
            to: 'EXPLAIN',
            reason: 'DIAGNOSIS_COMPLETED',
          }),
        }),
      ]),
    );
    expect(
      await getDatabase()
        .select({ state: baseSchema.lessonSessions.state })
        .from(baseSchema.lessonSessions)
        .where(eq(baseSchema.lessonSessions.id, session.sessionId)),
    ).toEqual([{ state: 'EXPLAIN' }]);
    expect(
      await getDatabase().select().from(baseSchema.masteryStates),
    ).toHaveLength(3);
  });

  it('拒绝冲突重放与跨学生写入且不增加事件', async () => {
    const { session, plan } = await bootstrapPlan();
    const repository = new DrizzleStudyDiagnosticRepository(getDatabase());
    const attemptId = randomUUID();
    await repository.submit({
      trustedStudentId: plan.goal.studentId,
      goalId: plan.goal.id,
      sessionId: session.sessionId,
      course,
      graded: gradeAttempt(attemptId),
    });
    await expect(
      repository.submit({
        trustedStudentId: plan.goal.studentId,
        goalId: plan.goal.id,
        sessionId: session.sessionId,
        course,
        graded: gradeAttempt(attemptId, ['q1-wrong', 'q2-wrong', 'q3-correct']),
      }),
    ).rejects.toBeInstanceOf(DiagnosticAttemptConflictError);
    await expect(
      repository.submit({
        trustedStudentId: 'another-student',
        goalId: plan.goal.id,
        sessionId: session.sessionId,
        course,
        graded: gradeAttempt(randomUUID()),
      }),
    ).rejects.toBeInstanceOf(StudyPlanNotFoundError);
    expect(
      await getDatabase().select().from(baseSchema.learningEvents),
    ).toHaveLength(4);
  });

  it('匿名保留期清理显式覆盖画像、目标图和诊断事实', async () => {
    const studentId = `anon:v1:${'a'.repeat(64)}`;
    const { session, plan } = await bootstrapPlan(studentId);
    await new DrizzleStudyDiagnosticRepository(getDatabase()).submit({
      trustedStudentId: studentId,
      goalId: plan.goal.id,
      sessionId: session.sessionId,
      course,
      graded: gradeAttempt(randomUUID()),
    });
    const oldActivity = new Date('2026-06-01T00:00:00.000Z');
    await getDatabase()
      .update(baseSchema.lessonSessions)
      .set({ lastActivityAt: oldActivity })
      .where(eq(baseSchema.lessonSessions.id, session.sessionId));
    await getDatabase()
      .update(baseSchema.conversations)
      .set({ lastActivityAt: oldActivity })
      .where(eq(baseSchema.conversations.ownerSubjectId, studentId));

    const result = await new DrizzleAnonymousDataLifecycleService(
      getDatabase(),
    ).purgeExpiredSubjects({
      now: new Date('2026-07-24T00:00:00.000Z'),
    });

    expect(result.deletedRows).toMatchObject({
      diagnostic_responses: 3,
      diagnostic_attempts: 1,
      learning_objectives: 6,
      learning_goals: 1,
      learner_profiles: 1,
    });
    expect(
      await getDatabase().select().from(studySchema.learnerProfiles),
    ).toHaveLength(0);
  });
});
