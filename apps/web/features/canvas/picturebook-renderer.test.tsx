import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PicturebookRenderer } from './picturebook-renderer';

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

const artifactId = '11111111-1111-4111-8111-111111111111';

describe('PicturebookRenderer', () => {
  it('首屏提供页码、文字、图片与可访问翻页控制', () => {
    const markup = renderToStaticMarkup(
      <PicturebookRenderer
        title="小狐狸认识平均数"
        content={{
          contentVersion: 1,
          pages: Array.from({ length: 6 }, (_, index) => ({
            captionText: `第 ${index + 1} 页的发现`,
            imageUrl: `/api/v1/chat/artifacts/${artifactId}/picturebook/pages/${index + 1}?version=1`,
          })),
        }}
      />,
    );

    expect(markup).toContain('第 1 页 / 共 6 页');
    expect(markup).toContain('第 1 页的发现');
    expect(markup).toContain('aria-label="上一页"');
    expect(markup).toContain('aria-label="下一页"');
    expect(markup).not.toContain('第 2 页的发现');
  });
});
