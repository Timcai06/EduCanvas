import { describe, expect, it, vi } from 'vitest';
import type {
  PlatformArtifact,
  PlatformArtifactJob,
  PlatformArtifactVersion,
} from '@educanvas/db';
import {
  ArtifactResourceProjectionError,
  projectOwnedArtifactResource,
} from './artifact-resource-adapter';

vi.mock('server-only', () => ({}));

const notebookId = '20000000-0000-4000-8000-000000000002';
const artifact: PlatformArtifact = {
  id: '10000000-0000-4000-8000-000000000001',
  spaceId: notebookId,
  conversationId: null,
  ownerSubjectId: 'owner-1',
  kind: 'mind_map',
  trustTier: 'tier1',
  title: '知识图谱',
  status: 'active',
  latestVersion: 1,
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:01:00.000Z',
};
const version: PlatformArtifactVersion = {
  id: '30000000-0000-4000-8000-000000000003',
  artifactId: artifact.id,
  version: 1,
  content: {
    gradingKey: 'private-answer',
    providerBody: 'raw-provider-response',
  },
  metadata: {
    prompt: 'raw prompt',
    stack: '/private/app.ts:1',
  },
  objectKey: 'private/artifacts/result.json',
  checksum: 'b'.repeat(64),
  generatedBy: 'model:artifact.generate:v1',
  createdAt: '2026-07-25T00:01:00.000Z',
};
const runningJob: PlatformArtifactJob = {
  id: '40000000-0000-4000-8000-000000000004',
  artifactId: artifact.id,
  status: 'running',
  progress: 50,
  failureCode: null,
  params: {
    instruction: 'raw prompt',
    providerResponse: 'raw-provider-response',
  },
  checkpoint: { stack: '/private/worker.ts:2' },
  queueJobKey: 'private-queue-key',
};

describe('Artifact CanvasResource adapter', () => {
  it('maps a ready structured artifact and exposes no private fields', () => {
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact,
      version,
      latestJob: null,
      accessRole: 'owner',
    });
    const serialized = JSON.stringify(resource);

    expect(resource).toMatchObject({
      resourceKind: 'artifact',
      status: 'ready',
      version: { versionId: version.id, sequence: 1, checksum: null },
      representation: { kind: 'structured' },
      renderer: { rendererId: 'artifact.mind-map' },
      allowedActions: ['view', 'regenerate'],
      runtime: { kind: 'none' },
    });
    expect(serialized).not.toMatch(
      /objectKey|gradingKey|private-answer|raw prompt|providerBody|providerResponse|stack|queueJobKey|private-queue-key/i,
    );
  });

  it('uses version=null while an initial latestVersion=0 job is processing', () => {
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact: { ...artifact, latestVersion: 0, status: 'proposed' },
      version: null,
      latestJob: runningJob,
      accessRole: 'owner',
    });

    expect(resource.status).toBe('processing');
    expect(resource.version).toBeNull();
    expect(resource.allowedActions).toEqual([]);
  });

  it('rejects ready facts that claim a version but provide none', () => {
    expect(() =>
      projectOwnedArtifactResource({
        notebookId,
        artifact,
        version: null,
        latestJob: null,
        accessRole: 'owner',
      }),
    ).toThrow(
      expect.objectContaining<Partial<ArtifactResourceProjectionError>>({
        code: 'resource_invalid',
      }),
    );
  });

  it('fails closed for unknown kinds and trust-policy mismatches', () => {
    expect(() =>
      projectOwnedArtifactResource({
        notebookId,
        artifact: { ...artifact, kind: 'unknown_kind' },
        version,
        latestJob: null,
        accessRole: 'owner',
      }),
    ).toThrow(
      expect.objectContaining<Partial<ArtifactResourceProjectionError>>({
        code: 'renderer_not_found',
      }),
    );
    expect(() =>
      projectOwnedArtifactResource({
        notebookId,
        artifact: { ...artifact, trustTier: 'tier2' },
        version,
        latestJob: null,
        accessRole: 'owner',
      }),
    ).toThrow(
      expect.objectContaining<Partial<ArtifactResourceProjectionError>>({
        code: 'resource_invalid',
      }),
    );
  });

  it('maps audio overview from policy without granting a runtime', () => {
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact: {
        ...artifact,
        kind: 'audio_overview',
        trustTier: 'tier2',
      },
      version,
      latestJob: null,
      accessRole: 'owner',
    });

    expect(resource).toMatchObject({
      representation: { kind: 'audio', mimeType: 'audio/mpeg' },
      renderer: { rendererId: 'artifact.audio-overview' },
      trustTier: 'tier2',
      allowedActions: ['view'],
      runtime: { kind: 'none' },
    });
  });

  it('rejects cross-Notebook projection and ignores caller-shaped policy fields', () => {
    expect(() =>
      projectOwnedArtifactResource({
        notebookId: 'different-notebook',
        artifact,
        version,
        latestJob: null,
        accessRole: 'owner',
      }),
    ).toThrow(
      expect.objectContaining<Partial<ArtifactResourceProjectionError>>({
        code: 'resource_not_found',
      }),
    );

    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact,
      version,
      latestJob: null,
      accessRole: 'owner',
      allowedActions: ['run'],
      rendererId: 'attacker.renderer',
    } as Parameters<typeof projectOwnedArtifactResource>[0]);
    expect(resource.allowedActions).toEqual(['view', 'regenerate']);
    expect(resource.renderer.rendererId).toBe('artifact.mind-map');
  });

  it('keeps a viewer read-only even when the artifact kind is editable', () => {
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact: { ...artifact, kind: 'note' },
      version,
      latestJob: null,
      accessRole: 'viewer',
    });

    expect(resource.allowedActions).toEqual(['view']);
  });
});
