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
});
