import { describe, expect, it } from 'vitest';
import {
  ASSET_PREVIEW_MAX_CHARACTERS,
  AssetPreviewError,
  renderAssetPreview,
  supportsPreviewRendering,
} from './preview-rendering';

const utf8 = (value: string) => new TextEncoder().encode(value);

describe('renderAssetPreview', () => {
  it('不支持的 MIME 明确拒绝', async () => {
    await expect(
      renderAssetPreview({ bytes: utf8('x'), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'unsupported_media_type' });
  });

  it('损坏的 PDF 报 pdf_preview_unavailable', async () => {
    await expect(
      renderAssetPreview({
        bytes: utf8('%PDF-1.4 这不是真的 PDF'),
        mimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'pdf_preview_unavailable' });
  });

  it('损坏的 DOCX 报 docx_preview_unavailable', async () => {
    await expect(
      renderAssetPreview({
        bytes: utf8('这不是 DOCX'),
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml',
      }),
    ).rejects.toMatchObject({ code: 'docx_preview_unavailable' });
  });
});

describe('supportsPreviewRendering', () => {
  it('PDF 支持预览渲染', () => {
    expect(supportsPreviewRendering('application/pdf')).toBe(true);
  });

  it('DOCX 支持预览渲染', () => {
    expect(
      supportsPreviewRendering(
        'application/vnd.openxmlformats-officedocument.wordprocessingml',
      ),
    ).toBe(true);
  });

  it('图片不支持预览渲染', () => {
    expect(supportsPreviewRendering('image/png')).toBe(false);
  });

  it('纯文本不支持预览渲染', () => {
    expect(supportsPreviewRendering('text/plain')).toBe(false);
  });
});
