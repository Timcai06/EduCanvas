import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./studio-resource-library.tsx', import.meta.url)),
  'utf8',
);

describe('StudioResourceLibrary boundary', () => {
  it('uses summary query data and exposes safe open/pagination/a11y seams', () => {
    expect(source).toContain('queryResourceLibrary');
    expect(source).toContain('onOpen: (summary: WorkspaceResourceSummary)');
    expect(source).toContain('onLoadMore');
    expect(source).toContain('aria-label="资源列表"');
    expect(source).toContain('aria-label="资源库"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="status"');
    expect(source).toContain('role="alert"');
    expect(source).toContain('暂无匹配资源');
    expect(source).toContain('正在加载资源…');
    expect(source).toContain('flex-wrap');
    expect(source).toContain('min-h-0 overflow-y-auto');
    expect(source).toContain('focus-visible:ring-2');
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toContain('getResourceDetail');
    expect(source).not.toMatch(/\b(?:content|objectKey|binary|byteStream)\b/);
    expect(source).toContain('getResourceLibraryActions(summary)');
  });
});
