import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';
import { ListSkeleton } from './skeleton';

describe('UI state primitives', () => {
  it('renders an empty state as readable text without making decoration accessible', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="还没有资料"
        description="上传资料后会显示在这里。"
        icon={<span>decorative</span>}
      />,
    );

    expect(html).toContain('还没有资料');
    expect(html).toContain('上传资料后会显示在这里。');
    expect(html).toContain('aria-hidden="true"');
  });

  it('announces a list loading state and keeps visual rows decorative', () => {
    const html = renderToStaticMarkup(<ListSkeleton rows={2} />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="正在加载"');
    expect(html.match(/animate-pulse/g)).toHaveLength(6);
  });
});
