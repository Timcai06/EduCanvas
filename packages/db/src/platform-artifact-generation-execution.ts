import { eq, sql } from 'drizzle-orm';
import type { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import { artifactGenerationJobs, artifacts } from './schema';
import {
  ArtifactOwnershipError,
  ArtifactJobLifecycleError,
} from './platform-artifact-errors';

type Database = ReturnType<typeof getDb>;

/**
 * 原子启动或重投任务并领取单调 generation fence。重叠的 Graphile execution
 * 后到者会使旧 execution 的 checkpoint、失败终态和版本提交全部失效。
 */
export async function claimArtifactGenerationExecution(
  database: Database,
  input: {
    jobId: string;
    trustedSubjectId: string;
  },
): Promise<{
  executionGeneration: number;
  checkpoint: Record<string, unknown>;
}> {
  return await database.transaction(async (tx) => {
    const [row] = await tx
      .select({
        job: artifactGenerationJobs,
        spaceId: artifacts.spaceId,
      })
      .from(artifactGenerationJobs)
      .innerJoin(artifacts, eq(artifactGenerationJobs.artifactId, artifacts.id))
      .where(eq(artifactGenerationJobs.id, input.jobId))
      .for('update', { of: artifactGenerationJobs })
      .limit(1);
    if (!row) throw new ArtifactOwnershipError();
    await requireNotebookAccess(tx, {
      notebookId: row.spaceId,
      trustedSubjectId: input.trustedSubjectId,
      requiredPermission: 'artifact.write',
    }).catch(() => {
      throw new ArtifactOwnershipError();
    });
    if (row.job.status !== 'queued' && row.job.status !== 'running') {
      throw new ArtifactJobLifecycleError(row.job.status, 'running');
    }
    const [updated] = await tx
      .update(artifactGenerationJobs)
      .set({
        status: 'running',
        startedAt: sql`COALESCE(${artifactGenerationJobs.startedAt}, now())`,
        progress: sql`GREATEST(COALESCE(${artifactGenerationJobs.progress}, 0), 5)`,
        executionGeneration: sql`${artifactGenerationJobs.executionGeneration} + 1`,
      })
      .where(eq(artifactGenerationJobs.id, input.jobId))
      .returning({
        executionGeneration: artifactGenerationJobs.executionGeneration,
      });
    return {
      executionGeneration: updated!.executionGeneration,
      checkpoint: row.job.checkpoint as Record<string, unknown>,
    };
  });
}
