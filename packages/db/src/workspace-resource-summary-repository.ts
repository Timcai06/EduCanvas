import { and, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import {
  assetDescriptorSchema,
  assetVersionDescriptorSchema,
} from '@educanvas/agent-core';
import type { NotebookPermission } from '@educanvas/gateway-core';
import type { AssetSnapshot } from './asset-repository';
import { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import {
  boundedPageLimit,
  type CursorPage,
  type TemporalIdCursor,
} from './pagination';
import {
  artifactGenerationJobs,
  artifactVersions,
  artifacts,
  assetProcessingJobs,
  assetVersions,
  assets,
} from './schema';
import {
  safeWorkspaceSourceReferences,
  type WorkspaceArtifactSummaryFact,
  type WorkspaceResourceMemberFacts,
} from './workspace-resource-summary-types';

export type {
  WorkspaceArtifactSummaryFact,
  WorkspaceResourceMemberFacts,
} from './workspace-resource-summary-types';

type Database = ReturnType<typeof getDb>;

function toSourceSnapshot(
  asset: typeof assets.$inferSelect,
  version: typeof assetVersions.$inferSelect | null,
  processing: typeof assetProcessingJobs.$inferSelect | null,
): AssetSnapshot {
  return {
    descriptor: assetDescriptorSchema.parse({
      assetId: asset.id,
      scope: asset.scope,
      kind: asset.kind,
      origin: asset.origin,
      displayName: asset.displayName,
      mimeType: asset.mimeType,
      status: asset.status,
      currentVersionId: asset.currentVersionId,
    }),
    version: version
      ? assetVersionDescriptorSchema.parse({
          assetId: version.assetId,
          versionId: version.id,
          kind: version.kind,
          mimeType: version.mimeType,
          byteSize: version.byteSize,
          contentHash: version.contentHash,
          status: version.status,
        })
      : null,
    processing: processing
      ? {
          status: processing.status as NonNullable<
            AssetSnapshot['processing']
          >['status'],
          attempts: processing.attempts,
          failureCode: processing.failureCode,
          createdAt: processing.createdAt.toISOString(),
          startedAt: processing.startedAt?.toISOString() ?? null,
          completedAt: processing.completedAt?.toISOString() ?? null,
        }
      : null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

async function requireReadAccess(
  database: Database,
  input: {
    spaceId: string;
    ownerSubjectId: string;
    permission: NotebookPermission;
  },
) {
  return requireNotebookAccess(database, {
    notebookId: input.spaceId,
    trustedSubjectId: input.ownerSubjectId,
    requiredPermission: input.permission,
  });
}

/** 资源工作台窄读模型只选摘要字段，不载入正文、objectKey 或完整任务参数。
 * 版本与任务按整页 ID 批量读取，查询数保持有界，避免详情 N+1。 */
export class DrizzleWorkspaceResourceSummaryRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  /** Source 摘要按更新时间分页；与历史 Source createdAt 列表互不改变。 */
  async listSourceFactsPage(input: {
    readonly spaceId: string;
    readonly ownerSubjectId: string;
    readonly limit?: number;
    readonly cursor?: TemporalIdCursor | null;
  }): Promise<CursorPage<AssetSnapshot>> {
    const limit = boundedPageLimit(input.limit);
    await requireReadAccess(this.database, {
      spaceId: input.spaceId,
      ownerSubjectId: input.ownerSubjectId,
      permission: 'notebook.read',
    });
    const rows = await this.database
      .select({ asset: assets, version: assetVersions })
      .from(assets)
      .leftJoin(assetVersions, eq(assetVersions.id, assets.currentVersionId))
      .where(
        and(
          eq(assets.spaceId, input.spaceId),
          ne(assets.status, 'tombstoned'),
          input.cursor
            ? or(
                lt(assets.updatedAt, input.cursor.timestamp),
                and(
                  eq(assets.updatedAt, input.cursor.timestamp),
                  lt(assets.id, input.cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(assets.updatedAt), desc(assets.id))
      .limit(limit + 1);
    const pageRows = rows.slice(0, limit);
    const sourceIds = pageRows.map(({ asset }) => asset.id);
    const processingRows =
      sourceIds.length === 0
        ? []
        : await this.database
            .selectDistinctOn([assetVersions.assetId], {
              assetId: assetVersions.assetId,
              processing: assetProcessingJobs,
            })
            .from(assetProcessingJobs)
            .innerJoin(
              assetVersions,
              eq(assetVersions.id, assetProcessingJobs.assetVersionId),
            )
            .where(
              and(
                inArray(assetVersions.assetId, sourceIds),
                inArray(assetProcessingJobs.kind, [
                  'extract_text',
                  'transcribe_audio',
                  'process_video',
                ]),
              ),
            )
            .orderBy(
              assetVersions.assetId,
              desc(assetProcessingJobs.createdAt),
              desc(assetProcessingJobs.id),
            );
    const processingBySource = new Map(
      processingRows.map((row) => [row.assetId, row.processing]),
    );
    const last = pageRows.at(-1)?.asset;
    return {
      items: pageRows.map(({ asset, version }) =>
        toSourceSnapshot(
          asset,
          version,
          processingBySource.get(asset.id) ?? null,
        ),
      ),
      nextCursor:
        rows.length > limit && last
          ? { timestamp: last.updatedAt, id: last.id }
          : null,
    };
  }

  async listArtifactFactsPage(input: {
    readonly spaceId: string;
    readonly ownerSubjectId: string;
    readonly limit?: number;
    readonly cursor?: TemporalIdCursor | null;
    readonly kinds?: readonly string[];
  }): Promise<CursorPage<WorkspaceArtifactSummaryFact>> {
    const limit = boundedPageLimit(input.limit);
    return this.database.transaction(
      async (tx) => {
        const access = await requireNotebookAccess(tx, {
          notebookId: input.spaceId,
          trustedSubjectId: input.ownerSubjectId,
          requiredPermission: 'notebook.read',
        });
        const artifactRows = await tx
          .select()
          .from(artifacts)
          .where(
            and(
              eq(artifacts.spaceId, input.spaceId),
              ne(artifacts.status, 'archived'),
              input.kinds?.length
                ? inArray(artifacts.kind, [...input.kinds])
                : undefined,
              input.cursor
                ? or(
                    lt(artifacts.updatedAt, input.cursor.timestamp),
                    and(
                      eq(artifacts.updatedAt, input.cursor.timestamp),
                      lt(artifacts.id, input.cursor.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(artifacts.updatedAt), desc(artifacts.id))
          .limit(limit + 1);
        const pageRows = artifactRows.slice(0, limit);
        const artifactIds = pageRows.map((artifact) => artifact.id);

        const [versionRows, latestJobRows] =
          artifactIds.length === 0
            ? [[], []]
            : await Promise.all([
                tx
                  .selectDistinctOn([artifactVersions.artifactId], {
                    id: artifactVersions.id,
                    artifactId: artifactVersions.artifactId,
                    version: artifactVersions.version,
                    generatedBy: artifactVersions.generatedBy,
                    createdByOperationId: artifactVersions.createdByOperationId,
                    generationJobId: artifactVersions.generationJobId,
                    createdAt: artifactVersions.createdAt,
                  })
                  .from(artifactVersions)
                  .where(inArray(artifactVersions.artifactId, artifactIds))
                  .orderBy(
                    artifactVersions.artifactId,
                    desc(artifactVersions.version),
                    desc(artifactVersions.id),
                  ),
                tx
                  .selectDistinctOn([artifactGenerationJobs.artifactId], {
                    id: artifactGenerationJobs.id,
                    artifactId: artifactGenerationJobs.artifactId,
                    operationId: artifactGenerationJobs.operationId,
                    status: artifactGenerationJobs.status,
                    progress: artifactGenerationJobs.progress,
                    failureCode: artifactGenerationJobs.failureCode,
                    provenanceSources: sql<unknown>`${artifactGenerationJobs.params} #> '{provenance,sources}'`,
                    selectedSources: sql<unknown>`${artifactGenerationJobs.params} -> 'selectedSources'`,
                  })
                  .from(artifactGenerationJobs)
                  .where(
                    inArray(artifactGenerationJobs.artifactId, artifactIds),
                  )
                  .orderBy(
                    artifactGenerationJobs.artifactId,
                    desc(artifactGenerationJobs.createdAt),
                    desc(artifactGenerationJobs.id),
                  ),
              ]);
        const versionJobIds = Array.from(
          new Set(
            versionRows
              .map((version) => version.generationJobId)
              .filter((jobId): jobId is string => Boolean(jobId)),
          ),
        );
        const versionJobRows =
          versionJobIds.length === 0
            ? []
            : await tx
                .select({
                  id: artifactGenerationJobs.id,
                  artifactId: artifactGenerationJobs.artifactId,
                  operationId: artifactGenerationJobs.operationId,
                  status: artifactGenerationJobs.status,
                  progress: artifactGenerationJobs.progress,
                  failureCode: artifactGenerationJobs.failureCode,
                  provenanceSources: sql<unknown>`${artifactGenerationJobs.params} #> '{provenance,sources}'`,
                  selectedSources: sql<unknown>`${artifactGenerationJobs.params} -> 'selectedSources'`,
                })
                .from(artifactGenerationJobs)
                .where(inArray(artifactGenerationJobs.id, versionJobIds));

        const latestVersions = new Map(
          versionRows.map((version) => [version.artifactId, version]),
        );
        const latestJobs = new Map(
          latestJobRows.map((job) => [job.artifactId, job]),
        );
        const versionJobsById = new Map(
          versionJobRows.map((job) => [job.id, job]),
        );

        const last = pageRows.at(-1);
        return {
          items: pageRows.map((artifact) => {
            const version = latestVersions.get(artifact.id) ?? null;
            const job = latestJobs.get(artifact.id);
            const provenanceSources = safeWorkspaceSourceReferences(
              job?.provenanceSources,
            );
            const selectedSources = safeWorkspaceSourceReferences(
              job?.selectedSources,
            );
            const versionGenerationJobId = version?.generationJobId;
            const versionJob = versionGenerationJobId
              ? (versionJobsById.get(versionGenerationJobId) ?? null)
              : null;
            const versionJobProvenanceSources = safeWorkspaceSourceReferences(
              versionJob?.provenanceSources,
            );
            const versionJobSelectedSources = safeWorkspaceSourceReferences(
              versionJob?.selectedSources,
            );
            return {
              accessRole: access.role,
              artifact: {
                id: artifact.id,
                spaceId: artifact.spaceId,
                conversationId: artifact.conversationId,
                ownerSubjectId: artifact.ownerSubjectId,
                kind: artifact.kind,
                trustTier: artifact.trustTier,
                title: artifact.title,
                status: artifact.status,
                latestVersion: artifact.latestVersion,
                createdAt: artifact.createdAt.toISOString(),
                updatedAt: artifact.updatedAt.toISOString(),
              },
              latestVersion: version
                ? {
                    ...version,
                    createdAt: version.createdAt.toISOString(),
                  }
                : null,
              latestJob: job
                ? {
                    id: job.id,
                    artifactId: job.artifactId,
                    operationId: job.operationId,
                    status: job.status,
                    progress: job.progress,
                    failureCode: job.failureCode,
                    params: {
                      ...(provenanceSources.length === 0
                        ? {}
                        : { provenance: { sources: provenanceSources } }),
                      ...(selectedSources.length === 0
                        ? {}
                        : { selectedSources }),
                    },
                  }
                : null,
              versionJob: versionJob
                ? {
                    id: versionJob.id,
                    artifactId: versionJob.artifactId,
                    operationId: versionJob.operationId,
                    status: versionJob.status,
                    progress: versionJob.progress,
                    failureCode: versionJob.failureCode,
                    params: {
                      ...(versionJobProvenanceSources.length === 0
                        ? {}
                        : {
                            provenance: {
                              sources: versionJobProvenanceSources,
                            },
                          }),
                      ...(versionJobSelectedSources.length === 0
                        ? {}
                        : { selectedSources: versionJobSelectedSources }),
                    },
                  }
                : null,
            };
          }),
          nextCursor:
            artifactRows.length > limit && last
              ? { timestamp: last.updatedAt, id: last.id }
              : null,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
