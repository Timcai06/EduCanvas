import { describe, expect, it } from 'vitest';
import {
  AssetThumbnailError,
  generateThumbnail,
  supportsThumbnailGeneration,
} from './thumbnail-generation';

describe('generateThumbnail', () => {
  it('不支持的 MIME 明确拒绝', async () => {
    await expect(
      generateThumbnail({
        bytes: new Uint8Array([0, 0, 0, 0]),
        mimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'unsupported_media_type' });
  });

  it('损坏的图片报 image_processing_failed', async () => {
    await expect(
      generateThumbnail({
        bytes: new Uint8Array([0, 0, 0, 0]),
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'image_processing_failed' });
  });
});

describe('supportsThumbnailGeneration', () => {
  it('PNG 支持缩略图生成', () => {
    expect(supportsThumbnailGeneration('image/png')).toBe(true);
  });

  it('JPEG 支持缩略图生成', () => {
    expect(supportsThumbnailGeneration('image/jpeg')).toBe(true);
  });

  it('WebP 支持缩略图生成', () => {
    expect(supportsThumbnailGeneration('image/webp')).toBe(true);
  });

  it('GIF 支持缩略图生成', () => {
    expect(supportsThumbnailGeneration('image/gif')).toBe(true);
  });

  it('PDF 不支持缩略图生成', () => {
    expect(supportsThumbnailGeneration('application/pdf')).toBe(false);
  });

  it('纯文本不支持缩略图生成', () => {
    expect(supportsThumbnailGeneration('text/plain')).toBe(false);
  });
});
