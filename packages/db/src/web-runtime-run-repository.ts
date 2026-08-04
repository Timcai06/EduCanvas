import {
  domExplorationContentSchema,
  validateWebRuntimePolicy,
  webRuntimePolicy,
  type DomExplorationContent,
} from '@educanvas/canvas-protocol/server';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import { artifacts, artifactVersions, webRuntimeRuns } from './schema';

type Database = ReturnType<typeof getDb>;
type RuntimeStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';
type RuntimeFailureCode =
  | 'runtime_timeout'
  | 'runtime_crashed'
  | 'resource_quota_exceeded'
  | 'execution_failed'
  | 'cancel_race_rejected';
export const WEB_RUNTIME_BOOTSTRAP_TTL_MS = 60_000;

export class WebRuntimeRunNotFoundError extends Error {
  readonly code = 'resource_not_found';
}

export class WebRuntimeAdmissionError extends Error {
  readonly code = 'runtime_rejected';
}

export interface WebRuntimeRunSnapshot {
  id: string;
  requestId: string;
  runtimeId: string;
  notebookId: string;
  artifactId: string;
  artifactVersionId: string;
  artifactContentHash: string;
  status: RuntimeStatus;
  failureCode: RuntimeFailureCode | null;
  terminalAuthority: 'client_observed';
}

export interface ClaimedWebRuntimeBootstrap {
  run: WebRuntimeRunSnapshot;
  content: DomExplorationContent;
}

const digest = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const safeHashEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};

function parseContent(value: unknown): DomExplorationContent {
  const parsed = domExplorationContentSchema.safeParse(value);
  if (!parsed.success || parsed.data.dependencies.length !== 0) {
    throw new WebRuntimeAdmissionError();
  }
  const policy = validateWebRuntimePolicy({
    dependencies: parsed.data.dependencies,
    limits: webRuntimePolicy.limits,
    network: webRuntimePolicy.network,
    iframeSandbox: webRuntimePolicy.iframeSandbox,
    csp: webRuntimePolicy.csp,
  });
  const bytes = Buffer.byteLength(JSON.stringify(parsed.data), 'utf8');
  if (!policy.ok || bytes > webRuntimePolicy.limits.maxInputBytes) {
    throw new WebRuntimeAdmissionError();
  }
  return parsed.data;
}

function contentHash(content: DomExplorationContent): string {
  return digest(JSON.stringify(content));
}

function snapshot(
  row: typeof webRuntimeRuns.$inferSelect,
): WebRuntimeRunSnapshot {
  return {
    id: row.id,
    requestId: row.requestId,
    runtimeId: row.runtimeId,
    notebookId: row.notebookId,
    artifactId: row.artifactId,
    artifactVersionId: row.artifactVersionId,
    artifactContentHash: row.artifactContentHash,
    status: row.status as RuntimeStatus,
    failureCode: row.failureCode as RuntimeFailureCode | null,
    terminalAuthority: 'client_observed',
  };
}

export class DrizzleWebRuntimeRunRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createAuthorizedRun(input: {
    requestId: string;
    notebookId: string;
    artifactId: string;
    artifactVersionId: string;
    trustedSubjectId: string;
    bootstrapToken: string;
  }): Promise<WebRuntimeRunSnapshot> {
    return this.database.transaction(async (tx) => {
      await requireNotebookAccess(tx, {
        notebookId: input.notebookId,
        trustedSubjectId: input.trustedSubjectId,
        requiredPermission: 'notebook.read',
      }).catch(() => {
        throw new WebRuntimeRunNotFoundError();
      });
      const [version] = await tx
        .select({
          artifactId: artifacts.id,
          spaceId: artifacts.spaceId,
          kind: artifacts.kind,
          trustTier: artifacts.trustTier,
          status: artifacts.status,
          versionId: artifactVersions.id,
          content: artifactVersions.content,
        })
        .from(artifacts)
        .innerJoin(
          artifactVersions,
          eq(artifactVersions.artifactId, artifacts.id),
        )
        .where(
          and(
            eq(artifacts.id, input.artifactId),
            eq(artifacts.spaceId, input.notebookId),
            eq(artifactVersions.id, input.artifactVersionId),
          ),
        )
        .limit(1);
      if (
        !version ||
        version.kind !== 'dom_exploration' ||
        version.trustTier !== 'tier2' ||
        version.status !== 'active'
      ) {
        throw new WebRuntimeRunNotFoundError();
      }
      const content = parseContent(version.content);
      const [row] = await tx
        .insert(webRuntimeRuns)
        .values({
          requestId: input.requestId,
          notebookId: input.notebookId,
          artifactId: version.artifactId,
          artifactVersionId: version.versionId,
          artifactContentHash: contentHash(content),
          requesterSubjectId: input.trustedSubjectId,
          bootstrapTokenHash: digest(input.bootstrapToken),
          bootstrapExpiresAt: new Date(
            Date.now() + WEB_RUNTIME_BOOTSTRAP_TTL_MS,
          ),
        })
        .returning();
      return snapshot(row!);
    });
  }

  async claimBootstrap(input: {
    runId: string;
    bootstrapToken: string;
  }): Promise<ClaimedWebRuntimeBootstrap> {
    const claimed = await this.database.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(webRuntimeRuns)
        .where(eq(webRuntimeRuns.id, input.runId))
        .for('update')
        .limit(1);
      const suppliedHash = digest(input.bootstrapToken);
      if (
        !row ||
        row.status !== 'running' ||
        !row.bootstrapTokenHash ||
        !safeHashEqual(row.bootstrapTokenHash, suppliedHash)
      ) {
        throw new WebRuntimeRunNotFoundError();
      }
      if (row.bootstrapExpiresAt.getTime() <= Date.now()) {
        await tx
          .update(webRuntimeRuns)
          .set({
            bootstrapTokenHash: null,
            status: 'failed',
            failureCode: 'runtime_timeout',
            completedAt: sql`now()`,
          })
          .where(eq(webRuntimeRuns.id, row.id));
        return null;
      }
      const [version] = await tx
        .select({ content: artifactVersions.content })
        .from(artifactVersions)
        .where(
          and(
            eq(artifactVersions.id, row.artifactVersionId),
            eq(artifactVersions.artifactId, row.artifactId),
          ),
        )
        .limit(1);
      if (!version) throw new WebRuntimeRunNotFoundError();
      const content = parseContent(version.content);
      if (contentHash(content) !== row.artifactContentHash) {
        throw new WebRuntimeRunNotFoundError();
      }
      await tx
        .update(webRuntimeRuns)
        .set({
          bootstrapTokenHash: null,
          bootstrapClaimedAt: sql`now()`,
        })
        .where(eq(webRuntimeRuns.id, row.id));
      return { run: snapshot(row), content };
    });
    if (!claimed) throw new WebRuntimeRunNotFoundError();
    return claimed;
  }

  async settleAuthorizedRun(input: {
    runId: string;
    notebookId: string;
    trustedSubjectId: string;
    status: Exclude<RuntimeStatus, 'running'>;
    failureCode?: RuntimeFailureCode;
  }): Promise<WebRuntimeRunSnapshot> {
    return this.database.transaction(async (tx) => {
      await requireNotebookAccess(tx, {
        notebookId: input.notebookId,
        trustedSubjectId: input.trustedSubjectId,
        requiredPermission: 'notebook.read',
      }).catch(() => {
        throw new WebRuntimeRunNotFoundError();
      });
      const [row] = await tx
        .select()
        .from(webRuntimeRuns)
        .where(
          and(
            eq(webRuntimeRuns.id, input.runId),
            eq(webRuntimeRuns.notebookId, input.notebookId),
            eq(webRuntimeRuns.requesterSubjectId, input.trustedSubjectId),
          ),
        )
        .for('update')
        .limit(1);
      if (!row || row.status !== 'running' || row.bootstrapClaimedAt === null) {
        throw new WebRuntimeRunNotFoundError();
      }
      const [updated] = await tx
        .update(webRuntimeRuns)
        .set({
          status: input.status,
          failureCode:
            input.status === 'failed'
              ? (input.failureCode ?? 'execution_failed')
              : null,
          bootstrapTokenHash: null,
          completedAt: sql`now()`,
        })
        .where(eq(webRuntimeRuns.id, row.id))
        .returning();
      return snapshot(updated!);
    });
  }

  /**
   * Cancel 是幂等的服务端权威动作：已赢得竞态的 terminal 保持原终态，
   * 只有同一可信主体和 Notebook 能得到该结果。
   */
  async cancelAuthorizedRun(input: {
    notebookId: string;
    trustedSubjectId: string;
    runId?: string;
    requestId?: string;
  }): Promise<WebRuntimeRunSnapshot> {
    if ((input.runId ? 1 : 0) + (input.requestId ? 1 : 0) !== 1) {
      throw new WebRuntimeRunNotFoundError();
    }
    return this.database.transaction(async (tx) => {
      await requireNotebookAccess(tx, {
        notebookId: input.notebookId,
        trustedSubjectId: input.trustedSubjectId,
        requiredPermission: 'notebook.read',
      }).catch(() => {
        throw new WebRuntimeRunNotFoundError();
      });
      const selector = input.runId
        ? eq(webRuntimeRuns.id, input.runId)
        : eq(webRuntimeRuns.requestId, input.requestId!);
      const [row] = await tx
        .select()
        .from(webRuntimeRuns)
        .where(
          and(
            selector,
            eq(webRuntimeRuns.notebookId, input.notebookId),
            eq(webRuntimeRuns.requesterSubjectId, input.trustedSubjectId),
          ),
        )
        .for('update')
        .limit(1);
      if (!row) throw new WebRuntimeRunNotFoundError();
      if (row.status !== 'running') return snapshot(row);
      const [updated] = await tx
        .update(webRuntimeRuns)
        .set({
          status: 'cancelled',
          bootstrapTokenHash: null,
          completedAt: sql`now()`,
        })
        .where(eq(webRuntimeRuns.id, row.id))
        .returning();
      return snapshot(updated!);
    });
  }
}
