import { renderToStaticMarkup } from 'react-dom/server';
import { makeArtifactResource } from './canvas-resource-fixtures';
import { describe, expect, it } from 'vitest';
import type {
  ArtifactDetail,
  AudioOverviewMedia,
  GeneratedImageMedia,
} from './artifact-client';
import {
  ArtifactCanvasContent,
  toArtifactVersionData,
} from './artifact-canvas-content';
import { resolveArtifactContentView } from './artifact-content-view';

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
    canvasResource:
      kind === 'audio_overview'
        ? makeArtifactResource('audio_overview')
        : kind === 'generated_image'
          ? makeArtifactResource('generated_image')
          : kind === 'slides'
            ? makeArtifactResource('slides')
            : kind === 'flashcards'
              ? makeArtifactResource('flashcards')
              : makeArtifactResource('mind_map'),
    ...overrides,
  };
}

function withVersion(detail: ArtifactDetail, content: unknown, version = 1) {
  return {
    ...detail,
    version: { id: 'v1', version, content, media: null },
  };
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

function render(
  view: ReturnType<typeof resolveArtifactContentView>,
  detail: ArtifactDetail,
) {
  return renderToStaticMarkup(
    <ArtifactCanvasContent
      contentView={view}
      detail={detail}
      revising={false}
      onSaveNote={() => {}}
    />,
  );
}

/**
 * W04-3：内容区组合层桥接。
 * 内容驱动型产物经 Registry 分发到真实 Renderer；交互式产物（note/dom）与
 * 骨架/空态仍由壳渲染。断言真实渲染结果而非 Registry 内部结构。
 */
describe('toArtifactVersionData（Registry 受控内容转换）', () => {
  it('mind_map → content + media null', () => {
    const detail = withVersion(makeDetail('mind_map'), mindMapContent);
    const view = resolveArtifactContentView(detail, false);
    if (view.kind !== 'mind_map') throw new Error('unexpected view');
    expect(toArtifactVersionData(view)).toEqual({
      content: mindMapContent,
      media: null,
    });
  });

  it('audio_overview → content null + media', () => {
    const detail = withVersion(makeDetail('audio_overview'), null);
    const view = resolveArtifactContentView(
      { ...detail, version: { ...detail.version!, media: audioMedia } },
      false,
    );
    if (view.kind !== 'audio_overview') throw new Error('unexpected view');
    expect(toArtifactVersionData(view)).toEqual({
      content: null,
      media: audioMedia,
    });
  });
});

describe('ArtifactCanvasContent（W04-3 内容区分发）', () => {
  it('mind_map → Registry 渲染真实 MindMap（data-mind-map）', () => {
    const detail = withVersion(makeDetail('mind_map'), mindMapContent);
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('data-mind-map');
    expect(html).toContain('根节点');
  });

  it('slides → Registry 渲染真实 Slides（data-slides）', () => {
    const detail = withVersion(makeDetail('slides'), {
      contentVersion: 1,
      slides: [{ id: 's1', title: '第一页', bullets: ['内容'] }],
    });
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('data-slides');
  });

  it('flashcards → Registry 渲染真实 Flashcards（data-flashcards）', () => {
    const detail = withVersion(makeDetail('flashcards'), {
      contentVersion: 1,
      cards: [{ id: 'c1', front: '正面', back: '背面' }],
    });
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('data-flashcards');
  });

  it('audio_overview（tier2 + audio/mpeg media）→ <audio>', () => {
    const base = makeDetail('audio_overview');
    const detail: ArtifactDetail = {
      ...base,
      artifact: { ...base.artifact, trustTier: 'tier2' },
      version: { id: 'v1', version: 1, content: null, media: audioMedia },
    };
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('<audio');
  });

  it('generated_image（tier2 + image media）→ <img>', () => {
    const base = makeDetail('generated_image');
    const detail: ArtifactDetail = {
      ...base,
      artifact: { ...base.artifact, trustTier: 'tier2' },
      version: { id: 'v1', version: 1, content: null, media: imageMedia },
    };
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('<img');
  });

  it('audio_overview（服务端 resource tier1，renderer 仅接受 tier2）→ unavailable 兜底', () => {
    // 服务端投影是 trustTier 权威：fixture 直接构造 tier1 的 resource
    // （浏览器不再按 artifact.kind 重建 trustTier）。
    const base = makeDetail('audio_overview', {
      canvasResource: makeArtifactResource('audio_overview', {
        trustTier: 'tier1',
      }),
    });
    const detail: ArtifactDetail = {
      ...base,
      version: { id: 'v1', version: 1, content: null, media: audioMedia },
    };
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('内容不可用');
    expect(html).not.toContain('<audio');
  });

  it('note → 壳内 NoteRenderer（prose），不落到 Registry 占位', () => {
    const detail = withVersion(makeDetail('note'), '# 笔记');
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('prose');
    expect(html).not.toContain('需要交互式 Canvas 壳');
  });

  it('生成中无版本 → 骨架（role=status 正在生成产物）', () => {
    const base = makeDetail('mind_map');
    const detail = {
      ...base,
      artifact: { ...base.artifact, latestVersion: 0 },
      latestJob: {
        id: 'job-1',
        status: 'running' as const,
        progress: 0,
        failureCode: null,
      },
    };
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('正在生成产物');
  });

  it('无版本且非生成中 → 空态文案', () => {
    const detail = makeDetail('mind_map');
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('该产物还没有可显示的版本');
  });
});
