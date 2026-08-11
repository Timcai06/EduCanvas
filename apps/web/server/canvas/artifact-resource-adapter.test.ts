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
  createdByOperationId: null,
  generatedBy: 'model:artifact.generate:v1',
  generationJobId: null,
  createdAt: '2026-07-25T00:01:00.000Z',
};
const runningJob: PlatformArtifactJob = {
  id: '40000000-0000-4000-8000-000000000004',
  artifactId: artifact.id,
  operationId: null,
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
      allowedActions: ['view', 'regenerate', 'annotate'],
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
      allowedActions: ['view', 'download', 'delete', 'annotate'],
      runtime: { kind: 'none' },
    });
  });

  it('projects trusted media provenance without exposing job parameters', () => {
    const operationId = '50000000-0000-4000-8000-000000000005';
    const sourceId = '60000000-0000-4000-8000-000000000006';
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact: {
        ...artifact,
        kind: 'audio_overview',
        trustTier: 'tier2',
      },
      version: {
        ...version,
        metadata: {
          contentVersion: 1,
          contentType: 'audio/mpeg',
          byteSize: 1024,
          transcript: '这是安全保存的音频文字稿。',
          sourceCount: 1,
          script: {
            generator: 'rule:audio-overview-v1',
            provider: null,
            resolvedModelId: null,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 0,
          },
          speech: {
            provider: 'fixture-speech',
            resolvedModelId: 'tts-v1',
            voice: 'alloy',
            inputCharacters: 14,
            latencyMs: 12,
          },
        },
        createdByOperationId: operationId,
        generationJobId: runningJob.id,
      },
      latestJob: {
        ...runningJob,
        operationId,
        status: 'succeeded',
        progress: 100,
        params: {
          selectedSources: [
            {
              assetId: sourceId,
              versionId: '70000000-0000-4000-8000-000000000007',
              kind: 'document',
            },
          ],
          prompt: '不得进入 CanvasResource',
        },
      },
      accessRole: 'owner',
    });

    expect(resource.provenance).toEqual({
      origin: 'agent_generated',
      createdBy: 'agent',
      createdAt: version.createdAt,
      sourceResourceIds: [sourceId],
      operationId,
      generator: {
        provider: 'fixture-speech',
        model: 'tts-v1',
        promptSummary: null,
      },
    });
    expect(JSON.stringify(resource)).not.toContain('不得进入 CanvasResource');
  });

  it('maps a generated image as tier2 without granting a runtime or regenerate', () => {
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact: {
        ...artifact,
        kind: 'generated_image',
        trustTier: 'tier2',
      },
      version: {
        ...version,
        metadata: {
          contentVersion: 1,
          contentType: 'image/png',
          byteSize: 68,
          size: '512x512',
          image: {
            provider: 'fixture-image',
            resolvedModelId: 'image-v1',
            latencyMs: 8,
          },
        },
      },
      latestJob: null,
      accessRole: 'owner',
    });

    expect(resource).toMatchObject({
      representation: { kind: 'image' },
      renderer: { rendererId: 'artifact.generated-image' },
      trustTier: 'tier2',
      allowedActions: ['view', 'download', 'delete', 'annotate'],
      runtime: { kind: 'none' },
      canProduceCandidateLearningEvents: false,
      provenance: {
        sourceResourceIds: [],
        generator: {
          provider: 'fixture-image',
          model: 'image-v1',
          promptSummary: null,
        },
      },
    });
    expect(JSON.stringify(resource)).not.toMatch(
      /objectKey|raw prompt|providerBody|stack|queueJobKey/i,
    );
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
    expect(resource.allowedActions).toEqual(['view', 'regenerate', 'annotate']);
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

    expect(resource.allowedActions).toEqual(['view', 'annotate']);
  });

  it('grants download and delete for media artifacts with owner role', () => {
    const audioResource = projectOwnedArtifactResource({
      notebookId,
      artifact: { ...artifact, kind: 'audio_overview', trustTier: 'tier2' },
      version,
      latestJob: null,
      accessRole: 'owner',
    });
    expect(audioResource.allowedActions).toEqual([
      'view',
      'download',
      'delete',
      'annotate',
    ]);

    const imageResource = projectOwnedArtifactResource({
      notebookId,
      artifact: { ...artifact, kind: 'generated_image', trustTier: 'tier2' },
      version,
      latestJob: null,
      accessRole: 'owner',
    });
    expect(imageResource.allowedActions).toEqual([
      'view',
      'download',
      'delete',
      'annotate',
    ]);
  });

  it('grants download and delete for media artifacts with editor role', () => {
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact: { ...artifact, kind: 'audio_overview', trustTier: 'tier2' },
      version,
      latestJob: null,
      accessRole: 'editor',
    });
    expect(resource.allowedActions).toEqual([
      'view',
      'download',
      'delete',
      'annotate',
    ]);
  });

  it('grants download but not delete for media artifacts with viewer role', () => {
    const audioResource = projectOwnedArtifactResource({
      notebookId,
      artifact: { ...artifact, kind: 'audio_overview', trustTier: 'tier2' },
      version,
      latestJob: null,
      accessRole: 'viewer',
    });
    expect(audioResource.allowedActions).toEqual([
      'view',
      'download',
      'annotate',
    ]);

    const imageResource = projectOwnedArtifactResource({
      notebookId,
      artifact: { ...artifact, kind: 'generated_image', trustTier: 'tier2' },
      version,
      latestJob: null,
      accessRole: 'viewer',
    });
    expect(imageResource.allowedActions).toEqual([
      'view',
      'download',
      'annotate',
    ]);
  });

  it('grants download but not delete for media artifacts with contributor role', () => {
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact: { ...artifact, kind: 'audio_overview', trustTier: 'tier2' },
      version,
      latestJob: null,
      accessRole: 'contributor',
    });
    expect(resource.allowedActions).toEqual(['view', 'download', 'annotate']);
  });

  it('restricts media actions to view-only when archived', () => {
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact: {
        ...artifact,
        kind: 'audio_overview',
        trustTier: 'tier2',
        status: 'archived',
      },
      version,
      latestJob: null,
      accessRole: 'owner',
    });
    expect(resource.allowedActions).toEqual(['view']);
    expect(resource.status).toBe('archived');
  });

  it('失败终态带版本时不投影为 ready', () => {
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact: { ...artifact, latestVersion: 1 },
      version: {
        ...version,
        createdAt: '2026-07-25T00:01:00.000Z',
      },
      latestJob: {
        ...runningJob,
        status: 'failed',
        failureCode: 'timeout',
      },
      accessRole: 'owner',
    });

    expect(resource.status).toBe('failed');
    expect(resource.version).toMatchObject({
      versionId: version.id,
      sequence: version.version,
    });
  });

  it('cancelled 终态不投影 ready', () => {
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact: { ...artifact, latestVersion: 1 },
      version,
      latestJob: {
        ...runningJob,
        status: 'cancelled',
        failureCode: 'client_cancelled',
      },
      accessRole: 'owner',
    });

    expect(resource.status).toBe('failed');
    expect(resource.allowedActions).toEqual([]);
  });

  it('不能从未知 job 状态猜测 ready', () => {
    const resource = projectOwnedArtifactResource({
      notebookId,
      artifact: { ...artifact, latestVersion: 1 },
      version,
      latestJob: {
        ...runningJob,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status: 'outcome_unknown' as any,
      },
      accessRole: 'owner',
    });

    expect(resource.status).toBe('unavailable');
  });

  it('可恢复对账结果直接进入失败/不可用，不吞并投影', () => {
    expect(
      projectOwnedArtifactResource({
        notebookId,
        artifact: { ...artifact, latestVersion: 1 },
        version,
        latestJob: {
          ...runningJob,
          status: 'failed' as never,
          failureCode: 'artifact_version_checkpoint_missing',
        },
        accessRole: 'owner',
      }).status,
    ).toBe('failed');
    expect(
      projectOwnedArtifactResource({
        notebookId,
        artifact: { ...artifact, latestVersion: 0 },
        version: null,
        latestJob: {
          ...runningJob,
          status: 'outcome_unknown' as never,
        },
        accessRole: 'owner',
      }).status,
    ).toBe('unavailable');
  });
});
