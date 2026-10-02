import { gradeDiagnostic } from '@educanvas/teaching-core';
import { DrizzleStudyDiagnosticRepository } from './study-diagnostic-repository';
import { DrizzleTeachingUnitOfWork } from './teaching-adapters';
import { StudyPlanNotFoundError } from './study-repository-contracts';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  DrizzleLearningSessionRepository,
  LearningSessionNotFoundError,
} from './learning-session-repository';
import { DrizzleStudyPlanRepository } from './study-plan-repository';
import {
  run,
  createTemporaryDatabase,
  migrationsFolder,
  notebook,
} from './notebook-plan.integration-support';
import {
  studyTestArtifact,
  studyTestCourse,
  studyTestScope,
} from './study-plan.integration-support';
import * as schema from './schema';

const profile = {
  ageBand: '13_to_15' as const,
  gradeBand: 'middle_school' as const,
  declarationSource: 'self_declared' as const,
  preferences: {
    explanationOrder: 'example_first' as const,
    responseDepth: 'balanced' as const,
    guidance: 'step_by_step' as const,
    modality: 'mixed' as const,
    feedbackStyle: 'balanced' as const,
  },
};

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

run('Notebook teaching Session isolation', () => {
  let fixture: Awaited<ReturnType<typeof createTemporaryDatabase>>;
  beforeAll(async () => {
    fixture = await createTemporaryDatabase(
      'educanvas_20261002_plan_fresh_integration',
    );
    await migrate(fixture.database, { migrationsFolder });
  });
  afterAll(async () => {
    await fixture?.dispose();
  });
  it('waits for concurrent membership revocation and does not archive the Session afterward', async () => {
    const n = await notebook(fixture);
    const sessions = new DrizzleLearningSessionRepository(fixture.database);
    const session = await sessions.bootstrap({
      ...studyTestScope(n.owner),
      notebookId: n.notebookId,
      completeArtifact: studyTestArtifact,
    });
    const entered = barrier();
    const release = barrier();
    const revoke = fixture.database.transaction(async (transaction) => {
      await transaction
        .update(schema.notebookMemberships)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.notebookMemberships.notebookId, n.notebookId),
            eq(schema.notebookMemberships.userId, n.owner),
          ),
        );
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const pendingArchive = sessions
      .archive(
        { ...studyTestScope(n.owner), notebookId: n.notebookId },
        session.sessionId,
      )
      .then(
        (value) => value,
        (error: unknown) => error,
      );
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await fixture.connection`
          select count(*)::int as count
          from pg_stat_activity
          where datname = current_database()
            and wait_event_type = 'Lock'
            and pid <> pg_backend_pid()
        `;
        if (row?.count) break;
        if (attempt === 99)
          throw new Error(
            'Expected Session archive to wait for membership lock',
          );
        await new Promise((done) => setTimeout(done, 10));
      }
    } finally {
      release.resolve();
    }
    await revoke;

    expect(await pendingArchive).toBeInstanceOf(LearningSessionNotFoundError);
    expect(
      await fixture.database
        .select({ status: schema.lessonSessions.status })
        .from(schema.lessonSessions)
        .where(eq(schema.lessonSessions.id, session.sessionId)),
    ).toEqual([{ status: 'active' }]);
    expect(
      await fixture.database
        .select({ revokedAt: schema.notebookMemberships.revokedAt })
        .from(schema.notebookMemberships)
        .where(eq(schema.notebookMemberships.notebookId, n.notebookId)),
    ).toEqual([{ revokedAt: expect.any(Date) }]);
  });
  it('same user/course in A and B stays active independently; same Notebook concurrent bootstrap and restore preserve A', async () => {
    const a = await notebook(fixture);
    const b = await notebook(fixture, a.owner);
    const sessions = new DrizzleLearningSessionRepository(fixture.database);
    const base = {
      ...studyTestScope(a.owner),
      completeArtifact: studyTestArtifact,
    };
    const sessionA = await sessions.bootstrap({
      ...base,
      notebookId: a.notebookId,
    });
    const [sessionB, replayB] = await Promise.all([
      sessions.bootstrap({ ...base, notebookId: b.notebookId }),
      sessions.bootstrap({ ...base, notebookId: b.notebookId }),
    ]);
    expect(sessionB.sessionId).toBe(replayB.sessionId);
    expect(sessionA.sessionId).not.toBe(sessionB.sessionId);
    const planB = await new DrizzleStudyPlanRepository(
      fixture.database,
    ).bootstrap({
      trustedStudentId: a.owner,
      declaredByUserId: a.owner,
      sessionId: sessionB.sessionId,
      desiredOutcome: 'Goal B remains with Notebook B',
      profile,
      course: studyTestCourse,
    });
    await fixture.database.insert(schema.chatMessages).values({
      sessionId: sessionB.sessionId,
      turnId: randomUUID(),
      clientMessageId: 'notebook-b-message',
      requestHash: 'b'.repeat(64),
      role: 'student',
      status: 'completed',
      content: 'B message remains in B',
      completedAt: new Date(),
    });
    const beforeScopedBMessages = await fixture.database
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.sessionId, sessionB.sessionId));
    const beforeScopedBGoal = await new DrizzleStudyPlanRepository(
      fixture.database,
    ).getOwnedBySession(a.owner, sessionB.sessionId);
    const active = await fixture.database
      .select()
      .from(schema.lessonSessions)
      .where(eq(schema.lessonSessions.studentId, a.owner));
    expect(active).toHaveLength(2);
    expect(active.every((s) => s.status === 'active')).toBe(true);
    await expect(
      sessions.resume(
        { ...studyTestScope(a.owner), notebookId: a.notebookId },
        sessionB.sessionId,
      ),
    ).rejects.toBeInstanceOf(LearningSessionNotFoundError);
    await sessions.archive(
      { ...studyTestScope(a.owner), notebookId: b.notebookId },
      sessionB.sessionId,
    );
    expect(
      await sessions.restoreArchivedIfNoActiveSession(
        { ...studyTestScope(a.owner), notebookId: b.notebookId },
        sessionB.sessionId,
      ),
    ).toBe(true);
    const beforeScopedNew = await fixture.database
      .select()
      .from(schema.lessonSessions)
      .where(eq(schema.lessonSessions.id, sessionB.sessionId));
    const [conversationB] = await fixture.database
      .select({
        sessionId: schema.lessonSessions.id,
        sessionNotebookId: schema.lessonSessions.notebookId,
        conversationNotebookId: schema.conversations.spaceId,
      })
      .from(schema.lessonSessions)
      .innerJoin(
        schema.conversations,
        eq(schema.conversations.id, schema.lessonSessions.conversationId),
      )
      .where(eq(schema.lessonSessions.id, sessionB.sessionId));
    expect(conversationB).toEqual({
      sessionId: sessionB.sessionId,
      sessionNotebookId: b.notebookId,
      conversationNotebookId: b.notebookId,
    });
    const nextInA = await sessions.startNew({
      ...base,
      notebookId: a.notebookId,
    });
    const [newTarget] = await fixture.database
      .select({
        notebookId: schema.lessonSessions.notebookId,
        conversationNotebookId: schema.conversations.spaceId,
      })
      .from(schema.lessonSessions)
      .innerJoin(
        schema.conversations,
        eq(schema.conversations.id, schema.lessonSessions.conversationId),
      )
      .where(eq(schema.lessonSessions.id, nextInA.sessionId));
    expect(newTarget).toEqual({
      notebookId: a.notebookId,
      conversationNotebookId: a.notebookId,
    });
    expect(
      await fixture.database
        .select()
        .from(schema.lessonSessions)
        .where(eq(schema.lessonSessions.id, sessionB.sessionId)),
    ).toEqual(beforeScopedNew);
    expect(
      await fixture.database
        .select()
        .from(schema.chatMessages)
        .where(eq(schema.chatMessages.sessionId, sessionB.sessionId)),
    ).toEqual(beforeScopedBMessages);
    expect(
      await new DrizzleStudyPlanRepository(fixture.database).getOwnedBySession(
        a.owner,
        sessionB.sessionId,
      ),
    ).toEqual(beforeScopedBGoal);
    expect(beforeScopedBGoal?.goal.id).toBe(planB.goal.id);
    await sessions.resume(
      { ...studyTestScope(a.owner), notebookId: a.notebookId },
      sessionA.sessionId,
    );
    const after = await fixture.database
      .select()
      .from(schema.lessonSessions)
      .where(eq(schema.lessonSessions.id, sessionA.sessionId));
    expect(after[0]).toMatchObject({
      ...active.find((s) => s.id === sessionA.sessionId),
      updatedAt: expect.any(Date),
    });
    const next = await sessions.startNew(base);
    expect(next.sessionId).not.toBe(sessionA.sessionId);
    await expect(
      sessions.getCurrentOwned(studyTestScope(a.owner)),
    ).resolves.toMatchObject({
      sessionId: next.sessionId,
    });
    expect(
      (
        await fixture.database
          .select()
          .from(schema.lessonSessions)
          .where(eq(schema.lessonSessions.id, sessionA.sessionId))
      )[0],
    ).toEqual(after[0]);
    expect(
      (
        await sessions.getCurrentOwned({
          ...studyTestScope(a.owner),
          notebookId: a.notebookId,
        })
      )?.sessionId,
    ).toBe(sessionA.sessionId);
  });
  it('creates a total Goal in the existing Notebook atomically and a failed creation preserves it', async () => {
    const n = await notebook(fixture);
    const countBefore = await fixture.database.select().from(schema.spaces);
    const result = await fixture.database.transaction(async (transaction) => {
      const session = await new DrizzleLearningSessionRepository(
        transaction,
      ).bootstrap({
        ...studyTestScope(n.owner),
        notebookId: n.notebookId,
        completeArtifact: studyTestArtifact,
      });
      const plan = await new DrizzleStudyPlanRepository(transaction).bootstrap({
        trustedStudentId: n.owner,
        declaredByUserId: n.owner,
        sessionId: session.sessionId,
        desiredOutcome: 'One total goal',
        profile,
        course: studyTestCourse,
      });
      return { session, plan };
    });
    expect(result.plan.goal.notebookId).toBe(n.notebookId);
    expect(result.plan.goal.sessionId).toBe(result.session.sessionId);
    expect(await fixture.database.select().from(schema.spaces)).toHaveLength(
      countBefore.length,
    );
    const sessionBefore = (
      await fixture.database
        .select()
        .from(schema.lessonSessions)
        .where(eq(schema.lessonSessions.id, result.session.sessionId))
    )[0];
    await expect(
      fixture.database.transaction(async (transaction) => {
        await new DrizzleLearningSessionRepository(transaction).startNew({
          ...studyTestScope(n.owner),
          notebookId: n.notebookId,
          completeArtifact: studyTestArtifact,
        });
        throw new Error('simulated Goal failure');
      }),
    ).rejects.toThrow('simulated Goal failure');
    expect(
      (
        await fixture.database
          .select()
          .from(schema.lessonSessions)
          .where(eq(schema.lessonSessions.id, result.session.sessionId))
      )[0],
    ).toEqual(sessionBefore);
    expect(
      (
        await new DrizzleStudyPlanRepository(
          fixture.database,
        ).getActiveForNotebook(n.owner, n.notebookId)
      )?.goal.id,
    ).toBe(result.plan.goal.id);
  });
  it('never pairs the current Goal C with old curriculum B even if B is more recent or explicitly selected', async () => {
    const n = await notebook(fixture);
    const sessions = new DrizzleLearningSessionRepository(fixture.database);
    const plans = new DrizzleStudyPlanRepository(fixture.database);
    const sessionB = await sessions.bootstrap({
      ...studyTestScope(n.owner),
      notebookId: n.notebookId,
      completeArtifact: studyTestArtifact,
    });
    const planB = await plans.bootstrap({
      trustedStudentId: n.owner,
      declaredByUserId: n.owner,
      sessionId: sessionB.sessionId,
      desiredOutcome: 'Goal B',
      profile,
      course: studyTestCourse,
    });
    const courseC = {
      ...studyTestCourse,
      courseSlug: 'different-curriculum',
      title: 'Course C',
      objectives: studyTestCourse.objectives.map((o) => ({
        ...o,
        knowledgeNodeId: `course-c.${o.objectiveKey}`,
      })),
    };
    const sessionC = await sessions.bootstrap({
      studentId: n.owner,
      gradeBand: courseC.gradeBand,
      courseSlug: courseC.courseSlug,
      knowledgeNodeId: courseC.objectives[0]!.knowledgeNodeId,
      notebookId: n.notebookId,
      completeArtifact: studyTestArtifact,
    });
    const planC = await plans.bootstrap({
      trustedStudentId: n.owner,
      declaredByUserId: n.owner,
      sessionId: sessionC.sessionId,
      desiredOutcome: 'Goal C',
      profile,
      course: courseC,
    });
    await fixture.database
      .update(schema.lessonSessions)
      .set({
        lastActivityAt: new Date(Date.now() + 1000),
        updatedAt: new Date(Date.now() + 1000),
      })
      .where(eq(schema.lessonSessions.id, sessionB.sessionId));
    const [rowB] = await fixture.database
      .select()
      .from(schema.lessonSessions)
      .where(eq(schema.lessonSessions.id, sessionB.sessionId));
    expect(
      (await plans.getActiveForNotebook(n.owner, n.notebookId))?.goal.sessionId,
    ).toBe(sessionC.sessionId);
    expect(
      await plans.getActiveForNotebook(
        n.owner,
        n.notebookId,
        rowB!.conversationId!,
      ),
    ).toBeNull();
    expect(
      await plans.getOwnedBySession(n.owner, sessionB.sessionId),
    ).toBeNull();
    expect(
      (await plans.getOwnedBySession(n.owner, sessionC.sessionId))?.goal.id,
    ).toBe(planC.goal.id);
    const graded = gradeDiagnostic(courseC, {
      attemptId: randomUUID(),
      answers: courseC.diagnostic.questions.map((q) => ({
        questionId: q.questionId,
        selectedOptionId: q.correctOptionId,
      })),
    });
    if (!graded.ok) throw new Error('Diagnostic fixture invalid');
    await expect(
      new DrizzleStudyDiagnosticRepository(fixture.database).submit({
        trustedStudentId: n.owner,
        goalId: planC.goal.id,
        sessionId: sessionB.sessionId,
        course: courseC,
        graded: graded.result,
      }),
    ).rejects.toBeInstanceOf(StudyPlanNotFoundError);
    let invoked = false;
    await expect(
      new DrizzleTeachingUnitOfWork(fixture.database, {
        notebookId: n.notebookId,
        sessionId: sessionB.sessionId,
        goalId: planB.goal.id,
        trustedStudentId: n.owner,
      }).run(async () => {
        invoked = true;
      }),
    ).rejects.toBeInstanceOf(StudyPlanNotFoundError);
    expect(invoked).toBe(false);
    const archivedGoal = await fixture.database
      .select()
      .from(schema.learningGoals)
      .where(eq(schema.learningGoals.id, planB.goal.id));
    expect(archivedGoal[0]?.status).toBe('archived');
    expect(
      (
        await fixture.database
          .select()
          .from(schema.lessonSessions)
          .where(eq(schema.lessonSessions.id, sessionB.sessionId))
      )[0],
    ).toEqual(rowB);
    expect(
      await fixture.database
        .select()
        .from(schema.diagnosticAttempts)
        .where(
          and(
            eq(schema.diagnosticAttempts.goalId, planC.goal.id),
            eq(schema.diagnosticAttempts.sessionId, sessionB.sessionId),
          ),
        ),
    ).toHaveLength(0);
    await sessions.startNew({
      studentId: n.owner,
      gradeBand: courseC.gradeBand,
      courseSlug: courseC.courseSlug,
      knowledgeNodeId: courseC.objectives[0]!.knowledgeNodeId,
      notebookId: n.notebookId,
      completeArtifact: studyTestArtifact,
    });
    await expect(
      new DrizzleTeachingUnitOfWork(fixture.database, {
        notebookId: n.notebookId,
        sessionId: sessionC.sessionId,
        goalId: planC.goal.id,
        trustedStudentId: n.owner,
      }).run(async () => {
        invoked = true;
      }),
    ).rejects.toBeInstanceOf(StudyPlanNotFoundError);
    expect(invoked).toBe(false);
  });
});
