export interface WorkspaceArtifactSummaryFact {
  readonly accessRole: 'owner' | 'editor' | 'contributor' | 'viewer';
  readonly artifact: {
    readonly id: string;
    readonly spaceId: string;
    readonly conversationId: string | null;
    readonly ownerSubjectId: string;
    readonly kind: string;
    readonly trustTier: string;
    readonly title: string;
    readonly status: string;
    readonly latestVersion: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly latestVersion: {
    readonly id: string;
    readonly artifactId: string;
    readonly version: number;
    readonly generatedBy: string | null;
    readonly createdByOperationId: string | null;
    readonly generationJobId: string | null;
    readonly createdAt: string;
  } | null;
  readonly latestJob: WorkspaceArtifactSummaryJob | null;
  readonly versionJob: WorkspaceArtifactSummaryJob | null;
}

export interface WorkspaceArtifactSummaryJob {
  readonly id: string;
  readonly artifactId: string;
  readonly operationId: string | null;
  readonly status: string;
  readonly progress: number | null;
  readonly failureCode: string | null;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface WorkspaceResourceMemberFacts {
  readonly sourceBindings: ReadonlyMap<string, boolean>;
  readonly surfacePositions: ReadonlyMap<
    string,
    {
      readonly zone: 'center' | 'periphery' | 'margin';
      readonly restState: 'open' | 'folded' | 'pinned';
      readonly updatedAt: string;
    }
  >;
}

export function safeWorkspaceSourceReferences(value: unknown): readonly {
  assetId: string;
  versionId: string;
}[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) =>
    typeof candidate === 'object' &&
    candidate !== null &&
    'assetId' in candidate &&
    typeof candidate.assetId === 'string' &&
    'versionId' in candidate &&
    typeof candidate.versionId === 'string'
      ? [{ assetId: candidate.assetId, versionId: candidate.versionId }]
      : [],
  );
}
