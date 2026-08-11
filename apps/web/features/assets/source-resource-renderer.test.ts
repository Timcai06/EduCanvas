import type { CanvasResource } from '@educanvas/canvas-protocol';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AssetPreview } from './asset-preview-contract';

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockPdfPreview({ fileUrl }: { fileUrl: string }) {
      return createElement('div', { 'data-pdf-url': fileUrl }, 'PDF preview');
    },
}));

vi.mock('./preview/docx-preview', () => ({
  DocxPreview: ({ html }: { html: string }) =>
    createElement('div', { 'data-docx-html': html }, 'DOCX preview'),
}));

vi.mock('@/features/chat/markdown', () => ({
  MessageMarkdown: ({ text }: { text: string }) =>
    createElement('div', { 'data-markdown': text }, text),
}));

vi.mock('@/features/canvas/canvas-host', () => ({
  CanvasHost: ({
    ariaLabel,
    title,
    closeLabel,
    children,
  }: {
    ariaLabel: string;
    title: string;
    closeLabel: string;
    children: ReactNode;
  }) =>
    createElement(
      'section',
      {
        'aria-label': ariaLabel,
        'data-title': title,
        'data-close-label': closeLabel,
      },
      children,
    ),
}));

const { SourceResourceRenderer, SourceResourceRendererContent } =
  await import('./source-resource-renderer');

function makeResource(overrides: Partial<CanvasResource> = {}): CanvasResource {
  return {
    schemaVersion: 1,
    resourceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    notebookId: 'bbbb0000-0000-4000-8000-000000000001',
    resourceKind: 'source',
    title: '无障碍测试来源',
    status: 'ready',
    version: {
      versionId: 'cccc0000-0000-4000-8000-000000000001',
      sequence: null,
      checksum: 'a'.repeat(64),
    },
    representation: {
      kind: 'text',
      mimeType: 'text/plain',
      byteSize: 12,
    },
    renderer: { rendererId: 'source.text', rendererVersion: 1 },
    trustTier: 'tier1',
    allowedActions: ['view'],
    canProduceCandidateLearningEvents: false,
    provenance: {
      origin: 'upload',
      createdBy: 'user',
      createdAt: '2026-07-28T00:00:00.000Z',
      sourceResourceIds: [],
      operationId: null,
      generator: null,
    },
    runtime: { kind: 'none' },
    ...overrides,
  };
}

function render(
  input: {
    resource?: CanvasResource;
    preview?: AssetPreview | null;
    previewFailed?: boolean;
    onRetry?: () => void;
  } = {},
) {
  return renderToStaticMarkup(
    createElement(SourceResourceRendererContent, {
      resource: input.resource ?? makeResource(),
      preview: input.preview ?? null,
      previewFailed: input.previewFailed ?? false,
      onRetry: input.onRetry ?? vi.fn(),
    }),
  );
}

describe('SourceResourceRendererContent', () => {
  it('CanvasHost 渲染 registry 选出的本地 Renderer', () => {
    const resource = makeResource();
    const SelectedRenderer = ({
      resource: selectedResource,
    }: {
      resource: CanvasResource;
    }) =>
      createElement(
        'div',
        { 'data-selected-renderer': selectedResource.renderer.rendererId },
        selectedResource.title,
      );
    const html = renderToStaticMarkup(
      createElement(SourceResourceRenderer, {
        resource,
        Renderer: SelectedRenderer,
        isFull: false,
        onToggleFull: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(html).toContain('aria-label="来源预览"');
    expect(html).toContain('data-close-label="关闭来源预览"');
    expect(html).toContain('data-selected-renderer="source.text"');
  });

  it('loading 状态具有 aria-live 与 aria-busy', () => {
    const html = render();

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('正在加载来源内容');
  });

  it('failed 状态提供可聚焦的真实重试按钮', () => {
    const html = render({ previewFailed: true });

    expect(html).toContain('加载失败');
    expect(html).toContain('<button');
    expect(html).toContain('重试');
  });

  it('denied 与 unavailable 状态不提供误导性重试', () => {
    const denied = render({
      resource: makeResource({ allowedActions: [] }),
    });
    const unavailable = render({
      resource: makeResource({ status: 'unavailable' }),
    });

    expect(denied).toContain('无权访问');
    expect(denied).not.toContain('<button');
    expect(unavailable).toContain('来源不可用');
  });

  it('空文本进入 empty 状态', () => {
    const html = render({
      preview: {
        kind: 'text',
        fileName: 'empty.txt',
        mimeType: 'text/plain',
        content: '',
      },
    });

    expect(html).toContain('无内容');
    expect(html).toContain('这个来源没有可预览内容');
  });

  it('文本、Markdown 与 DOCX 输出真实内容', () => {
    const text = render({
      preview: {
        kind: 'text',
        fileName: 'sample.txt',
        mimeType: 'text/plain',
        content: '真实纯文本',
      },
    });
    const markdown = render({
      preview: {
        kind: 'markdown',
        fileName: 'sample.md',
        mimeType: 'text/markdown',
        content: '# 真实 Markdown',
      },
    });
    const docx = render({
      preview: {
        kind: 'docx',
        fileName: 'sample.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml',
        content: '<p>真实 DOCX</p>',
        downloadUrl:
          '/api/v1/chat/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/file?download=1',
      },
    });

    expect(text).toContain('真实纯文本');
    expect(markdown).toContain('# 真实 Markdown');
    expect(docx).toContain('data-docx-html="&lt;p&gt;真实 DOCX&lt;/p&gt;"');
  });

  it('PDF fixture 对应的受控 URL 传入 PDF renderer', () => {
    const fileUrl =
      '/api/v1/chat/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/file';
    const html = render({
      resource: makeResource({
        title: 'sample-1page.pdf',
        representation: {
          kind: 'document',
          mimeType: 'application/pdf',
          byteSize: 316,
        },
        renderer: { rendererId: 'source.pdf', rendererVersion: 1 },
      }),
      preview: {
        kind: 'pdf',
        fileName: 'sample-1page.pdf',
        mimeType: 'application/pdf',
        fileUrl,
      },
    });

    expect(html).toContain(`data-pdf-url="${fileUrl}"`);
  });

  it('PNG fixture 使用非空替代文本与受控 URL', () => {
    const fileUrl =
      '/api/v1/chat/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/file';
    const html = render({
      resource: makeResource({
        title: 'sample-1x1.png',
        representation: {
          kind: 'image',
          mimeType: 'image/png',
          byteSize: 69,
        },
        renderer: { rendererId: 'source.image', rendererVersion: 1 },
      }),
      preview: {
        kind: 'image',
        fileName: 'sample-1x1.png',
        mimeType: 'image/png',
        fileUrl,
      },
    });

    expect(html).toContain(`src="${fileUrl}"`);
    expect(html).toContain('alt="sample-1x1.png"');
  });

  it('音频与视频在无文字稿时明确说明文本替代不可用', () => {
    const audio = render({
      resource: makeResource({
        representation: {
          kind: 'audio',
          mimeType: 'audio/mpeg',
          byteSize: 128,
        },
        renderer: { rendererId: 'source.audio', rendererVersion: 1 },
      }),
      preview: {
        kind: 'audio',
        fileName: 'sample.mp3',
        mimeType: 'audio/mpeg',
        fileUrl:
          '/api/v1/chat/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/file',
        transcription: null,
      },
    });
    const video = render({
      resource: makeResource({
        representation: {
          kind: 'video',
          mimeType: 'video/mp4',
          byteSize: 256,
        },
        renderer: { rendererId: 'source.video', rendererVersion: 1 },
      }),
      preview: {
        kind: 'video',
        fileName: 'sample.mp4',
        mimeType: 'video/mp4',
        fileUrl:
          '/api/v1/chat/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/file',
        transcription: null,
        derivatives: {
          transcription: 'unavailable',
          keyframes: 'unavailable',
        },
      },
    });

    expect(audio).toContain('音频文字稿不可用');
    expect(video).toContain('视频文字稿不可用');
    expect(audio).toContain('aria-label="播放音频：无障碍测试来源"');
    expect(video).toContain('aria-label="播放视频：无障碍测试来源"');
  });
});
