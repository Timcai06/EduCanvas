import { describe, expect, it } from 'vitest';
import { detectAssetFile } from './asset-file-detection';

describe('detectAssetFile (DP10 桌面上传 magic bytes)', () => {
  it('recognizes PNG by magic bytes', () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    expect(detectAssetFile(png)).toEqual({
      kind: 'image',
      mimeType: 'image/png',
      extension: 'png',
    });
  });

  it('recognizes JPEG by magic bytes', () => {
    expect(detectAssetFile(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      kind: 'image',
      mimeType: 'image/jpeg',
      extension: 'jpg',
    });
  });

  it('recognizes WebP by RIFF/WEBP container magic', () => {
    const webp = new Uint8Array([
      ...new TextEncoder().encode('RIFF'),
      0,
      0,
      0,
      0,
      ...new TextEncoder().encode('WEBP'),
    ]);
    expect(detectAssetFile(webp)).toEqual({
      kind: 'image',
      mimeType: 'image/webp',
      extension: 'webp',
    });
  });

  it('recognizes PDF by %PDF- magic', () => {
    expect(detectAssetFile(new TextEncoder().encode('%PDF-1.7'))).toEqual({
      kind: 'document',
      mimeType: 'application/pdf',
      extension: 'pdf',
    });
  });

  it('rejects empty, truncated and unrelated payloads', () => {
    expect(detectAssetFile(new Uint8Array(0))).toBeNull();
    expect(detectAssetFile(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(detectAssetFile(new TextEncoder().encode('PK'))).toBeNull();
    expect(detectAssetFile(new TextEncoder().encode('plain text'))).toBeNull();
  });
});
