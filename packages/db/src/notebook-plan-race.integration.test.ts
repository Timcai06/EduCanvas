import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  DrizzleNotebookPlanRepository,
  NotebookPlanNotFoundError,
} from './notebook-plan-repository';
import { NotebookAccessNotFoundError } from './notebook-access';
import {
  run,
  createTemporaryDatabase,
  migrationsFolder,
  notebook,
  asset,
} from './notebook-plan.integration-support';
import * as schema from './schema';
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
run('Notebook plan concurrent authorization', () => {
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
  async function waitForLock() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] =
        await fixture.connection`select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid()`;
      if (row?.count > 0) return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error('Expected concurrent write to wait for the authority lock');
  }
  it('waits for concurrent revocation and fails closed after it commits', async () => {
    const n = await notebook(fixture);
    const entered = barrier();
    const release = barrier();
    const repo = new DrizzleNotebookPlanRepository(fixture.database);
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
    const pending = repo
      .create({
        notebookId: n.notebookId,
        trustedSubjectId: n.owner,
        clientRequestId: randomUUID(),
        title: 'Blocked after revocation',
        source: { kind: 'conversation', conversationId: n.conversationId },
      })
      .then(
        (value) => value,
        (error: unknown) => error,
      );
    try {
      await waitForLock();
    } finally {
      release.resolve();
    }
    await revoke;
    expect(await pending).toBeInstanceOf(NotebookAccessNotFoundError);
    expect(
      await fixture.database
        .select()
        .from(schema.notebookPlans)
        .where(eq(schema.notebookPlans.notebookId, n.notebookId)),
    ).toHaveLength(0);
  });
  it('waits for a concurrent source-version swap and rejects a stale chapter create', async () => {
    const n = await notebook(fixture);
    const a = await asset(fixture, n.notebookId, n.owner);
    const entered = barrier();
    const release = barrier();
    const repo = new DrizzleNotebookPlanRepository(fixture.database);
    const versionId = randomUUID();
    await fixture.database.insert(schema.assetVersions).values({
      id: versionId,
      assetId: a.assetId,
      kind: 'original',
      mimeType: 'text/plain',
      byteSize: 1,
      contentHash: 'c'.repeat(64),
      status: 'ready',
      storageKey: `plan-race/${versionId}`,
    });
    const swap = fixture.database.transaction(async (transaction) => {
      await transaction
        .update(schema.assets)
        .set({ currentVersionId: versionId })
        .where(eq(schema.assets.id, a.assetId));
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const pending = repo
      .createChapter({
        notebookId: n.notebookId,
        trustedSubjectId: n.owner,
        clientRequestId: randomUUID(),
        title: 'Stale source',
        ...a,
        locator: { kind: 'whole' },
      })
      .then(
        (value) => value,
        (error: unknown) => error,
      );
    try {
      await waitForLock();
    } finally {
      release.resolve();
    }
    await swap;
    expect(await pending).toBeInstanceOf(NotebookPlanNotFoundError);
    expect(
      await fixture.database
        .select()
        .from(schema.notebookChapters)
        .where(eq(schema.notebookChapters.notebookId, n.notebookId)),
    ).toHaveLength(0);
  });
});
