import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./resource-dock.tsx', import.meta.url)),
  'utf8',
);

describe('ResourceDock boundary', () => {
  it('renders summary-only interaction with accessible categories and reduced motion', () => {
    expect(source).toContain('aria-label="资源分类"');
    expect(source).toContain('aria-expanded=');
    expect(source).toContain('role="region"');
    expect(source).toContain('aria-controls=');
    expect(source).toContain("'Home', 'End'");
    expect(source).toContain('加载更多（仍有未加载资源）');
    expect(source).toContain('查看全部资源');
    expect(source).toContain('motion-safe:');
    expect(source).not.toContain('fetchCanvasResource');
    expect(source).not.toContain('/detail');
  });
});
