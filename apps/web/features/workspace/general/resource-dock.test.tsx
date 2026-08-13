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
    expect(source).toContain("['ArrowUp', 'ArrowDown', 'Home', 'End']");
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain("document.addEventListener('pointerdown'");
    expect(source).toContain("document.removeEventListener('pointerdown'");
    expect(source).toContain('dockRef.current?.contains(target)');
    expect(source).toContain('focus-visible:ring-2');
    expect(source).toContain('max-h-[min(32rem,70vh)]');
    expect(source).toContain('overflow-y-auto');
    expect(source).toContain('此分类暂无资源');
    expect(source).toContain('正在加载资源…');
    expect(source).toContain('role="status"');
    expect(source).not.toContain('fetchCanvasResource');
    expect(source).not.toContain('/detail');
    expect(source).not.toMatch(/\b(?:content|objectKey|binary|byteStream)\b/);
  });
});
