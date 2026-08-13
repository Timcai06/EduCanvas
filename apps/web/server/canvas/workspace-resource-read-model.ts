import 'server-only';

import { createHash } from 'node:crypto';
import {
  workspaceResourceSummarySchema,
  type WorkspaceResourceSummary,
} from '@educanvas/canvas-protocol';
import { type AssetSnapshot, type TemporalIdCursor } from '@educanvas/db';
import {
  DrizzleWorkspaceResourceMemberFactsRepository,
  DrizzleWorkspaceResourceSummaryRepository,
} from '@educanvas/db/workspace-resource-summary';
import { projectOwnedArtifactResource } from './artifact-resource-adapter';
import { projectOwnedSourceResourcesForSubject } from './resource-access';
import { loadOwnedGeneralConversationForSubject } from '../platform/general-conversation';

const WEB_ARTIFACT_KINDS = [
  'mind_map',
  'slides',
  'flashcards',
  'markdown_document',
  'note',
  'audio_overview',
  'generated_image',
  'dom_exploration',
  'web_app',
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ResourceFilter = 'all' | 'source' | 'artifact';
type WebDataOwnerKind = 'local' | 'registered' | 'anonymous';
export interface WorkspaceResourceSummaryCursor {
  readonly source: TemporalIdCursor | null;
  readonly artifact: TemporalIdCursor | null;
}
export interface WorkspaceResourceSummaryCandidate {
  readonly resourceKind: 'source' | 'artifact';
  readonly resourceId: string;
  readonly updatedAt: string;
  readonly item: WorkspaceResourceSummary | null;
}

export class WorkspaceResourceReadModelError extends Error {
  constructor(readonly code: 'invalid_cursor' | 'resource_not_found') {
    super(code);
    this.name = 'WorkspaceResourceReadModelError';
  }
}

/** CA07 数据主体进入缓存边界时只保留隔离命名空间与受控摘要。 */
export function buildWorkspaceResourceCacheKey(input: {
  readonly dataOwnerKind: WebDataOwnerKind;
  readonly dataOwnerId: string;
  readonly notebookId: string;
  readonly cursor: string | null;
  readonly filter: ResourceFilter;
}): string {
  const ownerDigest = createHash('sha256')
    .update(input.dataOwnerId, 'utf8')
    .digest('hex');
  const queryDigest = createHash('sha256')
    .update(
      JSON.stringify({
        cursor: input.cursor,
        filter: input.filter,
        sort: 'updated_at_desc_kind_id_v1',
      }),
      'utf8',
    )
    .digest('hex');
  return [
    'workspace-resource-summary-v1',
    'web',
    input.dataOwnerKind,
    ownerDigest,
    input.notebookId,
    queryDigest,
  ].join(':');
}

function cursorPart(value: unknown): TemporalIdCursor | null {
  if (value === null) return null;
  if (
    typeof value !== 'object' ||
    !value ||
    !('t' in value) ||
    typeof value.t !== 'string' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !UUID.test(value.id)
  ) {
    throw new WorkspaceResourceReadModelError('invalid_cursor');
  }
  const timestamp = new Date(value.t);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new WorkspaceResourceReadModelError('invalid_cursor');
  }
  return { timestamp, id: value.id };
}

function decodeCursor(value: string | null): WorkspaceResourceSummaryCursor {
  if (!value) return { source: null, artifact: null };
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown;
    if (
      typeof decoded !== 'object' ||
      !decoded ||
      !('v' in decoded) ||
      decoded.v !== 1 ||
      !('source' in decoded) ||
      !('artifact' in decoded) ||
      Object.keys(decoded).some(
        (key) => !['v', 'source', 'artifact'].includes(key),
      )
    ) {
      throw new WorkspaceResourceReadModelError('invalid_cursor');
    }
    return {
      source: cursorPart(decoded.source),
      artifact: cursorPart(decoded.artifact),
    };
  } catch (error) {
    if (error instanceof WorkspaceResourceReadModelError) throw error;
    throw new WorkspaceResourceReadModelError('invalid_cursor');
  }
}

function encodeCursor(cursor: WorkspaceResourceSummaryCursor): string {
  const serialize = (value: TemporalIdCursor | null) =>
    value ? { t: value.timestamp.toISOString(), id: value.id } : null;
  return Buffer.from(
    JSON.stringify({
      v: 1,
      source: serialize(cursor.source),
      artifact: serialize(cursor.artifact),
    }),
    'utf8',
  ).toString('base64url');
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
}): Promise<{
  readonly items: readonly WorkspaceResourceSummary[];
  readonly nextCursor: string | null;
}> {
  const conversation = await loadOwnedGeneralConversationForSubject(
    input.dataOwnerId,
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
        context: { enabled },
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
