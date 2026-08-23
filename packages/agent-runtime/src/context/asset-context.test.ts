// Colocated with the context materialization boundary it verifies.
import { describe, expect, it } from 'vitest';
import {
  UnsupportedAgentInputModalityError,
  buildAssetContext,
} from './asset-context';

const document = {
  reference: {
    assetId: 'asset-1',
    versionId: 'version-1',
    kind: 'document' as const,
  },
  displayName: '研究资料.pdf',
  mimeType: 'application/pdf',
  byteSize: 100,
  extractedText: '可信引用的正文',
  transcriptionText: null,
  textRepresentation: {
    kind: 'text' as const,
    quality: 'structured' as const,
    variant: 'default',
    producer: 'mineru',
    producerVersion: 'mineru.v1',
  },
  derivedTextSource: null,
  derivedMarkdown: null,
};

describe('通用Asset输入物化', () => {
  it('为提取文本建立有边界和字符上限的上下文', () => {
    expect(
      buildAssetContext({
        assets: [document],
        capabilities: { nativeAssetKinds: [] },
        maxTextCharacters: 4,
      }),
    ).toEqual({
      text: expect.stringContaining('可信引用'),
      textSegments: [
        {
          reference: document.reference,
          representation: {
            kind: 'text',
            quality: 'structured',
            variant: 'default',
            producer: 'mineru',
            producerVersion: 'mineru.v1',
          },
          text: expect.stringContaining('可信引用'),
        },
      ],
      nativeReferences: [],
    });
  });

  it('不静默忽略当前Provider不支持的图片', () => {
    expect(() =>
      buildAssetContext({
        assets: [
          {
            ...document,
            reference: { ...document.reference, kind: 'image' },
            displayName: '照片.png',
            mimeType: 'image/png',
            extractedText: null,
            transcriptionText: null,
            textRepresentation: null,
            derivedTextSource: null,
            derivedMarkdown: null,
          },
        ],
        capabilities: { nativeAssetKinds: [] },
      }),
    ).toThrow(UnsupportedAgentInputModalityError);
  });

  it('为未来原生多模态Provider保留不可变引用', () => {
    const image = {
      ...document,
      reference: { ...document.reference, kind: 'image' as const },
      displayName: '照片.png',
      mimeType: 'image/png',
      extractedText: null,
      transcriptionText: null,
      textRepresentation: null,
      derivedTextSource: null,
      derivedMarkdown: null,
    };
    expect(
      buildAssetContext({
        assets: [image],
        capabilities: { nativeAssetKinds: ['image'] },
      }),
    ).toEqual({
      text: '',
      textSegments: [],
      nativeReferences: [image.reference],
    });
  });

  it('structured 时优先使用已核对 checksum 的派生 Markdown 而非镜像', () => {
    const structured = {
      ...document,
      extractedText: '镜像的纯文本正文',
      /* 物化层读入并核对 checksum 后的派生 Markdown（ADR-0026 第 5 节）。 */
      derivedMarkdown: '# 标题\n\n- 要点一\n- 要点二',
    };
    const { textSegments } = buildAssetContext({
      assets: [structured],
      capabilities: { nativeAssetKinds: [] },
    });
    expect(textSegments[0]?.text).toContain('# 标题');
    expect(textSegments[0]?.text).not.toContain('镜像的纯文本正文');
  });

  it('无派生 Markdown 时回退 extractedText（degraded/旧资产兼容）', () => {
    const degraded = {
      ...document,
      textRepresentation: {
        ...document.textRepresentation,
        quality: 'degraded_plain_text' as const,
        producer: 'textractor',
        producerVersion: 'textractor.v1',
      },
      derivedTextSource: null,
      derivedMarkdown: null,
    };
    expect(
      buildAssetContext({
        assets: [degraded],
        capabilities: { nativeAssetKinds: [] },
      }).text,
    ).toContain('可信引用的正文');
  });

  it('使用转录文本作为音频的可用文本来源', () => {
    const audio = {
      reference: {
        assetId: 'asset-2',
        versionId: 'version-2',
        kind: 'audio' as const,
      },
      displayName: '录音.mp3',
      mimeType: 'audio/mpeg',
      byteSize: 1000,
      extractedText: null,
      transcriptionText: '转录得到的文本内容',
      textRepresentation: null,
      derivedTextSource: null,
      derivedMarkdown: null,
    };
    expect(
      buildAssetContext({
        assets: [audio],
        capabilities: { nativeAssetKinds: [] },
      }),
    ).toEqual({
      text: expect.stringContaining('转录得到的文本内容'),
      textSegments: [
        {
          reference: audio.reference,
          representation: null,
          text: expect.stringContaining('转录得到的文本内容'),
        },
      ],
      nativeReferences: [],
    });
  });
});
