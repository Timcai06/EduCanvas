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
});
