export type ArtifactTrustTier = 'tier1' | 'tier2';
export type ArtifactStatus = 'proposed' | 'active' | 'archived';
export type ArtifactJobStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface PlatformArtifact {
  id: string;
  spaceId: string;
  conversationId: string | null;
  ownerSubjectId: string;
  kind: string;
  trustTier: ArtifactTrustTier;
  title: string;
  status: ArtifactStatus;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  content: unknown;
  metadata: unknown;
  objectKey: string | null;
  checksum: string | null;
  createdByOperationId: string | null;
  generatedBy: string | null;
  generationJobId: string | null;
  createdAt: string;
}

export interface PlatformArtifactJob {
  id: string;
  artifactId: string;
  operationId: string | null;
  status: ArtifactJobStatus;
  progress: number | null;
  failureCode: string | null;
  params: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  queueJobKey: string | null;
}

/** A scope-bound, content-free read receipt for one artifact generation job. */
export interface PlatformArtifactGenerationReceipt {
  jobId: string;
  artifactId: string;
  jobStatus: ArtifactJobStatus;
  progress: number | null;
  artifactStatus: ArtifactStatus;
  kind: string;
  title: string;
  committedVersion: { version: number } | null;
}
