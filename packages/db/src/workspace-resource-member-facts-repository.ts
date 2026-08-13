import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import {
  assets,
  notebookAssetBindings,
  notebookSurfacePositions,
} from './schema';
import type { WorkspaceResourceMemberFacts } from './workspace-resource-summary-repository';

type Database = ReturnType<typeof getDb>;

export class DrizzleWorkspaceResourceMemberFactsRepository {
  constructor(private readonly database: Database = getDb()) {}

  async load(input: {
    spaceId: string;
    ownerSubjectId: string;
    sourceIds: readonly string[];
    artifactIds: readonly string[];
  }): Promise<WorkspaceResourceMemberFacts> {
    await requireNotebookAccess(this.database, {
      notebookId: input.spaceId,
      trustedSubjectId: input.ownerSubjectId,
      requiredPermission: 'notebook.read',
    });
    const [bindingRows, positionRows] = await Promise.all([
      input.sourceIds.length
        ? this.database
            .selectDistinctOn(
              [notebookAssetBindings.subjectId, notebookAssetBindings.assetId],
              {
                assetId: notebookAssetBindings.assetId,
                enabled: notebookAssetBindings.enabled,
              },
            )
            .from(notebookAssetBindings)
            .innerJoin(assets, eq(assets.id, notebookAssetBindings.assetId))
            .where(
              and(
                eq(notebookAssetBindings.subjectId, input.ownerSubjectId),
                eq(assets.spaceId, input.spaceId),
                inArray(notebookAssetBindings.assetId, [...input.sourceIds]),
                ne(assets.status, 'tombstoned'),
              ),
            )
            .orderBy(
              notebookAssetBindings.subjectId,
              notebookAssetBindings.assetId,
              desc(notebookAssetBindings.sequence),
            )
        : [],
      input.sourceIds.length || input.artifactIds.length
        ? this.database
            .select({
              resourceKind: notebookSurfacePositions.resourceKind,
              resourceId: notebookSurfacePositions.resourceId,
              zone: notebookSurfacePositions.zone,
              restState: notebookSurfacePositions.restState,
              updatedAt: notebookSurfacePositions.updatedAt,
            })
            .from(notebookSurfacePositions)
            .where(
              and(
                eq(notebookSurfacePositions.spaceId, input.spaceId),
                eq(
                  notebookSurfacePositions.ownerSubjectId,
                  input.ownerSubjectId,
                ),
                or(
                  input.sourceIds.length
                    ? and(
                        eq(notebookSurfacePositions.resourceKind, 'source'),
                        inArray(notebookSurfacePositions.resourceId, [
                          ...input.sourceIds,
                        ]),
                      )
                    : undefined,
                  input.artifactIds.length
                    ? and(
                        eq(notebookSurfacePositions.resourceKind, 'artifact'),
                        inArray(notebookSurfacePositions.resourceId, [
                          ...input.artifactIds,
                        ]),
                      )
                    : undefined,
                ),
              ),
            )
        : [],
    ]);
    return {
      sourceBindings: new Map(
        bindingRows.map((row) => [row.assetId, row.enabled]),
      ),
      surfacePositions: new Map(
        positionRows.map((row) => [
          `${row.resourceKind}:${row.resourceId}`,
          {
            zone: row.zone as 'center' | 'periphery' | 'margin',
            restState: row.restState as 'open' | 'folded' | 'pinned',
            updatedAt: row.updatedAt.toISOString(),
          },
        ]),
      ),
    };
  }
}
