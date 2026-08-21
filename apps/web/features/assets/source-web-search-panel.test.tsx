import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SourceWebSearchPanel } from './source-web-search-panel';

describe('SourceWebSearchPanel', () => {
  it('renders a labelled keyboard-native search form and actionable empty state', () => {
    const html = renderToStaticMarkup(
      <SourceWebSearchPanel onImported={vi.fn()} />,
    );

    expect(html).toContain('id="source-web-search-query"');
    expect(html).toContain('for="source-web-search-query"');
    expect(html).toContain('type="search"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('选择结果后直接导入当前笔记本');
    expect(html).not.toContain('预览');
  });
});
