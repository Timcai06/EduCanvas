import { describe, expect, it } from 'vitest';
import {
  ASSET_TEXT_MAX_CHARACTERS,
  AssetExtractionError,
  extractAssetText,
  supportsTextExtraction,
} from './text-extraction';

const utf8 = (value: string) => new TextEncoder().encode(value);

describe('extractAssetText', () => {
  it('规范化换行与 NFC，并去掉 BOM', async () => {
    const text = await extractAssetText({
      bytes: utf8('\uFEFF第一行\r\n第二行\r第三行  '),
      mimeType: 'text/plain',
    });

    expect(text).toBe('第一行\n第二行\n第三行');
  });

  it('截断到字符上限而不是字节上限', async () => {
    /* 按码点截断：中文按字节切会把一个字劈成两半，产生乱码尾巴。 */
    const long = '字'.repeat(ASSET_TEXT_MAX_CHARACTERS + 500);

    const text = await extractAssetText({
      bytes: utf8(long),
      mimeType: 'text/markdown',
    });

    expect([...text]).toHaveLength(ASSET_TEXT_MAX_CHARACTERS);
  });

  it('非 UTF-8 字节报错而不是替换成 U+FFFD', async () => {
    /* 静默替换会让乱码被当成正文喂给模型。 */
    await expect(
      extractAssetText({
        bytes: new Uint8Array([0xff, 0xfe, 0x00]),
        mimeType: 'text/plain',
      }),
    ).rejects.toThrow(AssetExtractionError);
  });

  it('含控制字符的文本被拒绝', async () => {
    await expect(
      extractAssetText({
        bytes: utf8('正常\u0007文本'),
        mimeType: 'text/plain',
      }),
    ).rejects.toMatchObject({ code: 'text_content_unavailable' });
  });

  it('空白内容被当作抽取失败而不是空正文', async () => {
    await expect(
      extractAssetText({ bytes: utf8('   \n\n  '), mimeType: 'text/plain' }),
    ).rejects.toMatchObject({ code: 'text_content_unavailable' });
  });

  it('损坏的 PDF 报 pdf_text_unavailable 而不是通用失败', async () => {
    /* 与「文件损坏」区分开，用户提示才能给出有用的下一步（扫描件需要 OCR）。 */
    await expect(
      extractAssetText({
        bytes: utf8('%PDF-1.4 这不是真的 PDF'),
        mimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'pdf_text_unavailable' });
  });

  it('不支持的 MIME 明确拒绝，调用方不该把它排进队列', async () => {
    await expect(
      extractAssetText({ bytes: utf8('x'), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'unsupported_media_type' });
  });
});

describe('supportsTextExtraction', () => {
  it('覆盖当前四种可抽取类型', () => {
    expect(supportsTextExtraction('application/pdf')).toBe(true);
    expect(supportsTextExtraction('text/markdown')).toBe(true);
    expect(supportsTextExtraction('text/plain')).toBe(true);
    expect(
      supportsTextExtraction(
        'application/vnd.openxmlformats-officedocument.wordprocessingml',
      ),
    ).toBe(true);
  });

  it('图片不可抽取，避免为它建一个必然失败的任务', () => {
    expect(supportsTextExtraction('image/png')).toBe(false);
  });
});
