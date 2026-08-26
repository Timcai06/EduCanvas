import { canvasResourceSchema } from '@educanvas/canvas-protocol';

/**
 * 测试专用：按 artifact.kind 构造合法服务端 CanvasResource（经 canonical schema
 * 验证）。渲染路径测试用 renderer.rendererId 驱动 Registry，与真实服务端投影
 * 数据流一致（R06/#306 后服务端是唯一权威）。
 */
export function makeArtifactResource(
  kind:
    | 'mind_map'
    | 'slides'
    | 'flashcards'
    | 'markdown_document'
    | 'audio_overview'
    | 'generated_image'
    | 'picturebook',
  overrides: Partial<Parameters<typeof canvasResourceSchema.parse>[0]> = {},
) {
  const rendererByKind = {
    mind_map: { rendererId: 'artifact.mind-map', rendererVersion: 1 },
    slides: { rendererId: 'artifact.slides', rendererVersion: 1 },
    flashcards: { rendererId: 'artifact.flashcards', rendererVersion: 1 },
    markdown_document: {
      rendererId: 'artifact.markdown-document',
      rendererVersion: 1,
    },
    audio_overview: {
      rendererId: 'artifact.audio-overview',
      rendererVersion: 1,
    },
    generated_image: {
      rendererId: 'artifact.generated-image',
      rendererVersion: 1,
    },
    picturebook: {
      rendererId: 'artifact.picturebook',
      rendererVersion: 1,
    },
  } as const;
  const mimeByKind = {
    mind_map: 'application/vnd.educanvas.mind-map+json',
    slides: 'application/vnd.educanvas.slides+json',
    flashcards: 'application/vnd.educanvas.flashcards+json',
    markdown_document: 'application/vnd.educanvas.markdown+text',
    audio_overview: 'audio/mpeg',
    generated_image: 'image/png',
    picturebook: 'application/vnd.educanvas.picturebook+json',
  } as const;
  return canvasResourceSchema.parse({
    schemaVersion: 1,
    resourceId: `art-${kind}`,
    notebookId: 'nb-1',
    resourceKind: 'artifact',
    title: '测试产物',
    status: 'ready',
    version: { versionId: 'v1', sequence: 1, checksum: null },
    representation: {
      kind:
        kind === 'audio_overview'
          ? 'audio'
          : kind === 'generated_image'
            ? 'image'
            : 'structured',
      mimeType: mimeByKind[kind],
      byteSize: null,
    },
    renderer: rendererByKind[kind],
    trustTier:
      kind === 'audio_overview' ||
      kind === 'generated_image' ||
      kind === 'picturebook'
        ? 'tier2'
        : 'tier1',
    allowedActions: ['view'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'agent_generated',
      createdBy: 'agent',
      createdAt: '2026-08-01T00:00:00+08:00',
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
    ...overrides,
  });
}
