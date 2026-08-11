import { describe, expect, it } from 'vitest';
import { detectAssetFile } from './asset-file-detection';

describe('detectAssetFile', () => {
  it('uses magic bytes for PDF and images', () => {
    expect(
      detectAssetFile(
        new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
        'wrong.txt',
      ),
    ).toMatchObject({ mimeType: 'application/pdf' });
    expect(
      detectAssetFile(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image.bin',
      ),
    ).toMatchObject({ mimeType: 'image/png' });
  });

  it('allows only explicit Markdown and text extensions as text', () => {
    const bytes = new TextEncoder().encode('# 光合作用');
    expect(detectAssetFile(bytes, 'lesson.MARKDOWN')).toEqual({
      kind: 'document',
      mimeType: 'text/markdown',
      extension: 'md',
    });
    expect(detectAssetFile(bytes, 'lesson.txt')).toEqual({
      kind: 'document',
      mimeType: 'text/plain',
      extension: 'txt',
    });
    expect(detectAssetFile(bytes, 'lesson.docx')).toBeNull();
  });

  it('recognizes only a Word OOXML ZIP as DOCX', () => {
    const docxDirectory = new TextEncoder().encode(
      'PK\u0003\u0004[Content_Types].xml word/document.xml',
    );
    expect(detectAssetFile(docxDirectory, 'lesson.bin')).toEqual({
      kind: 'document',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml',
      extension: 'docx',
    });
    expect(
      detectAssetFile(
        new TextEncoder().encode('PK\u0003\u0004archive/readme.txt'),
        'fake.docx',
      ),
    ).toBeNull();
  });

  it('recognizes PPTX and XLSX by their OOXML main document', () => {
    const pptxDirectory = new TextEncoder().encode(
      'PK\u0003\u0004[Content_Types].xml ppt/presentation.xml',
    );
    expect(detectAssetFile(pptxDirectory, 'slides.bin')).toEqual({
      kind: 'document',
      mimeType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      extension: 'pptx',
    });
    const xlsxDirectory = new TextEncoder().encode(
      'PK\u0003\u0004[Content_Types].xml xl/workbook.xml',
    );
    expect(detectAssetFile(xlsxDirectory, 'sheet.bin')).toEqual({
      kind: 'document',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
    });
  });

  it('does not mistake one OOXML family for another', () => {
    const pptxDirectory = new TextEncoder().encode(
      'PK\u0003\u0004[Content_Types].xml ppt/presentation.xml',
    );
    expect(detectAssetFile(pptxDirectory, 'slides.pptx')).not.toEqual(
      expect.objectContaining({ extension: 'docx' }),
    );
    expect(detectAssetFile(pptxDirectory, 'slides.pptx')).not.toEqual(
      expect.objectContaining({ extension: 'xlsx' }),
    );
    /* 普通 ZIP 不会因为改后缀进 PPTX/XLSX。 */
    expect(
      detectAssetFile(
        new TextEncoder().encode('PK\u0003\u0004archive/readme.txt'),
        'fake.pptx',
      ),
    ).toBeNull();
    expect(
      detectAssetFile(
        new TextEncoder().encode('PK\u0003\u0004archive/readme.txt'),
        'fake.xlsx',
      ),
    ).toBeNull();
  });

  it.each([
    [[0x49, 0x44, 0x33], 'audio/mpeg'],
    [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 'audio/wav'],
    [[0x4f, 0x67, 0x67, 0x53], 'audio/ogg'],
    [[0x66, 0x4c, 0x61, 0x43], 'audio/flac'],
    [[0x1a, 0x45, 0xdf, 0xa3], 'audio/webm'],
    [
      [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20],
      'audio/x-m4a',
    ],
  ] as const)('recognizes audio magic bytes for %s', (bytes, mimeType) => {
    expect(detectAssetFile(new Uint8Array(bytes), 'renamed.bin')).toMatchObject(
      {
        kind: 'audio',
        mimeType,
      },
    );
  });

  it('does not trust an audio filename extension', () => {
    expect(
      detectAssetFile(
        new TextEncoder().encode('not an audio container'),
        'renamed.mp3',
      ),
    ).toBeNull();
  });

  it.each([
    [
      [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d],
      'video/mp4',
    ],
    [
      [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20],
      'video/quicktime',
    ],
  ] as const)('recognizes video magic bytes for %s', (bytes, mimeType) => {
    /* MP4/MOV 与 M4A 共用 ftyp，只有主 brand 能区分；视频判定必须先于音频，
       否则一段视频会被误收进音频转录路径。 */
    expect(detectAssetFile(new Uint8Array(bytes), 'renamed.bin')).toMatchObject(
      { kind: 'video', mimeType },
    );
  });

  it('does not claim an ISO container without a known brand', () => {
    expect(
      detectAssetFile(
        new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]),
        'renamed.mp4',
      ),
    ).toBeNull();
  });
});
