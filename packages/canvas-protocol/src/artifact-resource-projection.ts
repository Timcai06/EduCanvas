import { audioOverviewMetadataSchema } from './artifacts/audio-overview';
import { generatedImageMetadataSchema } from './artifacts/generated-image';
import {
  canvasResourceSchema,
  type CanvasRepresentationKind,
  type CanvasResource,
  type CanvasResourceAction,
  type CanvasTrustTier,
} from './resource';
import type { CanvasResourceErrorCode } from './resource-errors';

type CanvasAccessRole = 'owner' | 'editor' | 'contributor' | 'viewer';

export interface ArtifactProjectionArtifact {
  readonly id: string;
  readonly spaceId: string;
  readonly conversationId: string | null;
  readonly ownerSubjectId: string;
  readonly kind: string;
  readonly trustTier: string;
  readonly title: string;
  readonly status: 'proposed' | 'active' | 'archived';
  readonly latestVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ArtifactProjectionVersion {
  readonly id: string;
  readonly artifactId: string;
  readonly version: number;
  readonly content: unknown;
  readonly generatedBy: string | null;
  readonly createdByOperationId: string | null;
  readonly generationJobId: string | null;
  readonly metadata: unknown;
  readonly objectKey: string | null;
  readonly checksum: string | null;
  readonly createdAt: string;
}

export interface ArtifactProjectionJob {
  readonly id: string;
  readonly artifactId: string;
  readonly operationId: string | null;
  readonly status: string;
  readonly progress: number | null;
  readonly failureCode: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly checkpoint: Readonly<Record<string, unknown>>;
  readonly queueJobKey: string | null;
}

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

function projectSourceReferences(
  version: ArtifactProjectionVersion | null,
  latestJob: ArtifactProjectionJob | null,
  versionJob: ArtifactProjectionJob | null,
): { resourceId: string; versionId: string }[] {
  const sourceJob =
    versionJob &&
    version?.generationJobId &&
    versionJob.id === version.generationJobId
      ? versionJob
      : latestJob;
  if (!version?.generationJobId || sourceJob?.id !== version.generationJobId) {
    return [];
  }
  const provenance = sourceJob.params.provenance;
  const explicitSources =
    typeof provenance === 'object' &&
    provenance !== null &&
    'sources' in provenance &&
    Array.isArray(provenance.sources)
      ? provenance.sources
      : null;
  /* audio_overview 是早于统一 Artifact Tool provenance 的兼容形状。 */
  const selectedSources = explicitSources ?? sourceJob.params.selectedSources;
  if (!Array.isArray(selectedSources)) return [];
  return [
    ...new Set(
      selectedSources.flatMap((reference) =>
        typeof reference === 'object' &&
        reference !== null &&
        'assetId' in reference &&
        typeof reference.assetId === 'string' &&
        'versionId' in reference &&
        typeof reference.versionId === 'string'
          ? [`${reference.assetId}\u0000${reference.versionId}`]
          : [],
      ),
    ),
  ].map((reference) => {
    const [resourceId, versionId] = reference.split('\u0000');
    return { resourceId: resourceId!, versionId: versionId! };
  });
}

// 各 Artifact 类型的协议声明：rendererId 与 W04 浏览器端注册表
// （web-canvas-resource-registry-config.ts）一一对应；rendererVersion 是
// 渲染器协议版本（v1），与 artifact 数据版本无关——服务端与浏览器端同批
// 升级时才递增（#306 契约收口，2026-08-07）。
const ARTIFACT_RENDERERS = {
  mind_map: {
    representation: 'structured',
    mimeType: 'application/vnd.educanvas.mind-map+json',
    rendererId: 'artifact.mind-map',
    rendererVersion: 1,
    trustTier: 'tier1',
  },
  slides: {
    representation: 'structured',
    mimeType: 'application/vnd.educanvas.slides+json',
    rendererId: 'artifact.slides',
    rendererVersion: 1,
    trustTier: 'tier1',
  },
  flashcards: {
    representation: 'structured',
    mimeType: 'application/vnd.educanvas.flashcards+json',
    rendererId: 'artifact.flashcards',
    rendererVersion: 1,
    trustTier: 'tier1',
  },
  note: {
    representation: 'structured',
    mimeType: 'application/vnd.educanvas.note+json',
    rendererId: 'artifact.note',
    rendererVersion: 1,
    trustTier: 'tier1',
  },
  audio_overview: {
    representation: 'audio',
    mimeType: 'audio/mpeg',
    rendererId: 'artifact.audio-overview',
    rendererVersion: 1,
    trustTier: 'tier2',
  },
  /* 生成位图不是判分型白名单内容，因此固定 tier2；MIME 只作为渲染声明，
     实际字节的格式由读取面按落库 metadata 回答，浏览器不参与判断。 */
  generated_image: {
    representation: 'image',
    mimeType: 'image/png',
    rendererId: 'artifact.generated-image',
    rendererVersion: 1,
    trustTier: 'tier2',
  },
  markdown_document: {
    representation: 'structured',
    mimeType: 'application/vnd.educanvas.markdown+text',
    rendererId: 'artifact.markdown-document',
    rendererVersion: 1,
    trustTier: 'tier1',
  },
  web_app: {
    representation: 'interactive_app',
    mimeType: 'application/vnd.educanvas.web-app+json',
    rendererId: 'artifact.web-app',
    rendererVersion: 1,
    trustTier: 'tier2',
  },
  dom_exploration: {
    representation: 'interactive_app',
    mimeType: 'application/vnd.educanvas.dom-exploration+json',
    rendererId: 'artifact.dom-exploration',
    rendererVersion: 1,
    trustTier: 'tier2',
  },
} as const satisfies Record<
  string,
  {
    representation: CanvasRepresentationKind;
    mimeType: string;
    rendererId: string;
    rendererVersion: number;
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
  artifact: ArtifactProjectionArtifact,
  version: ArtifactProjectionVersion | null,
  job: ArtifactProjectionJob | null,
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
  if (
    job &&
    !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(
      job.status as string,
    )
  ) {
    return 'unavailable';
  }
  /* A failed/cancelled revision does not invalidate an already committed
     immutable version. The revision outcome remains a job fact; the Artifact
     resource stays openable and authorized from its last usable version. */
  if (job?.status === 'failed' || job?.status === 'cancelled') {
    return version ? 'ready' : 'failed';
  }
  if (version) return 'ready';
  return 'unavailable';
}

function projectActions(
  kind: keyof typeof ARTIFACT_RENDERERS,
  status: CanvasResource['status'],
  hasVersion: boolean,
  accessRole: CanvasAccessRole,
): CanvasResourceAction[] {
  if (!hasVersion) return [];
  if (status === 'processing' || status === 'archived') return ['view'];
  if (status !== 'ready') return [];
  if (accessRole === 'viewer' || accessRole === 'contributor') {
    /* 只读角色可查看和下载媒体产物，但不可删除。 */
    if (kind === 'audio_overview' || kind === 'generated_image')
      return ['view', 'download', 'annotate'];
    if (kind === 'markdown_document') return ['view', 'download'];
    return kind === 'dom_exploration' || kind === 'web_app'
      ? ['view', 'run', 'cancel', 'annotate']
      : ['view', 'annotate'];
  }
  if (kind === 'markdown_document')
    return ['view', 'edit', 'regenerate', 'download', 'delete'];
  if (kind === 'dom_exploration')
    return ['view', 'run', 'cancel', 'delete', 'annotate'];
  if (kind === 'web_app')
    return [
      'view',
      'run',
      'cancel',
      'regenerate',
      'download',
      'delete',
      'annotate',
    ];
  if (kind === 'note')
    return ['view', 'edit', 'regenerate', 'delete', 'annotate'];
  /* 音频与图像的重新生成会重新计费且不复用基线版本，PATCH 修改通道也不接受
     这两类；不开放 regenerate 才与实际后端能力一致。
     删除与下载是受控服务端授权动作，由对应 route 再次校验身份和权限。 */
  if (kind === 'audio_overview' || kind === 'generated_image')
    return ['view', 'download', 'delete', 'annotate'];
  return ['view', 'regenerate', 'delete', 'annotate'];
}

/**
 * 将已授权Artifact、不可变版本和任务状态投影为统一资源。
 * 私有版本内容、metadata、objectKey、任务参数与异常均不参与投影。
 */
export function projectOwnedArtifactResource(input: {
  notebookId: string;
  artifact: ArtifactProjectionArtifact;
  version: ArtifactProjectionVersion | null;
  latestJob: ArtifactProjectionJob | null;
  versionJob?: ArtifactProjectionJob | null;
  accessRole: CanvasAccessRole;
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
  const sourceReferences = projectSourceReferences(
    input.version,
    input.latestJob,
    input.versionJob ?? null,
  );
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
      rendererVersion: renderer.rendererVersion,
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
      sourceResourceIds: [
        ...new Set(sourceReferences.map((source) => source.resourceId)),
      ],
      sourceReferences,
      operationId: input.version?.createdByOperationId ?? null,
      generator: projectMediaGenerator(kind, input.version?.metadata),
    },
    runtime:
      kind === 'dom_exploration' || kind === 'web_app'
        ? {
            kind: 'web_sandbox',
            protocolVersion: 1,
            maxDurationMs: 30_000,
            maxOutputBytes: 1024 * 1024,
            network: 'none',
          }
        : { kind: 'none' },
  });
  if (!parsed.success) {
    throw new ArtifactResourceProjectionError('resource_invalid', 422);
  }
  return parsed.data;
}
