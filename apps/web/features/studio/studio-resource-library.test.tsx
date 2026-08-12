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
    expect(source).toContain('role="alert"');
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toContain('getResourceDetail');
    expect(source).toContain('getResourceLibraryActions(summary)');
  });
});
