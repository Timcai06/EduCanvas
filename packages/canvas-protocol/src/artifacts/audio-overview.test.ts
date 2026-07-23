import { describe, expect, it } from 'vitest';
import { audioOverviewMetadataSchema } from './audio-overview';

const valid = {
  contentVersion: 1,
  contentType: 'audio/mpeg',
  byteSize: 4,
  transcript: '这是一段来源驱动的音频概览。',
  sourceCount: 1,
  script: {
    generator: 'rule:audio-overview-script-v1',
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
    inputCharacters: 15,
    latencyMs: 10,
  },
} as const;

describe('audioOverviewMetadataSchema', () => {
  it('接受浏览器安全的音频元数据', () => {
    expect(audioOverviewMetadataSchema.parse(valid)).toEqual(valid);
  });

  it('拒绝对象存储 key/checksum 混入公开元数据', () => {
    expect(
      audioOverviewMetadataSchema.safeParse({ ...valid, objectKey: 'secret' })
        .success,
    ).toBe(false);
  });
});
