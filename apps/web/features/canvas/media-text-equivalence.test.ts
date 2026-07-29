import { describe, expect, it } from 'vitest';
import type {
  AudioOverviewMedia,
  GeneratedImageMedia,
} from './artifact-client';
import {
  AUDIO_SUMMARY_MAX_CHARS,
  buildAudioSummary,
  buildImageSummary,
  IMAGE_SUMMARY_MAX_CHARS,
} from './media-text-equivalence';

const audioMedia: AudioOverviewMedia = {
  url: '/audio',
  contentVersion: 1,
  contentType: 'audio/mpeg',
  byteSize: 10,
  transcript: '牛顿第二定律描述力、质量与加速度的关系。',
  sourceCount: 2,
  script: {
    generator: 'rule:test',
    provider: null,
    resolvedModelId: null,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
  },
  speech: {
    provider: 'fixture',
    resolvedModelId: 'speech-v1',
    voice: 'alloy',
    inputCharacters: 20,
    latencyMs: 10,
  },
};

const imageMedia: GeneratedImageMedia = {
  url: '/image',
  contentVersion: 1,
  contentType: 'image/png',
  byteSize: 10,
  size: '1024x1024',
  image: {
    provider: 'fixture',
    resolvedModelId: 'image-v1',
    latencyMs: 10,
  },
};

describe('媒体文本等价', () => {
  it('音频摘要包含标题、来源数量和有界文字稿', () => {
    expect(buildAudioSummary('力学复习', audioMedia)).toBe(
      '力学复习 · 基于 2 项来源 · 牛顿第二定律描述力、质量与加速度的关系。',
    );
    expect(
      buildAudioSummary('x'.repeat(400), {
        ...audioMedia,
        transcript: 'y'.repeat(400),
      }),
    ).toHaveLength(AUDIO_SUMMARY_MAX_CHARS);
  });

  it('图像摘要只使用标题和公开媒体元数据并保持有界', () => {
    expect(buildImageSummary('函数图像', imageMedia)).toBe(
      '函数图像 · 1024x1024 像素 · PNG',
    );
    expect(buildImageSummary('x'.repeat(400), imageMedia)).toHaveLength(
      IMAGE_SUMMARY_MAX_CHARS,
    );
  });
});
