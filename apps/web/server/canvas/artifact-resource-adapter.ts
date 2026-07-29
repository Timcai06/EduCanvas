import 'server-only';

import {
  audioOverviewMetadataSchema,
  canvasResourceSchema,
  generatedImageMetadataSchema,
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

function projectMediaGenerator(
  kind: string,
  metadata: unknown,
): CanvasResource['provenance']['generator'] {
  if (kind === 'audio_overview') {
    const parsed = audioOverviewMetadataSchema.safeParse(metadata);
    if (!parsed.success) return null;
    return {
      provider: parsed.data.speech.provider,
      model: parsed.data.speech.resolvedModelId,
      promptSummary: null,
    };
  }
  if (kind === 'generated_image') {
    const parsed = generatedImageMetadataSchema.safeParse(metadata);
    if (!parsed.success) return null;
    return {
      provider: parsed.data.image.provider,
      model: parsed.data.image.resolvedModelId,
      promptSummary: null,
    };
  }
  return null;
}

function projectSourceResourceIds(
  kind: string,
  version: PlatformArtifactVersion | null,
  job: PlatformArtifactJob | null,
): string[] {
  if (
    kind !== 'audio_overview' ||
    !version?.generationJobId ||
    version.generationJobId !== job?.id
  ) {
    return [];
  }
  const selectedSources = job.params.selectedSources;
  if (!Array.isArray(selectedSources)) return [];
  return [
    ...new Set(
      selectedSources.flatMap((reference) =>
        typeof reference === 'object' &&
        reference !== null &&
        'assetId' in reference &&
        typeof reference.assetId === 'string'
          ? [reference.assetId]
          : [],
      ),
    ),
  ];
}

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
  /* 生成位图不是判分型白名单内容，因此固定 tier2；MIME 只作为渲染声明，
     实际字节的格式由读取面按落库 metadata 回答，浏览器不参与判断。 */
  generated_image: {
    representation: 'image',
    mimeType: 'image/png',
    rendererId: 'artifact.generated-image',
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
  /* 音频与图像的重新生成会重新计费且不复用基线版本，PATCH 修改通道也不接受
     这两类；不开放 regenerate 才与实际后端能力一致。 */
  if (kind === 'audio_overview' || kind === 'generated_image') return ['view'];
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
      sourceResourceIds: projectSourceResourceIds(
        kind,
        input.version,
        input.latestJob,
      ),
      operationId: input.version?.createdByOperationId ?? null,
      generator: projectMediaGenerator(kind, input.version?.metadata),
    },
    runtime: { kind: 'none' },
  });
  if (!parsed.success) {
    throw new ArtifactResourceProjectionError('resource_invalid', 422);
  }
  return parsed.data;
}
