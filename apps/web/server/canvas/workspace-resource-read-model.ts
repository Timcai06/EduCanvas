import 'server-only';

import {
  workspaceResourceSummarySchema,
  type WorkspaceResourceSummary,
} from '@educanvas/canvas-protocol';
import { type AssetSnapshot } from '@educanvas/db';
import {
  DrizzleWorkspaceResourceMemberFactsRepository,
  DrizzleWorkspaceResourceSummaryRepository,
} from '@educanvas/db/workspace-resource-summary';
import { projectOwnedArtifactResource } from './artifact-resource-adapter';
import { projectOwnedSourceResourcesForSubject } from './resource-access';
import {
  buildWorkspaceResourceCacheKey,
  decodeCursor,
  encodeCursor,
  WorkspaceResourceReadModelError,
  type WorkspaceResourceSummaryCursor,
  type ResourceFilter,
  type WebDataOwnerKind,
} from './workspace-resource-cursor';
export {
  buildWorkspaceResourceCacheKey,
  WorkspaceResourceReadModelError,
  type WorkspaceResourceSummaryCursor,
} from './workspace-resource-cursor';
import { loadOwnedGeneralRequestConversationForSubject } from '../platform/general-request-conversation-context';

const WEB_ARTIFACT_KINDS = [
  'mind_map',
  'slides',
  'flashcards',
  'markdown_document',
  'note',
  'audio_overview',
  'generated_image',
  'picturebook',
  'dom_exploration',
  'web_app',
] as const;
export interface WorkspaceResourceSummaryCandidate {
  readonly resourceKind: 'source' | 'artifact';
  readonly resourceId: string;
  readonly updatedAt: string;
  readonly item: WorkspaceResourceSummary | null;
}

function defaultSourceEnabled(snapshot: AssetSnapshot): boolean {
  return (
    snapshot.descriptor.scope === 'space' &&
    snapshot.descriptor.status === 'ready'
  );
}

function asSummary(input: unknown): WorkspaceResourceSummary {
  const parsed = workspaceResourceSummarySchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkspaceResourceReadModelError('resource_not_found');
  }
  return parsed.data;
}

type ArtifactFact = Awaited<
  ReturnType<DrizzleWorkspaceResourceSummaryRepository['listArtifactFactsPage']>
>['items'][number];

const asProjectionJob = (job: ArtifactFact['latestJob']) =>
  job ? { ...job, checkpoint: {}, queueJobKey: null } : null;

export function validateWorkspaceArtifactFact(fact: ArtifactFact): void {
  if (!['proposed', 'active', 'archived'].includes(fact.artifact.status)) {
    throw new WorkspaceResourceReadModelError('resource_not_found');
  }
  if (
    fact.latestJob &&
    !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(
      fact.latestJob.status,
    )
  ) {
    throw new WorkspaceResourceReadModelError('resource_not_found');
  }
  if (
    (fact.artifact.latestVersion === 0 && fact.latestVersion !== null) ||
    (fact.artifact.latestVersion > 0 &&
      fact.latestVersion?.version !== fact.artifact.latestVersion)
  ) {
    throw new WorkspaceResourceReadModelError('resource_not_found');
  }
}

export function mergeWorkspaceResourceCandidates(input: {
  readonly candidates: readonly WorkspaceResourceSummaryCandidate[];
  readonly cursor: WorkspaceResourceSummaryCursor;
  readonly limit: number;
  readonly hasFurtherDatabasePage: boolean;
}): {
  readonly items: readonly WorkspaceResourceSummary[];
  readonly cursor: WorkspaceResourceSummaryCursor;
  readonly hasMore: boolean;
} {
  const candidates = [...input.candidates].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.resourceKind.localeCompare(right.resourceKind) ||
      right.resourceId.localeCompare(left.resourceId),
  );
  const items: WorkspaceResourceSummary[] = [];
  let sourceCursor = input.cursor.source;
  let artifactCursor = input.cursor.artifact;
  let scanned = 0;
  while (scanned < candidates.length && items.length < input.limit) {
    const candidate = candidates[scanned]!;
    const next = {
      timestamp: new Date(candidate.updatedAt),
      id: candidate.resourceId,
    };
    if (candidate.resourceKind === 'source') sourceCursor = next;
    else artifactCursor = next;
    if (candidate.item) items.push(candidate.item);
    scanned += 1;
  }
  return {
    items,
    cursor: { source: sourceCursor, artifact: artifactCursor },
    hasMore: scanned < candidates.length || input.hasFurtherDatabasePage,
  };
}

/** 双 keyset 游标只推进已扫描的分域事实，不使用 offset。 */
export async function listWorkspaceResourceSummaries(input: {
  readonly dataOwnerKind: WebDataOwnerKind;
  readonly dataOwnerId: string;
  readonly cursor: string | null;
  readonly filter: ResourceFilter;
  readonly limit?: number;
  readonly request?: Request;
}): Promise<{
  readonly items: readonly WorkspaceResourceSummary[];
  readonly nextCursor: string | null;
}> {
  const conversation = await loadOwnedGeneralRequestConversationForSubject(
    input.dataOwnerId,
    input.request,
    ['general', 'k12.teacher'],
  );
  if (!conversation) {
    throw new WorkspaceResourceReadModelError('resource_not_found');
  }
  // 即使当前端点 no-store，也在唯一服务端位置冻结未来缓存的主体隔离语义。
  buildWorkspaceResourceCacheKey({
    dataOwnerKind: input.dataOwnerKind,
    dataOwnerId: input.dataOwnerId,
    notebookId: conversation.spaceId,
    cursor: input.cursor,
    filter: input.filter,
  });
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const cursor = decodeCursor(input.cursor);
  const summaries = new DrizzleWorkspaceResourceSummaryRepository();
  const memberFactsRepository =
    new DrizzleWorkspaceResourceMemberFactsRepository();
  const [sourcePage, artifactPage] = await Promise.all([
    input.filter === 'artifact'
      ? Promise.resolve({ items: [], nextCursor: null })
      : summaries.listSourceFactsPage({
          ownerSubjectId: input.dataOwnerId,
          spaceId: conversation.spaceId,
          limit,
          cursor: cursor.source,
        }),
    input.filter === 'source'
      ? Promise.resolve({ items: [], nextCursor: null })
      : summaries.listArtifactFactsPage({
          ownerSubjectId: input.dataOwnerId,
          spaceId: conversation.spaceId,
          limit,
          cursor: cursor.artifact,
          kinds: WEB_ARTIFACT_KINDS,
        }),
  ]);
  const memberFacts = await memberFactsRepository.load({
    ownerSubjectId: input.dataOwnerId,
    spaceId: conversation.spaceId,
    sourceIds: sourcePage.items.map((item) => item.descriptor.assetId),
    artifactIds: artifactPage.items.map((item) => item.artifact.id),
  });
  const sourceResources = await projectOwnedSourceResourcesForSubject({
    ownerSubjectId: input.dataOwnerId,
    notebookId: conversation.spaceId,
    snapshots: sourcePage.items,
  });

  const sourceCandidates = sourcePage.items.map((snapshot) => {
    const resource = sourceResources.get(snapshot.descriptor.assetId);
    if (!resource) {
      return {
        resourceKind: 'source' as const,
        resourceId: snapshot.descriptor.assetId,
        updatedAt: snapshot.updatedAt,
        item: null,
      };
    }
    const enabled =
      memberFacts.sourceBindings.get(snapshot.descriptor.assetId) ??
      defaultSourceEnabled(snapshot);
    return {
      resourceKind: 'source' as const,
      resourceId: snapshot.descriptor.assetId,
      updatedAt: snapshot.updatedAt,
      item: asSummary({
        schemaVersion: 1,
        resourceKind: 'source',
        resourceId: resource.resourceId,
        notebookId: resource.notebookId,
        title: resource.title,
        updatedAt: snapshot.updatedAt,
        status: resource.status,
        version: resource.version
          ? { versionId: resource.version.versionId, sequence: null }
          : null,
        renderer: resource.renderer,
        allowedActions: resource.allowedActions,
        provenance: {
          sourceResourceIds: [],
          sourceReferences: [],
        },
        context: {
          enabled,
          ...(snapshot.descriptor.origin === 'research_web'
            ? { researchSource: true }
            : {}),
        },
        surface: {
          restState:
            memberFacts.surfacePositions.get(`source:${resource.resourceId}`)
              ?.restState ?? null,
        },
      }),
    };
  });
  const artifactCandidates = artifactPage.items.map((fact) => {
    validateWorkspaceArtifactFact(fact);
    const version = fact.latestVersion
      ? {
          ...fact.latestVersion,
          content: null,
          metadata: null,
          objectKey: null,
          checksum: null,
        }
      : null;
    const latestJob = asProjectionJob(fact.latestJob);
    const versionJob = asProjectionJob(fact.versionJob);
    const resource = projectOwnedArtifactResource({
      notebookId: conversation.spaceId,
      artifact: {
        ...fact.artifact,
        status: fact.artifact.status as 'proposed' | 'active' | 'archived',
        trustTier: fact.artifact.trustTier,
      },
      version,
      latestJob,
      versionJob,
      accessRole: fact.accessRole,
    });
    return {
      resourceKind: 'artifact' as const,
      resourceId: fact.artifact.id,
      updatedAt: fact.artifact.updatedAt,
      item: asSummary({
        schemaVersion: 1,
        resourceKind: 'artifact',
        resourceId: resource.resourceId,
        notebookId: resource.notebookId,
        title: resource.title,
        updatedAt: fact.artifact.updatedAt,
        status: resource.status,
        version: resource.version
          ? {
              versionId: resource.version.versionId,
              sequence: resource.version.sequence,
            }
          : null,
        renderer: resource.renderer,
        allowedActions: resource.allowedActions,
        provenance: {
          sourceResourceIds: resource.provenance.sourceResourceIds,
          sourceReferences: resource.provenance.sourceReferences ?? [],
        },
        surface: {
          restState:
            memberFacts.surfacePositions.get(`artifact:${resource.resourceId}`)
              ?.restState ?? null,
        },
      }),
    };
  });
  const merged = mergeWorkspaceResourceCandidates({
    candidates: [...sourceCandidates, ...artifactCandidates],
    cursor,
    limit,
    hasFurtherDatabasePage:
      sourcePage.nextCursor !== null || artifactPage.nextCursor !== null,
  });
  return {
    items: merged.items,
    nextCursor: merged.hasMore ? encodeCursor(merged.cursor) : null,
  };
}
