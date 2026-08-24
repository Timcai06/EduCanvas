import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ResourceClientError } from '../canvas/resource-error';
import {
  AssetUploadPanel,
  DOCUMENT_UPLOAD_ACCEPT,
  uploadErrorText,
} from './asset-upload-panel';

describe('文档上传文件选择契约', () => {
  it.each(['.pdf', '.docx', '.pptx', '.xlsx', '.md', '.markdown', '.txt'])(
    '允许 ADR-0026 文档格式 %s',
    (extension) => {
      expect(`,${DOCUMENT_UPLOAD_ACCEPT},`).toContain(`,${extension},`);
    },
  );

  it('使用浏览器标准 OOXML MIME，服务端内部 MIME 归一化不泄漏到选择器', () => {
    expect(DOCUMENT_UPLOAD_ACCEPT).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(DOCUMENT_UPLOAD_ACCEPT).toContain(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(DOCUMENT_UPLOAD_ACCEPT).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });
});

describe('AssetUploadPanel', () => {
  it('以紧凑入口展示图片格式和明确操作', () => {
    const html = renderToStaticMarkup(
      <AssetUploadPanel kind="image" fixedScope="space" onUploaded={vi.fn()} />,
    );

    expect(html).toContain('PNG、JPEG 或 WebP，最大 25 MB');
    expect(html).toContain('选择图片');
    expect(html).toContain('aria-label="选择要上传的图片"');
    expect(html).not.toContain('添加图片');
    expect(html).not.toContain('对象存储地址');
  });

  it('以紧凑入口展示文档格式，不重复笔记本归属说明', () => {
    const html = renderToStaticMarkup(
      <AssetUploadPanel
        kind="document"
        fixedScope="space"
        onUploaded={vi.fn()}
      />,
    );

    expect(html).toContain(
      'PDF、Word、PowerPoint、Excel、Markdown 或 TXT，最大 25 MB',
    );
    expect(html).toContain('选择文件');
    expect(html).not.toContain('切换笔记本不会带走');
    expect(html).not.toContain('保存范围');
  });

  it('保留非固定场景的保存范围选择', () => {
    const html = renderToStaticMarkup(
      <AssetUploadPanel kind="document" onUploaded={vi.fn()} />,
    );

    expect(html).toContain('保存范围');
    expect(html).toContain('仅用于本轮');
    expect(html).toContain('保存到空间');
  });
});

describe('uploadErrorText（上传错误文案边界）', () => {
  it('项目稳定错误保留文案与语义', () => {
    const error = new ResourceClientError(
      'offline',
      '网络连接不可用，请检查网络后重试。',
    );
    expect(uploadErrorText(error)).toBe('网络连接不可用，请检查网络后重试。');
  });

  it('浏览器原生错误（如 SecurityError: illegal path）不直接透传', () => {
    const native = new Error('SecurityError: illegal path');
    expect(uploadErrorText(native)).toBe('文件上传失败，请重试。');
  });

  it('非 Error 原因（null/字符串）统一为通用文案', () => {
    expect(uploadErrorText(null)).toBe('文件上传失败，请重试。');
    expect(uploadErrorText('boom')).toBe('文件上传失败，请重试。');
  });
});
