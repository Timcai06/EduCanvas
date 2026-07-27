import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleLearningSessionRepository } from './learning-session-repository';
import * as baseSchema from './schema';
import * as studySchema from './schema/study';
import { DrizzleStudyBootstrapCompensator } from './study-bootstrap-compensator';
import { DrizzleStudyPlanRepository } from './study-plan-repository';
import {
  bootstrapStudyTestPlan,
  studyTestArtifact as artifact,
  studyTestCourse as course,
  studyTestScope as scopeFor,
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

function bootstrapPlan(studentId: string) {
  return bootstrapStudyTestPlan(getDatabase(), studentId);
}

describeWithDatabase('学习Session失败补偿交错', () => {
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

  it('孤儿Notebook删除后在scope空闲时恢复旧Session', async () => {
    const studentId = 'restore-vacant-study-student';
    const sessions = new DrizzleLearningSessionRepository(getDatabase());
    const initial = await bootstrapPlan(studentId);
    const scope = scopeFor(studentId);
    const orphan = await sessions.startNew({
      ...scope,
      completeArtifact: artifact,
    });

    await expect(
      new DrizzleStudyBootstrapCompensator(
        getDatabase(),
      ).discardUnplannedSession({
        trustedStudentId: studentId,
        sessionId: orphan.sessionId,
      }),
    ).resolves.toBe(true);
    await expect(
      sessions.restoreArchivedIfNoActiveSession(
        scope,
        initial.session.sessionId,
      ),
    ).resolves.toBe(true);
    await expect(sessions.getCurrentOwned(scope)).resolves.toMatchObject({
      sessionId: initial.session.sessionId,
    });
  });

  it('B成功后A孤儿补偿不恢复旧Session覆盖B', async () => {
    const studentId = 'interleaved-study-student';
    const sessions = new DrizzleLearningSessionRepository(getDatabase());
    const initial = await bootstrapPlan(studentId);
    const scope = scopeFor(studentId);

    // A 新建 Session 后 Goal 写入失败；B 随后完成 Session + Goal。
    const orphanA = await sessions.startNew({
      ...scope,
      completeArtifact: artifact,
    });
    const successfulB = await sessions.startNew({
      ...scope,
      completeArtifact: artifact,
    });
    const planB = await new DrizzleStudyPlanRepository(getDatabase()).bootstrap(
      {
        trustedStudentId: studentId,
        declaredByUserId: studentId,
        sessionId: successfulB.sessionId,
        desiredOutcome: initial.plan.goal.desiredOutcome,
        profile: {
          ageBand: initial.plan.profile.ageBand,
          gradeBand: initial.plan.profile.gradeBand,
          declarationSource: initial.plan.profile.declarationSource,
          preferences: initial.plan.profile.preferences,
        },
        course,
      },
    );

    await expect(
      new DrizzleStudyBootstrapCompensator(
        getDatabase(),
      ).discardUnplannedSession({
        trustedStudentId: studentId,
        sessionId: orphanA.sessionId,
      }),
    ).resolves.toBe(true);
    await expect(
      sessions.restoreArchivedIfNoActiveSession(
        scope,
        initial.session.sessionId,
      ),
    ).resolves.toBe(false);

    const rows = await getDatabase()
      .select({
        id: baseSchema.lessonSessions.id,
        status: baseSchema.lessonSessions.status,
      })
      .from(baseSchema.lessonSessions);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: initial.session.sessionId, status: 'archived' },
        { id: successfulB.sessionId, status: 'active' },
      ]),
    );
    expect(rows.some((row) => row.id === orphanA.sessionId)).toBe(false);
    expect(planB.goal.sessionId).toBe(successfulB.sessionId);
    await expect(
      new DrizzleStudyPlanRepository(getDatabase()).getOwnedBySession(
        studentId,
        successfulB.sessionId,
      ),
    ).resolves.toMatchObject({
      goal: { id: planB.goal.id, sessionId: successfulB.sessionId },
    });
  });

  it('条件恢复不会操作其他学生的Session', async () => {
    const owner = await bootstrapPlan('restore-owner-student');
    await expect(
      new DrizzleLearningSessionRepository(
        getDatabase(),
      ).restoreArchivedIfNoActiveSession(
        scopeFor('forged-student'),
        owner.session.sessionId,
      ),
    ).rejects.toThrow('学习会话不存在或不属于当前学生');
    expect(
      await getDatabase()
        .select()
        .from(baseSchema.lessonSessions)
        .where(eq(baseSchema.lessonSessions.id, owner.session.sessionId)),
    ).toMatchObject([{ status: 'active' }]);
  });
});
