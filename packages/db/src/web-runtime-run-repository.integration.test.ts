import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleManualArtifactRepository } from './manual-artifact-repository';
import * as schema from './schema';
import {
  DrizzleWebRuntimeRunRepository,
  WebRuntimeRunNotFoundError,
} from './web-runtime-run-repository';

function testUrl(): string | undefined {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const name = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!name.endsWith('_integration') && !name.endsWith('_test')) {
    throw new Error('Web Runtime 集成测试拒绝非测试数据库');
  }
  return value;
}

const databaseUrl = testUrl();
const describeDatabase = databaseUrl ? describe : describe.skip;
const connection = databaseUrl ? postgres(databaseUrl, { max: 6 }) : null;
const database = connection ? drizzle(connection, { schema }) : null;

describeDatabase('Web Runtime run authorization and audit', () => {
  const owner = 'runtime-owner';
  const stranger = 'runtime-stranger';
  const runs = new DrizzleWebRuntimeRunRepository(database!);
  const artifacts = new DrizzleManualArtifactRepository(database!);
  let notebookId = '';
  let artifactId = '';
  let artifactVersionId = '';

  beforeAll(async () => {
    await migrate(database!, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await database!.execute(
      sql`truncate table web_runtime_runs, artifact_versions, artifact_generation_jobs, artifacts, notebook_memberships, spaces, personal_agents, platform_users restart identity cascade`,
    );
    await database!.insert(schema.platformUsers).values([
      { id: owner, kind: 'registered' },
      { id: stranger, kind: 'registered' },
    ]);
    const [notebook] = await database!
      .insert(schema.spaces)
      .values({ ownerSubjectId: owner, title: 'Runtime notebook' })
      .returning();
    notebookId = notebook!.id;
    await database!.insert(schema.notebookMemberships).values({
      notebookId,
      userId: owner,
      role: 'owner',
      grantedByUserId: owner,
    });
    const created = await artifacts.createWithInitialVersion({
      spaceId: notebookId,
      trustedSubjectId: owner,
      kind: 'dom_exploration',
      trustTier: 'tier2',
      title: '受控 DOM 探索',
      content: {
        schemaVersion: 1,
        html: '<button>探索</button>',
        css: 'button{font:inherit}',
        script: 'educanvasRuntime.output("ready")',
        dependencies: [],
      },
      generatedBy: 'user:manual',
    });
    artifactId = created.artifact.id;
    artifactVersionId = created.version.id;
  });

  afterAll(async () => connection?.end());

  async function createRun(token = randomBytes(32).toString('base64url')) {
    const run = await runs.createAuthorizedRun({
      requestId: randomUUID(),
      notebookId,
      artifactId,
      artifactVersionId,
      trustedSubjectId: owner,
      bootstrapToken: token,
    });
    return { run, token };
  }

  it('re-authorizes immutable version ownership and hides cross-Notebook access', async () => {
    await expect(
      runs.createAuthorizedRun({
        requestId: randomUUID(),
        notebookId,
        artifactId,
        artifactVersionId,
        trustedSubjectId: stranger,
        bootstrapToken: randomBytes(32).toString('base64url'),
      }),
    ).rejects.toBeInstanceOf(WebRuntimeRunNotFoundError);
    expect(await database!.select().from(schema.webRuntimeRuns)).toEqual([]);
  });

  it('claims a bootstrap token exactly once without persisting the raw credential', async () => {
    const { run, token } = await createRun();
    const [storedBefore] = await database!
      .select()
      .from(schema.webRuntimeRuns)
      .where(sql`${schema.webRuntimeRuns.id} = ${run.id}`);
    expect(storedBefore!.bootstrapTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(storedBefore)).not.toContain(token);

    await expect(
      runs.claimBootstrap({ runId: run.id, bootstrapToken: token }),
    ).resolves.toMatchObject({
      run: { artifactVersionId, artifactContentHash: run.artifactContentHash },
    });
    await expect(
      runs.claimBootstrap({ runId: run.id, bootstrapToken: token }),
    ).rejects.toBeInstanceOf(WebRuntimeRunNotFoundError);
    const [storedAfter] = await database!
      .select()
      .from(schema.webRuntimeRuns)
      .where(sql`${schema.webRuntimeRuns.id} = ${run.id}`);
    expect(storedAfter!.bootstrapTokenHash).toBeNull();
  });

  it('expires unclaimed bootstrap credentials inside the locked claim transaction', async () => {
    const { run, token } = await createRun();
    await database!
      .update(schema.webRuntimeRuns)
      .set({ bootstrapExpiresAt: new Date(Date.now() - 1_000) })
      .where(sql`${schema.webRuntimeRuns.id} = ${run.id}`);
    await expect(
      runs.claimBootstrap({ runId: run.id, bootstrapToken: token }),
    ).rejects.toBeInstanceOf(WebRuntimeRunNotFoundError);
    const [stored] = await database!
      .select()
      .from(schema.webRuntimeRuns)
      .where(sql`${schema.webRuntimeRuns.id} = ${run.id}`);
    expect(stored).toMatchObject({
      status: 'failed',
      failureCode: 'runtime_timeout',
      bootstrapTokenHash: null,
      terminalAuthority: 'client_observed',
    });
  });

  it('rejects terminal settlement before the one-time bootstrap is claimed', async () => {
    const { run } = await createRun();
    await expect(
      runs.settleAuthorizedRun({
        runId: run.id,
        notebookId,
        trustedSubjectId: owner,
        status: 'succeeded',
      }),
    ).rejects.toBeInstanceOf(WebRuntimeRunNotFoundError);
  });

  it('keeps the first terminal across duplicate terminal and cancel races', async () => {
    const { run, token } = await createRun();
    await runs.claimBootstrap({ runId: run.id, bootstrapToken: token });
    const settled = await Promise.allSettled([
      runs.settleAuthorizedRun({
        runId: run.id,
        notebookId,
        trustedSubjectId: owner,
        status: 'succeeded',
      }),
      runs.cancelAuthorizedRun({
        runId: run.id,
        notebookId,
        trustedSubjectId: owner,
      }),
    ]);
    expect(settled.some((result) => result.status === 'fulfilled')).toBe(true);
    const first = await runs.cancelAuthorizedRun({
      runId: run.id,
      notebookId,
      trustedSubjectId: owner,
    });
    const duplicate = await runs.cancelAuthorizedRun({
      runId: run.id,
      notebookId,
      trustedSubjectId: owner,
    });
    expect(duplicate.status).toBe(first.status);
    await expect(
      runs.settleAuthorizedRun({
        runId: run.id,
        notebookId,
        trustedSubjectId: owner,
        status: 'failed',
        failureCode: 'execution_failed',
      }),
    ).rejects.toBeInstanceOf(WebRuntimeRunNotFoundError);
    expect(await database!.select().from(schema.learningEvents)).toEqual([]);
  });
});
