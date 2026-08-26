import type {
  CanvasRepresentationKind,
  CanvasResource,
  CanvasResourceAction,
  CanvasTrustTier,
} from './resource';

type CanvasAccessRole = 'owner' | 'editor' | 'contributor' | 'viewer';

/** 服务端 Artifact kind 与受信 Web Renderer 的唯一协议映射。 */
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
  generated_image: {
    representation: 'image',
    mimeType: 'image/png',
    rendererId: 'artifact.generated-image',
    rendererVersion: 1,
    trustTier: 'tier2',
  },
  picturebook: {
    representation: 'structured',
    mimeType: 'application/vnd.educanvas.picturebook+json',
    rendererId: 'artifact.picturebook',
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

export function artifactRendererFor(kind: string) {
  return ARTIFACT_RENDERERS[kind as keyof typeof ARTIFACT_RENDERERS] ?? null;
}

export function projectArtifactActions(
  kind: string,
  status: CanvasResource['status'],
  hasVersion: boolean,
  accessRole: CanvasAccessRole,
): CanvasResourceAction[] {
  if (!hasVersion) return [];
  if (status === 'processing' || status === 'archived') return ['view'];
  if (status !== 'ready') return [];
  if (accessRole === 'viewer' || accessRole === 'contributor') {
    if (kind === 'audio_overview' || kind === 'generated_image')
      return ['view', 'download', 'annotate'];
    if (kind === 'markdown_document') return ['view', 'download'];
    if (kind === 'picturebook') return ['view', 'annotate'];
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
  if (kind === 'audio_overview' || kind === 'generated_image')
    return ['view', 'download', 'delete', 'annotate'];
  if (kind === 'picturebook') return ['view', 'delete', 'annotate'];
  return ['view', 'regenerate', 'delete', 'annotate'];
}
