import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AssetPreview } from './asset-preview-contract';
import { DocxReadingSwitcher } from './docx-reading-switcher';

vi.mock('@/features/chat/markdown', () => ({
  MessageMarkdown: ({ text }: { text: string }) =>
    createElement('div', { 'data-markdown': text }, text),
}));

vi.mock('./preview/docx-preview', () => ({
  DocxPreview: ({ html, warnings }: { html: string; warnings?: string[] }) =>
    createElement(
      'div',
      { 'data-docx-html': html, 'data-warnings': (warnings ?? []).length },
      'DOCX preview',
    ),
}));

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml';
const DOWNLOAD_URL =
  '/api/v1/chat/assets/11111111-1111-4111-8111-111111111111/file?download=1';

function docxPreview(
  overrides: Partial<Extract<AssetPreview, { kind: 'docx' }>> = {},
): Extract<AssetPreview, { kind: 'docx' }> {
  return {
    kind: 'docx',
    fileName: '讲义.docx',
    mimeType: DOCX_MIME,
    content: '<p>mammoth 原文</p>',
    downloadUrl: DOWNLOAD_URL,
    ...overrides,
  };
}

function render(
  preview: Extract<AssetPreview, { kind: 'docx' }>,
  initialView?: 'original' | 'structured',
) {
  return renderToStaticMarkup(
    createElement(DocxReadingSwitcher, { preview, initialView }),
  );
}

describe('DocxReadingSwitcher（ADR-0026 决定 6，与 PDF 同构）', () => {
  it('默认渲染原件预览（mammoth html），structured 时提供切换入口', () => {
    const html = render(
      docxPreview({
        representation: {
          quality: 'structured',
          markdown: '# 讲义正文',
          producer: 'mineru',
          producerVersion: '3.4.4',
        },
      }),
    );
    expect(html).toContain('data-docx-html="&lt;p&gt;mammoth 原文&lt;/p&gt;"');
    expect(html).toContain('原件预览');
    expect(html).toContain('结构化阅读');
    /* 默认视图不渲染派生 Markdown。 */
    expect(html).not.toContain('data-markdown');
  });

  it('structured 且服务端未跑 mammoth（content 为空）时原件视图不空白，提示下载', () => {
    const html = render(
      docxPreview({
        content: '',
        representation: {
          quality: 'structured',
          markdown: '# 讲义正文',
          producer: 'mineru',
          producerVersion: '3.4.4',
        },
      }),
    );
    expect(html).toContain('原件已保留，可下载查看');
    expect(html).toContain('下载原件（讲义.docx）');
    expect(html).toContain('结构化阅读');
    expect(html).not.toContain('暂不支持预览');
  });

  it('degraded 时切换标签为"纯文本降级"而非"结构化阅读"', () => {
    const html = render(
      docxPreview({
        /* degraded 时服务端仍投影降级文本（与 PDF 同构），切换入口可用。 */
        representation: {
          quality: 'degraded_plain_text',
          markdown: 'plain',
        },
      }),
    );
    expect(html).toContain('纯文本降级');
    expect(html).not.toContain('结构化阅读');
  });

  it('无文本表示（旧资产）只渲染原件，不出现切换入口', () => {
    const html = render(docxPreview({ representation: null }));
    expect(html).toContain('data-docx-html');
    expect(html).not.toContain('阅读视图切换');
  });

  it('processing 时原件视图显示处理中提示且不可切换', () => {
    const html = render(
      docxPreview({ representation: { quality: 'processing' } }),
    );
    expect(html).toContain('文档转换处理中');
    expect(html).not.toContain('阅读视图切换');
  });

  it('failed 时原件视图显示失败提示且不可切换', () => {
    const html = render(docxPreview({ representation: { quality: 'failed' } }));
    expect(html).toContain('结构化转换失败');
    expect(html).not.toContain('阅读视图切换');
  });

  it('结构化视图标注 quality + producer 并渲染派生 Markdown', () => {
    const html = render(
      docxPreview({
        representation: {
          quality: 'structured',
          markdown: '# 讲义正文',
          producer: 'mineru',
          producerVersion: '3.4.4',
        },
      }),
      'structured',
    );
    expect(html).toContain('结构化阅读 · MinerU 3.4.4 · 派生表示');
    expect(html).toContain('data-markdown="# 讲义正文"');
    /* 结构化视图下原件 mammoth 不再渲染。 */
    expect(html).not.toContain('data-docx-html');
  });

  it('降级视图标注 provenance（纯文本降级）而不冒充结构化', () => {
    const html = render(
      docxPreview({
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

  it('下载入口始终保留（决定 1：原件不因派生而消失）', () => {
    for (const quality of [
      'structured',
      'degraded_plain_text',
      'processing',
      'failed',
    ] as const) {
      const html = render(
        docxPreview({ representation: { quality, markdown: '# x' } }),
      );
      expect(html).toContain(DOWNLOAD_URL);
    }
    expect(render(docxPreview({ representation: null }))).toContain(
      DOWNLOAD_URL,
    );
  });
});
