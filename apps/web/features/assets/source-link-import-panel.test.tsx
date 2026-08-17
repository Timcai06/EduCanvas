import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SourceLinkImportPanel } from './source-link-import-panel';

describe('SourceLinkImportPanel', () => {
  it('renders a labelled multiline batch input and direct import action', () => {
    const html = renderToStaticMarkup(
      <SourceLinkImportPanel onImported={vi.fn()} />,
    );

    expect(html).toContain('<textarea');
    expect(html).toContain('id="source-link-import-urls"');
    expect(html).toContain('for="source-link-import-urls"');
    expect(html).toContain('开始导入');
    expect(html).not.toContain('预览');
    expect(html).not.toContain('type="url"');
  });
});
