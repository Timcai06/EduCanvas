import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import {
  AudioOverviewResourceRenderer,
  FlashcardsResourceRenderer,
  GeneratedImageResourceRenderer,
  MindMapResourceRenderer,
  SlidesResourceRenderer,
} from './canvas-resource-renderers';
import type {
  ArtifactVersionData,
  AudioOverviewMedia,
  GeneratedImageMedia,
} from './artifact-client';

function makeResource(rendererId: string): CanvasResource {
  return {
    schemaVersion: 1,
    resourceId: 'aaaa0000-0000-4000-8000-000000000001',
    notebookId: 'bbbb0000-0000-4000-8000-000000000001',
    resourceKind: 'artifact',
    title: '测试产物',
    status: 'ready',
    version: {
      versionId: 'cccc0000-0000-4000-8000-000000000001',
      sequence: 1,
      checksum: 'a'.repeat(64),
    },
    representation: {
      kind: 'structured',
      mimeType: 'application/json',
      byteSize: null,
    },
    renderer: { rendererId, rendererVersion: 1 },
    trustTier: 'tier1',
    allowedActions: ['view'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'upload',
      createdBy: 'user',
      createdAt: '2026-07-27T00:00:00+08:00',
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
  };
}

function versionData(
  content: unknown,
  media: ArtifactVersionData['media'] = null,
) {
  return { content, media };
}

const audioMedia: AudioOverviewMedia = {
  url: 'https://cdn.test/audio.mp3',
  contentVersion: 1,
  contentType: 'audio/mpeg',
  byteSize: 1024,
  transcript: '',
  sourceCount: 1,
  script: {
    generator: 'g',
    provider: 'p',
    resolvedModelId: 'm',
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
  },
  speech: {
    provider: 'p',
    resolvedModelId: 'm',
    voice: 'v',
    inputCharacters: 1,
    latencyMs: 1,
  },
};

const imageMedia: GeneratedImageMedia = {
  url: 'https://cdn.test/img.png',
  contentVersion: 1,
  contentType: 'image/png',
  byteSize: 2048,
  size: '512x512',
  image: { provider: 'p', resolvedModelId: 'm', latencyMs: 1 },
};

const mindMapContent = {
  contentVersion: 1,
  root: { id: 'root', label: '根节点' },
};

const slidesContent = {
  contentVersion: 1,
  slides: [{ id: 's1', title: '第一页', bullets: ['内容'] }],
};

const flashcardsContent = {
  contentVersion: 1,
  cards: [{ id: 'c1', front: '正面', back: '背面' }],
};

/**
 * W04：Registry 内容适配器契约测试。
 * 验证 5 类内容驱动 Artifact 的适配器把受控 content/media 分发给真实 Renderer，
 * 缺数据或媒体子类型不匹配时明确 unavailable，不伪造内容。
 */
describe('Canvas Artifact 内容适配器（W04 选项 1）', () => {
  it('mind_map：合法 content → 渲染 data-mind-map + 根节点文本', () => {
    const html = renderToStaticMarkup(
      <MindMapResourceRenderer
        resource={makeResource('artifact.mind-map')}
        content={versionData(mindMapContent)}
      />,
    );
    expect(html).toContain('data-mind-map');
    expect(html).toContain('根节点');
  });

  it('mind_map：缺 content → unavailable（不伪造内容）', () => {
    const html = renderToStaticMarkup(
      <MindMapResourceRenderer resource={makeResource('artifact.mind-map')} />,
    );
    expect(html).toContain('内容不可用');
    expect(html).not.toContain('data-mind-map');
  });

  it('slides：合法 content → 渲染 data-slides', () => {
    const html = renderToStaticMarkup(
      <SlidesResourceRenderer
        resource={makeResource('artifact.slides')}
        content={versionData(slidesContent)}
      />,
    );
    expect(html).toContain('data-slides');
  });

  it('flashcards：合法 content → 渲染 data-flashcards', () => {
    const html = renderToStaticMarkup(
      <FlashcardsResourceRenderer
        resource={makeResource('artifact.flashcards')}
        content={versionData(flashcardsContent)}
      />,
    );
    expect(html).toContain('data-flashcards');
  });

  it('audio_overview：audio/mpeg media → 渲染 <audio>', () => {
    const html = renderToStaticMarkup(
      <AudioOverviewResourceRenderer
        resource={makeResource('artifact.audio-overview')}
        content={versionData(null, audioMedia)}
      />,
    );
    expect(html).toContain('<audio');
  });

  it('audio_overview：非 audio/mpeg media → unavailable', () => {
    const html = renderToStaticMarkup(
      <AudioOverviewResourceRenderer
        resource={makeResource('artifact.audio-overview')}
        content={versionData(null, imageMedia)}
      />,
    );
    expect(html).toContain('音频不可用');
  });

  it('generated_image：含 size 的 image media → 渲染 <img>', () => {
    const html = renderToStaticMarkup(
      <GeneratedImageResourceRenderer
        resource={makeResource('artifact.generated-image')}
        content={versionData(null, imageMedia)}
      />,
    );
    expect(html).toContain('<img');
  });

  it('generated_image：无 size 的 media → unavailable', () => {
    const html = renderToStaticMarkup(
      <GeneratedImageResourceRenderer
        resource={makeResource('artifact.generated-image')}
        content={versionData(null, audioMedia)}
      />,
    );
    expect(html).toContain('图片不可用');
  });

});
