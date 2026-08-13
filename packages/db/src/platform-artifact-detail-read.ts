import { desc, eq } from 'drizzle-orm';
import { getDb } from './client';
import { artifactGenerationJobs, artifactVersions } from './schema/artifact';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

/** Reads the displayed version, its owning job and the lifecycle job in one snapshot. */
export async function loadArtifactDetailRows(
  transaction: DatabaseTransaction,
  artifactId: string,
) {
  const [versionWithJob] = await transaction
    .select({
      version: artifactVersions,
      versionJob: artifactGenerationJobs,
    })
    .from(artifactVersions)
    .leftJoin(
      artifactGenerationJobs,
      eq(artifactVersions.generationJobId, artifactGenerationJobs.id),
    )
    .where(eq(artifactVersions.artifactId, artifactId))
    .orderBy(desc(artifactVersions.version), desc(artifactVersions.id))
    .limit(1);
  const [latestJob] = await transaction
    .select()
    .from(artifactGenerationJobs)
    .where(eq(artifactGenerationJobs.artifactId, artifactId))
    .orderBy(
      desc(artifactGenerationJobs.createdAt),
      desc(artifactGenerationJobs.id),
    )
    .limit(1);
  return {
    version: versionWithJob?.version ?? null,
    versionJob: versionWithJob?.versionJob ?? null,
    latestJob: latestJob ?? null,
  };
}
