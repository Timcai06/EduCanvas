import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeArtifactResource } from './canvas-resource-fixtures';
import { describe, expect, it } from 'vitest';
import type {
  ArtifactDetail,
  AudioOverviewMedia,
  GeneratedImageMedia,
} from './artifact-client';
import type { WebAppContent } from '@educanvas/canvas-protocol';
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
              : kind === 'markdown_document'
                ? makeArtifactResource('markdown_document')
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

function makeWebAppContent(
  overrides: Partial<WebAppContent> = {},
): WebAppContent {
  return {
    schemaVersion: 1,
    manifest: {
      entry: 'index.html',
      files: [
        {
          path: 'index.html',
          mediaType: 'text/html',
          content: '<!doctype html><html><body>ok</body></html>',
          hash: 'b'.repeat(64),
        },
        {
          path: 'main.js',
          mediaType: 'text/javascript',
          content: 'console.log("hello")',
          hash: 'c'.repeat(64),
        },
      ],
    },
    lockedDependencies: [],
    capabilities: ['javascript-runtime', 'dom-manipulation'],
    budget: {
      maxInputBytes: 1024,
      maxMessageBytes: 512,
      maxOutputBytes: 1024,
      maxDurationMs: 12000,
      maxConcurrentInstances: 1,
      maxQueueDepth: 1,
      maxMessagesPerSecond: 10,
    },
    diagnostics: [{ code: 'build_succeeded' }],
    generatedByModel: true,
    ...overrides,
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
  readOnly = false,
  presentation: 'canvas' | 'live-preview' = 'canvas',
) {
  return renderToStaticMarkup(
    <ArtifactCanvasContent
      contentView={view}
      detail={detail}
      revising={false}
      readOnly={readOnly}
      onSaveNote={() => {}}
      presentation={presentation}
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

  it('web_app → Canvas 模式渲染持久 Web Runtime 壳', () => {
    const detail = withVersion(makeDetail('web_app'), makeWebAppContent());
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('data-testid="persistent-web-runtime"');
    expect(html).toContain('预览');
    expect(html).toContain('正在启动隔离运行环境');
  });

  it('web_app → live-preview 不启动持久运行时', () => {
    const detail = withVersion(makeDetail('web_app'), makeWebAppContent());
    const html = render(
      resolveArtifactContentView(detail, false),
      detail,
      false,
      'live-preview',
    );
    expect(html).toContain('交互网页需在 Canvas 打开');
    expect(html).not.toContain('data-runtime-state');
  });

  it('web_app 源码面板仅显示文本源码，不执行 raw HTML', () => {
    const detail = withVersion(makeDetail('web_app'), makeWebAppContent());
    const html = render(
      resolveArtifactContentView(
        {
          ...detail,
          version: {
            ...detail.version!,
            content: makeWebAppContent({
              manifest: {
                entry: 'index.html',
                files: [
                  {
                    path: 'index.html',
                    mediaType: 'text/html',
                    content: '<script>alert(1)</script>',
                    hash: 'd'.repeat(64),
                  },
                ],
              },
            }),
          },
        },
        false,
      ),
      detail,
    );
    expect(html).toContain('源码');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('web_app 构建面板展示诊断与预算信息', () => {
    const detail = withVersion(makeDetail('web_app'), makeWebAppContent());
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('构建');
    expect(html).toContain('build_succeeded');
    expect(html).toContain('输入预算');
    expect(html).toContain('无锁定依赖');
  });

  it('web_app parse 失败→不可用提示（fail-closed）', () => {
    const view = resolveArtifactContentView(
      withVersion(makeDetail('web_app'), { invalid: 'content' }),
      false,
    );
    const html = render(view, makeDetail('web_app'));
    expect(html).toContain('Web App 内容不可用');
  });

  it('web_app 不可信 schema（未知媒体类型）→ fail-closed 不启动运行时', () => {
    const view = resolveArtifactContentView(
      withVersion(
        makeDetail('web_app'),
        {
          schemaVersion: 1,
          manifest: {
            entry: 'index.html',
            files: [
              {
                path: 'index.html',
                mediaType: 'application/x-binary',
                content: 'bad',
                hash: 'f'.repeat(64),
              },
            ],
          },
          lockedDependencies: [],
          capabilities: ['javascript-runtime'],
          budget: {
            maxInputBytes: 1_000,
            maxMessageBytes: 512,
            maxOutputBytes: 1_000,
            maxDurationMs: 5_000,
            maxConcurrentInstances: 1,
            maxQueueDepth: 1,
            maxMessagesPerSecond: 10,
          },
          diagnostics: [{ code: 'build_failed' }],
        },
        1,
      ),
      false,
    );
    const html = render(view, makeDetail('web_app'));
    expect(html).toContain('Web App 内容不可用');
    expect(html).not.toContain('data-testid="persistent-web-runtime"');
  });

  it('note → 壳内 NoteRenderer（prose），不落到 Registry 占位', () => {
    const detail = withVersion(makeDetail('note'), '# 笔记');
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('prose');
    expect(html).not.toContain('需要交互式 Canvas 壳');
  });

  it('markdown_document → Registry 渲染只读 NoteRenderer（无编辑交互）', () => {
    const detail = withVersion(makeDetail('markdown_document'), {
      contentVersion: 1,
      generatedByModel: false,
      markdown: '# 课程文档',
    });
    const html = render(resolveArtifactContentView(detail, false), detail);
    expect(html).toContain('prose');
    expect(html).toContain('课程文档');
  });

  it('Live 等内嵌宿主可强制最新版 note 只读', () => {
    const detail = withVersion(makeDetail('note'), '# 只读笔记');
    const html = render(
      resolveArtifactContentView(detail, false),
      detail,
      true,
    );
    expect(html).toContain('只读');
    expect(html).not.toContain('>编辑<');
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
