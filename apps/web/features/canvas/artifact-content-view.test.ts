import { describe, expect, it } from 'vitest';
import type {
  ArtifactDetail,
  ArtifactMedia,
  AudioOverviewMedia,
  GeneratedImageMedia,
} from './artifact-client';
import { resolveArtifactContentView } from './artifact-content-view';
import { makeArtifactResource } from './canvas-resource-fixtures';

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
    canvasResource: makeArtifactResource('mind_map'),
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

/**
 * W04 characterization：ArtifactCanvas 内容分发契约。
 * 固定「每种 Artifact kind + version 数据 → 渲染什么」，迁移 Registry 时以此为基准。
 */
describe('resolveArtifactContentView（Artifact 内容分发契约）', () => {
  it('mind_map + version → mind_map，携带 content 与版本 key', () => {
    const view = resolveArtifactContentView(
      withVersion(makeDetail('mind_map'), { nodes: [] }),
      false,
    );
    expect(view).toEqual({ kind: 'mind_map', content: { nodes: [] }, key: 1 });
  });

  it('slides + version → slides', () => {
    const view = resolveArtifactContentView(
      withVersion(makeDetail('slides'), { slides: [] }),
      false,
    );
    expect(view).toEqual({ kind: 'slides', content: { slides: [] }, key: 1 });
  });

  it('flashcards + version → flashcards', () => {
    const view = resolveArtifactContentView(
      withVersion(makeDetail('flashcards'), { cards: [] }),
      false,
    );
    expect(view).toEqual({
      kind: 'flashcards',
      content: { cards: [] },
      key: 1,
    });
  });

  it('note + version → note，携带 isLatest', () => {
    const view = resolveArtifactContentView(
      withVersion(makeDetail('note'), '# 笔记'),
      false,
    );
    expect(view).toEqual({
      kind: 'note',
      content: '# 笔记',
      key: 1,
      isLatest: true,
    });
  });

  it('audio_overview + audio/mpeg media → audio_overview', () => {
    const detail = withVersion(makeDetail('audio_overview'), null);
    const view = resolveArtifactContentView(
      { ...detail, version: { ...detail.version!, media: audioMedia } },
      false,
    );
    expect(view).toMatchObject({ kind: 'audio_overview' });
  });

  it('audio_overview + 非 audio/mpeg media → empty（原条件不满足）', () => {
    const detail = withVersion(makeDetail('audio_overview'), null);
    const view = resolveArtifactContentView(
      {
        ...detail,
        version: {
          ...detail.version!,
          media: { ...imageMedia, contentType: 'image/png' },
        },
      },
      false,
    );
    expect(view).toEqual({ kind: 'empty' });
  });

  it('generated_image + 含 size 的 image media → generated_image', () => {
    const detail = withVersion(makeDetail('generated_image'), null);
    const view = resolveArtifactContentView(
      { ...detail, version: { ...detail.version!, media: imageMedia } },
      false,
    );
    expect(view).toMatchObject({ kind: 'generated_image', title: '测试产物' });
  });

  it('generated_image + 无 size 的 media → empty', () => {
    const detail = withVersion(makeDetail('generated_image'), null);
    const view = resolveArtifactContentView(
      {
        ...detail,
        version: {
          ...detail.version!,
          media: {
            ...audioMedia,
            contentType: 'image/png',
          } as unknown as ArtifactMedia,
        },
      },
      false,
    );
    expect(view).toEqual({ kind: 'empty' });
  });

  it('dom_exploration + version → dom_exploration，携带 versionId', () => {
    const view = resolveArtifactContentView(
      withVersion(makeDetail('dom_exploration'), null),
      false,
    );
    expect(view).toEqual({ kind: 'dom_exploration', versionId: 'v1' });
  });

  it('生成中且最新版无内容 → skeleton（而非空态）', () => {
    // 生成中的新产物尚无任何版本：latestVersion=0，version=null，isLatest 才成立。
    const detail: ArtifactDetail = {
      ...makeDetail('mind_map'),
      artifact: { ...makeDetail('mind_map').artifact, latestVersion: 0 },
      latestJob: {
        id: 'job-1',
        status: 'running',
        progress: 0,
        failureCode: null,
      },
    };
    const view = resolveArtifactContentView(detail, false);
    expect(view).toEqual({ kind: 'skeleton' });
  });

  it('未知 kind + version → empty', () => {
    const view = resolveArtifactContentView(
      withVersion(makeDetail('unknown_type'), { x: 1 }),
      false,
    );
    expect(view).toEqual({ kind: 'empty' });
  });

  it('无 version 且非生成中 → empty', () => {
    const view = resolveArtifactContentView(makeDetail('mind_map'), false);
    expect(view).toEqual({ kind: 'empty' });
  });
});
