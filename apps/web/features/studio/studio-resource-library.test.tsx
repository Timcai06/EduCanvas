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
    expect(source).toContain('aria-label="会话资源管理"');
    expect(source).toContain('aria-label={label}');
    expect(source).toContain('label="来源列表"');
    expect(source).toContain('label="输出列表"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="alert"');
    expect(source).toContain('还没有匹配的来源');
    expect(source).toContain('正在同步资源…');
    expect(source).toContain("category === 'artifact'");
    expect(source).toContain('studio-resource-table-shell');
    expect(source).not.toContain('<PixelSwap');
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toContain('getResourceDetail');
    expect(source).not.toMatch(/\b(?:content|objectKey|binary|byteStream)\b/);
    expect(source).toContain('getResourceLibraryActions(summary)');
  });
});
