import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AssetPreview } from './asset-preview-contract';
import {
  PdfReadingSwitcher,
  resolvePdfReadingAvailability,
} from './pdf-reading-switcher';

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockPdfPreview({ fileUrl }: { fileUrl: string }) {
      return createElement('div', { 'data-pdf-url': fileUrl }, 'PDF preview');
    },
}));

vi.mock('@/features/chat/markdown', () => ({
  MessageMarkdown: ({ text }: { text: string }) =>
    createElement('div', { 'data-markdown': text }, text),
}));

const FILE_URL =
  '/api/v1/chat/assets/11111111-1111-4111-8111-111111111111/file';

function pdfPreview(
  overrides: Partial<Extract<AssetPreview, { kind: 'pdf' }>> = {},
): Extract<AssetPreview, { kind: 'pdf' }> {
  return {
    kind: 'pdf',
    fileName: 'lesson.pdf',
    mimeType: 'application/pdf',
    fileUrl: FILE_URL,
    ...overrides,
  };
}

function render(
  preview: Extract<AssetPreview, { kind: 'pdf' }>,
  initialView?: 'original' | 'structured',
) {
  return renderToStaticMarkup(
    createElement(PdfReadingSwitcher, { preview, initialView }),
  );
}

describe('resolvePdfReadingAvailability', () => {
  it('structured 可读且非降级', () => {
    expect(
      resolvePdfReadingAvailability({
        quality: 'structured',
        markdown: '# x',
        producer: 'mineru',
        producerVersion: '3.4.4',
      }),
    ).toEqual({
      readable: true,
      markdown: '# x',
      degraded: false,
      producerLabel: 'MinerU',
      producerVersion: '3.4.4',
    });
  });

  it('degraded_plain_text 可读但标记为降级（provenance 区分，不冒充 structured）', () => {
    expect(
      resolvePdfReadingAvailability({
        quality: 'degraded_plain_text',
        markdown: 'plain',
        producer: 'default',
      }),
    ).toEqual({
      readable: true,
      markdown: 'plain',
      degraded: true,
      producerLabel: '内置文本提取',
      producerVersion: null,
    });
  });

  it('processing/failed/unavailable 或无 markdown 均不可读', () => {
    for (const quality of ['processing', 'failed', 'unavailable'] as const) {
      expect(
        resolvePdfReadingAvailability({ quality, markdown: '# x' }),
      ).toMatchObject({ readable: false });
    }
    expect(
      resolvePdfReadingAvailability({ quality: 'structured' }),
    ).toMatchObject({ readable: false });
    expect(resolvePdfReadingAvailability(null)).toMatchObject({
      readable: false,
      degraded: false,
    });
  });
});

describe('PdfReadingSwitcher', () => {
  it('默认渲染原件 PDF（pdf.js），structured 时提供切换入口', () => {
    const html = render(
      pdfPreview({
        representation: {
          quality: 'structured',
          markdown: '# 正文',
          producer: 'mineru',
          producerVersion: '3.4.4',
        },
      }),
    );
    expect(html).toContain(`data-pdf-url="${FILE_URL}"`);
    expect(html).toContain('原件预览');
    expect(html).toContain('结构化阅读');
    /* 默认视图不渲染派生 Markdown。 */
    expect(html).not.toContain('data-markdown');
  });

  it('degraded 时切换标签为"纯文本降级"而非"结构化阅读"', () => {
    const html = render(
      pdfPreview({
        representation: {
          quality: 'degraded_plain_text',
          markdown: 'plain text',
          producer: 'default',
        },
      }),
    );
    expect(html).toContain('纯文本降级');
    expect(html).not.toContain('结构化阅读');
  });

  it('无文本表示（旧资产）只渲染原件，不出现切换入口', () => {
    const html = render(pdfPreview({ representation: null }));
    expect(html).toContain(`data-pdf-url="${FILE_URL}"`);
    expect(html).not.toContain('阅读视图切换');
  });

  it('processing 时原件视图显示处理中提示且不可切换', () => {
    const html = render(
      pdfPreview({ representation: { quality: 'processing' } }),
    );
    expect(html).toContain('文档转换处理中');
    expect(html).not.toContain('阅读视图切换');
  });

  it('failed 时原件视图显示失败提示且不可切换', () => {
    const html = render(pdfPreview({ representation: { quality: 'failed' } }));
    expect(html).toContain('结构化转换失败');
    expect(html).not.toContain('阅读视图切换');
  });

  it('派生内容完整性失败时诚实显示 unavailable', () => {
    const html = render(
      pdfPreview({ representation: { quality: 'unavailable' } }),
    );

    expect(html).toContain('结构化内容暂不可用');
    expect(html).not.toContain('阅读视图切换');
  });

  it('结构化视图标注 quality + producer 并渲染派生 Markdown', () => {
    const html = render(
      pdfPreview({
        representation: {
          quality: 'structured',
          markdown: '# 正文内容',
          producer: 'mineru',
          producerVersion: '3.4.4',
        },
      }),
      'structured',
    );
    expect(html).toContain('结构化阅读 · MinerU 3.4.4 · 派生表示');
    expect(html).toContain('data-markdown="# 正文内容"');
    /* 结构化视图下原件 PDF 不再渲染。 */
    expect(html).not.toContain('data-pdf-url');
  });

  it('降级视图标注 provenance（纯文本降级）而不冒充结构化', () => {
    const html = render(
      pdfPreview({
        representation: {
          quality: 'degraded_plain_text',
          markdown: '降级文本',
          producer: 'default',
        },
      }),
      'structured',
    );
    expect(html).toContain('纯文本降级 · 内置文本提取 · 派生表示');
    expect(html).toContain('data-markdown="降级文本"');
    expect(html).not.toContain('结构化阅读 ·');
  });
});
