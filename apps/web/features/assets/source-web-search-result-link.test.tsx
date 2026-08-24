import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SourceWebSearchResultLink } from './source-web-search-result-link';

describe('SourceWebSearchResultLink', () => {
  it('opens the public result in a separate protected tab', () => {
    const html = renderToStaticMarkup(
      <SourceWebSearchResultLink
        result={{
          title: 'Research article',
          url: 'https://example.com/research',
          domain: 'example.com',
        }}
      />,
    );

    expect(html).toContain('href="https://example.com/research"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('在新标签页打开');
  });
});
