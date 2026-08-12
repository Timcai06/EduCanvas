import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { webRuntimePolicy } from '@educanvas/canvas-protocol/server';
import { DrizzleManualArtifactRepository } from './manual-artifact-repository';
import * as schema from './schema';
import {
  DrizzleWebRuntimeRunRepository,
  WebRuntimeAdmissionError,
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

  function webAppFile(path: string, mediaType: string, content: string) {
    return {
      path,
      mediaType,
      content,
      hash: createHash('sha256').update(content, 'utf8').digest('hex'),
    };
  }

  function webAppArtifact(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      manifest: {
        entry: 'index.html',
        files: [
          webAppFile(
            'index.html',
            'text/html',
            '<div id="app"></div><script src="main.js"></script>',
          ),
          webAppFile('main.js', 'text/javascript', 'console.log("app")'),
          webAppFile('styles.css', 'text/css', 'body{font-family:sans-serif;}'),
        ],
      },
      lockedDependencies: [],
      capabilities: ['dom-manipulation', 'css-render', 'javascript-runtime'],
      budget: {
        ...webRuntimePolicy.limits,
        maxMessageBytes: 1_000,
      },
      diagnostics: [],
      generatedByModel: false,
      ...overrides,
    };
  }

  async function createArtifactWithContent(
    kind: string,
    content: unknown,
  ): Promise<{ artifactId: string; artifactVersionId: string }> {
    const created = await artifacts.createWithInitialVersion({
      spaceId: notebookId,
      trustedSubjectId: owner,
      kind,
      trustTier: 'tier2',
      title: `runtime-${kind}`,
      content,
      generatedBy: 'user:manual',
    });
    return {
      artifactId: created.artifact.id,
      artifactVersionId: created.version.id,
    };
  }

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

  async function createRun(
    token = randomBytes(32).toString('base64url'),
    selectedArtifactId = artifactId,
    selectedArtifactVersionId = artifactVersionId,
  ) {
    const run = await runs.createAuthorizedRun({
      requestId: randomUUID(),
      notebookId,
      artifactId: selectedArtifactId,
      artifactVersionId: selectedArtifactVersionId,
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

  it('accepts tier2 self-contained web_app artifacts and manifest runtime payload', async () => {
    const { artifactId: webArtifactId, artifactVersionId: webVersionId } =
      await createArtifactWithContent('web_app', webAppArtifact());
    const { run, token } = await createRun(
      randomBytes(32).toString('base64url'),
      webArtifactId,
      webVersionId,
    );
    const claimed = await runs.claimBootstrap({
      runId: run.id,
      bootstrapToken: token,
    });
    expect(claimed.run.artifactVersionId).toBe(webVersionId);
    expect(claimed.content).toMatchObject({
      schemaVersion: 1,
      manifest: {
        entry: 'index.html',
      },
      lockedDependencies: [],
    });
  });

  it('accepts web_app without locked dependencies for self-contained first pass', async () => {
    const artifact = await createArtifactWithContent(
      'web_app',
      webAppArtifact({
        lockedDependencies: [],
      }),
    );
    const token = randomBytes(32).toString('base64url');
    const run = await runs.createAuthorizedRun({
      requestId: randomUUID(),
      notebookId,
      ...artifact,
      trustedSubjectId: owner,
      bootstrapToken: token,
    });
    const claimed = await runs.claimBootstrap({
      runId: run.id,
      bootstrapToken: token,
    });
    expect(claimed.run.artifactVersionId).toBe(artifact.artifactVersionId);
    expect(claimed.content).toMatchObject({
      lockedDependencies: [],
      manifest: { entry: 'index.html' },
    });
  });

  it('rejects web_app with unknown dependency when non-empty', async () => {
    const artifact = await createArtifactWithContent(
      'web_app',
      webAppArtifact({
        lockedDependencies: [{ name: 'vite', version: '5.0.0' }],
      }),
    );
    await expect(
      runs.createAuthorizedRun({
        requestId: randomUUID(),
        notebookId,
        artifactId: artifact.artifactId,
        artifactVersionId: artifact.artifactVersionId,
        trustedSubjectId: owner,
        bootstrapToken: randomBytes(32).toString('base64url'),
      }),
    ).rejects.toBeInstanceOf(WebRuntimeAdmissionError);
  });

  it('rejects web_app with mismatched dependency version when non-empty', async () => {
    const artifact = await createArtifactWithContent(
      'web_app',
      webAppArtifact({
        lockedDependencies: [{ name: 'react', version: '19.2.6' }],
      }),
    );
    await expect(
      runs.createAuthorizedRun({
        requestId: randomUUID(),
        notebookId,
        artifactId: artifact.artifactId,
        artifactVersionId: artifact.artifactVersionId,
        trustedSubjectId: owner,
        bootstrapToken: randomBytes(32).toString('base64url'),
      }),
    ).rejects.toBeInstanceOf(WebRuntimeAdmissionError);
  });

  it('rejects web_app with manifest hash mismatch at admission', async () => {
    const invalidWebApp = webAppArtifact({
      manifest: {
        entry: 'index.html',
        files: [webAppFile('index.html', 'text/html', '<div>invalid</div>')],
      },
    });
    invalidWebApp.manifest.files[0]!.hash = 'a'.repeat(64);
    await expect(
      runs.createAuthorizedRun({
        requestId: randomUUID(),
        notebookId,
        ...(await createArtifactWithContent('web_app', invalidWebApp)),
        trustedSubjectId: owner,
        bootstrapToken: randomBytes(32).toString('base64url'),
      }),
    ).rejects.toBeInstanceOf(WebRuntimeAdmissionError);
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
