import { describe, expect, it } from 'vitest';
import type { ArtifactDetail } from './artifact-client';
import {
  ARTIFACT_KIND_RENDERER_ID,
  buildArtifactCanvasResource,
} from './artifact-canvas-resource';
import { selectWebCanvasResourceRenderer } from './web-canvas-resource-registry';

function makeDetail(
  kind: string,
  overrides: Partial<ArtifactDetail> = {},
): ArtifactDetail {
  return {
    artifact: {
      id: 'art-1',
      kind,
      trustTier: 'tier1',
      title: '测试产物',
      status: 'active',
      latestVersion: 1,
      fromConversation: true,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    },
    version: null,
    versions: [],
    latestJob: null,
    canvasResource: { allowedActions: ['view'] },
    ...overrides,
  };
}

function withVersion(detail: ArtifactDetail, content: unknown, version = 1) {
  return {
    ...detail,
    version: { id: 'v1', version, content, media: null },
  };
}

/**
 * W04-3：Artifact 详情 → 渲染用 CanvasResource 的纯函数契约。
 * detail.canvasResource 缺 rendererId 等协议字段，由浏览器端按 kind 补齐
 * （方案 A）。这里钉住映射与构造结果，并验证构造出的资源能被 Registry 选中。
 */
describe('buildArtifactCanvasResource（W04-3 渲染用资源构造）', () => {
  it('kind→rendererId 映射覆盖 5 类内容驱动产物，不含交互式 kind', () => {
    expect(ARTIFACT_KIND_RENDERER_ID).toMatchObject({
      mind_map: 'artifact.mind-map',
      slides: 'artifact.slides',
      flashcards: 'artifact.flashcards',
      audio_overview: 'artifact.audio-overview',
      generated_image: 'artifact.generated-image',
    });
    expect(ARTIFACT_KIND_RENDERER_ID.note).toBeUndefined();
    expect(ARTIFACT_KIND_RENDERER_ID.dom_exploration).toBeUndefined();
  });

  it('mind_map + version → ready、structured、trustTier/动作透传', () => {
    const resource = buildArtifactCanvasResource(
      withVersion(makeDetail('mind_map'), { nodes: [] }),
    );
    expect(resource.resourceKind).toBe('artifact');
    expect(resource.renderer.rendererId).toBe('artifact.mind-map');
    expect(resource.renderer.rendererVersion).toBe(1);
    expect(resource.status).toBe('ready');
    expect(resource.representation).toEqual({
      kind: 'structured',
      mimeType: 'application/json',
      byteSize: null,
    });
    expect(resource.trustTier).toBe('tier1');
    expect(resource.runtime).toEqual({ kind: 'none' });
    expect(resource.allowedActions).toEqual(['view']);
    expect(resource.version).toEqual({
      versionId: 'v1',
      sequence: 1,
      checksum: null,
    });
    expect(resource.canProduceCandidateLearningEvents).toBe(false);
  });

  it('generated_image → image、mimeType image/png、trustTier 透传', () => {
    const base = makeDetail('generated_image');
    const resource = buildArtifactCanvasResource({
      ...withVersion(base, null),
      artifact: { ...base.artifact, trustTier: 'tier2' },
    });
    expect(resource.renderer.rendererId).toBe('artifact.generated-image');
    expect(resource.representation).toEqual({
      kind: 'image',
      mimeType: 'image/png',
      byteSize: null,
    });
    expect(resource.trustTier).toBe('tier2');
  });

  it('audio_overview → audio、mimeType audio/mpeg', () => {
    const resource = buildArtifactCanvasResource(
      withVersion(makeDetail('audio_overview'), null),
    );
    expect(resource.renderer.rendererId).toBe('artifact.audio-overview');
    expect(resource.representation).toEqual({
      kind: 'audio',
      mimeType: 'audio/mpeg',
      byteSize: null,
    });
  });

  it('无版本 → processing、version null（而非 ready 缺 version）', () => {
    const resource = buildArtifactCanvasResource(makeDetail('mind_map'));
    expect(resource.status).toBe('processing');
    expect(resource.version).toBeNull();
  });

  it('未知 kind → 抛错（调用方只对已知内容驱动 kind 调用）', () => {
    expect(() =>
      buildArtifactCanvasResource(makeDetail('unknown_type')),
    ).toThrow(/Unsupported artifact kind/);
  });

  it('交互式 kind（note/dom_exploration）→ 抛错（不进 Registry，由壳渲染）', () => {
    expect(() => buildArtifactCanvasResource(makeDetail('note'))).toThrow(
      /Unsupported artifact kind/,
    );
    expect(() =>
      buildArtifactCanvasResource(makeDetail('dom_exploration')),
    ).toThrow(/Unsupported artifact kind/);
  });

  it('5 类内容驱动产物构造出的资源都能被 Web Registry 选中', () => {
    for (const [kind, trustTier] of [
      ['mind_map', 'tier1'],
      ['slides', 'tier1'],
      ['flashcards', 'tier1'],
      ['audio_overview', 'tier2'],
      ['generated_image', 'tier2'],
    ] as const) {
      const base = makeDetail(kind);
      const detail = {
        ...withVersion(base, null),
        artifact: { ...base.artifact, trustTier },
      };
      const selection = selectWebCanvasResourceRenderer(
        buildArtifactCanvasResource(detail),
      );
      expect(selection.kind, `${kind} 应 available`).toBe('available');
    }
  });
});
