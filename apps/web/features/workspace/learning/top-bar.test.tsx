import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TopBar } from './top-bar';

describe('Learning TopBar', () => {
  it('quiet 与课程状态都保留明确的返回笔记本入口', () => {
    const html = renderToStaticMarkup(
      <TopBar courseTitle="" stageLabel={null} masteryPercent={null} quiet />,
    );

    expect(html).toContain('href="/"');
    expect(html).toContain('aria-label="返回笔记本"');
    expect(html).toContain('返回笔记本');
  });
});
