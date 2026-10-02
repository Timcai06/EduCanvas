import { and, desc, eq } from 'drizzle-orm';
import type { getDb } from './client';
import { artifactGenerationJobs, artifactVersions, artifacts } from './schema';
import type {
  ArtifactJobStatus,
  ArtifactStatus,
  PlatformArtifactGenerationReceipt,
} from './platform-artifact-types';

type Database = ReturnType<typeof getDb>;

/** Read a scope-bound, content-free receipt for the latest artifact generation job. */
export async function readPlatformArtifactGenerationReceipt(
  database: Database,
  input: {
    artifactId: string;
    spaceId: string;
    conversationId: string;
    trustedSubjectId: string;
  },
): Promise<PlatformArtifactGenerationReceipt | null> {
  const [row] = await database
    .select({
      jobId: artifactGenerationJobs.id,
      artifactId: artifacts.id,
      jobStatus: artifactGenerationJobs.status,
      progress: artifactGenerationJobs.progress,
      artifactStatus: artifacts.status,
      kind: artifacts.kind,
      title: artifacts.title,
      committedVersion: artifactVersions.version,
    })
    .from(artifactGenerationJobs)
    .innerJoin(artifacts, eq(artifactGenerationJobs.artifactId, artifacts.id))
    .leftJoin(
      artifactVersions,
      and(
        eq(artifactVersions.artifactId, artifacts.id),
        eq(artifactVersions.generationJobId, artifactGenerationJobs.id),
      ),
    )
    .where(
      and(
        eq(artifacts.id, input.artifactId),
        eq(artifacts.ownerSubjectId, input.trustedSubjectId),
        eq(artifacts.spaceId, input.spaceId),
        eq(artifacts.conversationId, input.conversationId),
      ),
    )
    .orderBy(
      desc(artifactGenerationJobs.createdAt),
      desc(artifactGenerationJobs.id),
    )
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    jobStatus: row.jobStatus as ArtifactJobStatus,
    artifactStatus: row.artifactStatus as ArtifactStatus,
    committedVersion:
      row.committedVersion === null ? null : { version: row.committedVersion },
  };
}
