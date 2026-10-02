import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  DrizzleNotebookPlanRepository,
  NotebookPlanConflictError,
  NotebookPlanNotFoundError,
} from './notebook-plan-repository';
import { NotebookAccessNotFoundError } from './notebook-access';
import * as schema from './schema';
import {
  run,
  createTemporaryDatabase,
  migrationsFolder,
  notebook,
  asset,
} from './notebook-plan.integration-support';

run('Notebook source plans: fresh migration and authorization', () => {
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
  it('fresh installs and shares one Goal across conversation, chapter and purpose plans without teaching writes', async () => {
    const n = await notebook(fixture);
    const a = await asset(fixture, n.notebookId, n.owner);
    const repo = new DrizzleNotebookPlanRepository(fixture.database);
    const [goal] = await fixture.database
      .insert(schema.learningGoals)
      .values({
        notebookId: n.notebookId,
        studentId: n.owner,
        courseSlug: 'plan-fixture',
        courseVersion: '1',
        gradeBand: 'middle_school',
        topic: 'Shared goal',
        desiredOutcome: 'Understand material',
      })
      .returning();
    const chapterInput = {
      notebookId: n.notebookId,
      trustedSubjectId: n.owner,
      ...a,
      clientRequestId: randomUUID(),
      title: 'Chapter 1',
      locator: { kind: 'text' as const, start: 0, end: 10 },
    };
    const chapter = await repo.createChapter(chapterInput);
    expect((await repo.createChapter(chapterInput)).id).toBe(chapter.id);
    for (const source of [
      { kind: 'conversation' as const, conversationId: n.conversationId },
      { kind: 'chapter' as const, chapterId: chapter.id },
      { kind: 'purpose' as const, purpose: 'Prepare for exam' },
    ])
      await repo.create({
        notebookId: n.notebookId,
        trustedSubjectId: n.owner,
        clientRequestId: randomUUID(),
        title: 'Saved step',
        description: 'User authored content',
        source,
      });
    const result = await repo.list({
      notebookId: n.notebookId,
      trustedSubjectId: n.owner,
    });
    expect(result.plans).toHaveLength(3);
    expect(result.plans.every((p) => p.goalId === goal!.id)).toBe(true);
    expect(result.goal?.id).toBe(goal!.id);
    expect(
      await fixture.database.select().from(schema.lessonSessions),
    ).toHaveLength(0);
    expect(
      await fixture.database.select().from(schema.learningEvents),
    ).toHaveLength(0);
    expect(
      await fixture.database.select().from(schema.masteryStates),
    ).toHaveLength(0);
    await expect(
      fixture.database.insert(schema.learningGoals).values({
        notebookId: n.notebookId,
        studentId: n.owner,
        courseSlug: 'another',
        courseVersion: '1',
        gradeBand: 'middle_school',
        topic: 'Duplicate',
        desiredOutcome: 'Duplicate',
      }),
    ).rejects.toThrow();
  });
  it('idempotent concurrent creation writes one plan and rejects conflicting payloads', async () => {
    const n = await notebook(fixture);
    const repo = new DrizzleNotebookPlanRepository(fixture.database);
    const input = {
      notebookId: n.notebookId,
      trustedSubjectId: n.owner,
      clientRequestId: randomUUID(),
      title: 'Saved',
      source: {
        kind: 'conversation' as const,
        conversationId: n.conversationId,
      },
    };
    const [a, b] = await Promise.all([repo.create(input), repo.create(input)]);
    expect(a.id).toBe(b.id);
    await expect(
      repo.create({ ...input, title: 'Conflict' }),
    ).rejects.toBeInstanceOf(NotebookPlanConflictError);
    expect(
      (await repo.list({ notebookId: n.notebookId, trustedSubjectId: n.owner }))
        .plans,
    ).toHaveLength(1);
    expect(
      await fixture.database
        .select()
        .from(schema.securityAuditEvents)
        .where(eq(schema.securityAuditEvents.resourceId, a.id)),
    ).toHaveLength(1);
  });
  it('rejects cross-Notebook conversation/asset/chapter relations in repository and database', async () => {
    const a = await notebook(fixture);
    const b = await notebook(fixture);
    const assetB = await asset(fixture, b.notebookId, b.owner);
    const repo = new DrizzleNotebookPlanRepository(fixture.database);
    const input = {
      notebookId: a.notebookId,
      trustedSubjectId: a.owner,
      clientRequestId: randomUUID(),
      title: 'Cross',
    };
    await expect(
      repo.create({
        ...input,
        source: { kind: 'conversation', conversationId: b.conversationId },
      }),
    ).rejects.toBeInstanceOf(NotebookPlanNotFoundError);
    await expect(
      repo.createChapter({ ...input, ...assetB, locator: { kind: 'whole' } }),
    ).rejects.toBeInstanceOf(NotebookPlanNotFoundError);
    const chapterB = await repo.createChapter({
      notebookId: b.notebookId,
      trustedSubjectId: b.owner,
      clientRequestId: randomUUID(),
      title: 'B',
      ...assetB,
      locator: { kind: 'whole' },
    });
    await expect(
      repo.create({
        ...input,
        source: { kind: 'chapter', chapterId: chapterB.id },
      }),
    ).rejects.toBeInstanceOf(NotebookPlanNotFoundError);
    await expect(
      fixture.database.insert(schema.notebookPlans).values({
        notebookId: a.notebookId,
        createdByUserId: a.owner,
        clientRequestId: randomUUID(),
        title: 'Bypass',
        sourceKind: 'conversation',
        conversationId: b.conversationId,
      }),
    ).rejects.toThrow();
    await expect(
      fixture.database.insert(schema.notebookChapters).values({
        notebookId: a.notebookId,
        createdByUserId: a.owner,
        clientRequestId: randomUUID(),
        title: 'Bypass',
        ...assetB,
        locator: { kind: 'whole' },
      }),
    ).rejects.toThrow();
    const assetA = await asset(fixture, a.notebookId, a.owner);
    await expect(
      fixture.database.insert(schema.notebookChapters).values({
        notebookId: a.notebookId,
        createdByUserId: a.owner,
        clientRequestId: randomUUID(),
        title: 'Wrong version',
        assetId: assetA.assetId,
        assetVersionId: assetB.assetVersionId,
        locator: { kind: 'whole' },
      }),
    ).rejects.toThrow();
  });
  it('viewers and contributors only read, revoked/expired memberships fail closed and hide other learners Goal', async () => {
    const n = await notebook(fixture);
    const repo = new DrizzleNotebookPlanRepository(fixture.database);
    await fixture.database.insert(schema.learningGoals).values({
      notebookId: n.notebookId,
      studentId: n.owner,
      courseSlug: 'private',
      courseVersion: '1',
      gradeBand: 'middle_school',
      topic: 'Private goal',
      desiredOutcome: 'Private learning fact',
    });
    const plan = await repo.create({
      notebookId: n.notebookId,
      trustedSubjectId: n.owner,
      clientRequestId: randomUUID(),
      title: 'Shared step',
      source: { kind: 'purpose', purpose: 'Study material' },
    });
    for (const role of ['viewer', 'contributor', 'editor'] as const) {
      const user = `plan:${role}:${randomUUID()}`;
      await fixture.database
        .insert(schema.platformUsers)
        .values({ id: user, kind: 'registered' });
      await fixture.database.insert(schema.notebookMemberships).values({
        notebookId: n.notebookId,
        userId: user,
        role,
        grantedByUserId: n.owner,
      });
      const view = await repo.list({
        notebookId: n.notebookId,
        trustedSubjectId: user,
      });
      expect(view.goal).toBeNull();
      expect(view.plans[0]?.goalId).toBeNull();
      expect(view.canWrite).toBe(role === 'editor');
      if (role !== 'editor')
        await expect(
          repo.updateStatus({
            notebookId: n.notebookId,
            trustedSubjectId: user,
            planId: plan.id,
            status: 'completed',
          }),
        ).rejects.toBeInstanceOf(NotebookAccessNotFoundError);
      else
        expect(
          (
            await repo.updateStatus({
              notebookId: n.notebookId,
              trustedSubjectId: user,
              planId: plan.id,
              status: 'completed',
            })
          ).status,
        ).toBe('completed');
      await fixture.database
        .update(schema.notebookMemberships)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.notebookMemberships.notebookId, n.notebookId),
            eq(schema.notebookMemberships.userId, user),
          ),
        );
      await expect(
        repo.list({ notebookId: n.notebookId, trustedSubjectId: user }),
      ).rejects.toBeInstanceOf(NotebookAccessNotFoundError);
      await fixture.database
        .update(schema.notebookMemberships)
        .set({
          revokedAt: null,
          grantedAt: new Date(Date.now() - 2000),
          expiresAt: new Date(Date.now() - 1000),
        })
        .where(
          and(
            eq(schema.notebookMemberships.notebookId, n.notebookId),
            eq(schema.notebookMemberships.userId, user),
          ),
        );
      await expect(
        repo.create({
          notebookId: n.notebookId,
          trustedSubjectId: user,
          clientRequestId: randomUUID(),
          title: 'Denied',
          source: { kind: 'purpose', purpose: 'Denied' },
        }),
      ).rejects.toBeInstanceOf(NotebookAccessNotFoundError);
    }
  });
  it('marks archived conversations and changed source versions unavailable; only archive remains possible', async () => {
    const n = await notebook(fixture);
    const a = await asset(fixture, n.notebookId, n.owner);
    const repo = new DrizzleNotebookPlanRepository(fixture.database);
    const chapter = await repo.createChapter({
      notebookId: n.notebookId,
      trustedSubjectId: n.owner,
      clientRequestId: randomUUID(),
      title: 'Whole',
      ...a,
      locator: { kind: 'whole' },
    });
    const chapterPlan = await repo.create({
      notebookId: n.notebookId,
      trustedSubjectId: n.owner,
      clientRequestId: randomUUID(),
      title: 'Chapter plan',
      source: { kind: 'chapter', chapterId: chapter.id },
    });
    const conversationPlan = await repo.create({
      notebookId: n.notebookId,
      trustedSubjectId: n.owner,
      clientRequestId: randomUUID(),
      title: 'Conversation plan',
      source: { kind: 'conversation', conversationId: n.conversationId },
    });
    await fixture.database
      .update(schema.conversations)
      .set({ status: 'archived', archivedAt: new Date() })
      .where(eq(schema.conversations.id, n.conversationId));
    const nextVersionId = randomUUID();
    await fixture.database.insert(schema.assetVersions).values({
      id: nextVersionId,
      assetId: a.assetId,
      kind: 'original',
      mimeType: 'text/plain',
      byteSize: 1,
      contentHash: 'b'.repeat(64),
      status: 'ready',
      storageKey: `plan-test/${nextVersionId}`,
    });
    await fixture.database
      .update(schema.assets)
      .set({ currentVersionId: nextVersionId })
      .where(eq(schema.assets.id, a.assetId));
    expect(
      (
        await repo.list({ notebookId: n.notebookId, trustedSubjectId: n.owner })
      ).plans.every((p) => !p.available),
    ).toBe(true);
    await expect(
      repo.updateStatus({
        notebookId: n.notebookId,
        trustedSubjectId: n.owner,
        planId: chapterPlan.id,
        status: 'completed',
      }),
    ).rejects.toBeInstanceOf(NotebookPlanNotFoundError);
    expect(
      (
        await repo.updateStatus({
          notebookId: n.notebookId,
          trustedSubjectId: n.owner,
          planId: conversationPlan.id,
          status: 'archived',
        })
      ).status,
    ).toBe('archived');
  });
});
