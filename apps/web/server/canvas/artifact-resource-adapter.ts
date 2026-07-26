import 'server-only';

import {
  canvasResourceSchema,
  type CanvasRepresentationKind,
  type CanvasResource,
  type CanvasResourceAction,
  type CanvasResourceErrorCode,
  type CanvasTrustTier,
} from '@educanvas/canvas-protocol';
import type {
  PlatformArtifact,
  PlatformArtifactJob,
  PlatformArtifactVersion,
} from '@educanvas/db';
import type { NotebookMembershipRole } from '@educanvas/gateway-core';

const ARTIFACT_RENDERERS = {
  mind_map: {
    representation: 'structured',
    mimeType: 'application/vnd.educanvas.mind-map+json',
    rendererId: 'artifact.mind-map',
    trustTier: 'tier1',
  },
  slides: {
    representation: 'structured',
    mimeType: 'application/vnd.educanvas.slides+json',
    rendererId: 'artifact.slides',
    trustTier: 'tier1',
  },
  flashcards: {
    representation: 'structured',
    mimeType: 'application/vnd.educanvas.flashcards+json',
    rendererId: 'artifact.flashcards',
    trustTier: 'tier1',
  },
  note: {
    representation: 'structured',
    mimeType: 'application/vnd.educanvas.note+json',
    rendererId: 'artifact.note',
    trustTier: 'tier1',
  },
  audio_overview: {
    representation: 'audio',
    mimeType: 'audio/mpeg',
    rendererId: 'artifact.audio-overview',
    trustTier: 'tier2',
  },
} as const satisfies Record<
  string,
  {
    representation: CanvasRepresentationKind;
    mimeType: string;
    rendererId: string;
    trustTier: CanvasTrustTier;
  }
>;

export class ArtifactResourceProjectionError extends Error {
  constructor(
    readonly code: CanvasResourceErrorCode,
    readonly status: 422 | 503,
  ) {
    super(code);
    this.name = 'ArtifactResourceProjectionError';
  }
}

function projectStatus(
  artifact: PlatformArtifact,
  version: PlatformArtifactVersion | null,
  job: PlatformArtifactJob | null,
): CanvasResource['status'] {
  if (artifact.latestVersion === 0 && version !== null) {
    throw new ArtifactResourceProjectionError('resource_invalid', 422);
  }
  if (artifact.latestVersion > 0 && version === null) {
    throw new ArtifactResourceProjectionError('resource_invalid', 422);
  }
  if (artifact.status === 'archived') return 'archived';
  if (job?.status === 'queued' || job?.status === 'running') {
    return 'processing';
  }
  if (version) return 'ready';
  if (job?.status === 'failed' || job?.status === 'cancelled') return 'failed';
  return 'unavailable';
}

function projectActions(
  kind: keyof typeof ARTIFACT_RENDERERS,
  status: CanvasResource['status'],
  hasVersion: boolean,
  accessRole: NotebookMembershipRole,
): CanvasResourceAction[] {
  if (!hasVersion) return [];
  if (status === 'processing' || status === 'archived') return ['view'];
  if (status !== 'ready') return [];
  if (accessRole === 'viewer') return ['view'];
  if (kind === 'note') return ['view', 'edit', 'regenerate'];
  if (kind === 'audio_overview') return ['view'];
  return ['view', 'regenerate'];
}

/**
 * 将已授权Artifact、不可变版本和任务状态投影为统一资源。
 * 私有版本内容、metadata、objectKey、任务参数与异常均不参与投影。
 */
export function projectOwnedArtifactResource(input: {
  notebookId: string;
  artifact: PlatformArtifact;
  version: PlatformArtifactVersion | null;
  latestJob: PlatformArtifactJob | null;
  accessRole: NotebookMembershipRole;
}): CanvasResource {
  if (input.artifact.spaceId !== input.notebookId) {
    throw new ArtifactResourceProjectionError('resource_not_found', 422);
  }
  const kind = input.artifact.kind as keyof typeof ARTIFACT_RENDERERS;
  const renderer = ARTIFACT_RENDERERS[kind];
  if (!renderer) {
    throw new ArtifactResourceProjectionError('renderer_not_found', 422);
  }
  if (input.artifact.trustTier !== renderer.trustTier) {
    throw new ArtifactResourceProjectionError('resource_invalid', 422);
  }

  const status = projectStatus(input.artifact, input.version, input.latestJob);
  const parsed = canvasResourceSchema.safeParse({
    schemaVersion: 1,
    resourceId: input.artifact.id,
    notebookId: input.notebookId,
    resourceKind: 'artifact',
    title: input.artifact.title,
    status,
    version: input.version
      ? {
          versionId: input.version.id,
          sequence: input.version.version,
          // 现有Artifact详情契约不公开内部校验和。
          checksum: null,
        }
      : null,
    representation: {
      kind: renderer.representation,
      mimeType: renderer.mimeType,
      byteSize: null,
    },
    renderer: {
      rendererId: renderer.rendererId,
      rendererVersion: 1,
    },
    trustTier: renderer.trustTier,
    allowedActions: projectActions(
      kind,
      status,
      input.version !== null,
      input.accessRole,
    ),
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin:
        input.version?.generatedBy === 'user:manual'
          ? 'user_created'
          : 'agent_generated',
      createdBy:
        input.version?.generatedBy === 'user:manual' ? 'user' : 'agent',
      createdAt: input.version?.createdAt ?? input.artifact.createdAt,
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
  });
  if (!parsed.success) {
    throw new ArtifactResourceProjectionError('resource_invalid', 422);
  }
  return parsed.data;
}
