import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

describe('全站主题系统边界', () => {
  it('纸纹 SVG 在绘制矩形前闭合滤镜节点', () => {
    const css = source('./globals.css');

    expect(css).toContain('%3C/filter%3E%3Crect');
  });

  it('水合前与挂载后都同步 data-theme 和原生 color-scheme', () => {
    const layout = source('./layout.tsx');
    const theme = source('../features/theme/use-theme.ts');

    expect(layout).toContain("r.setAttribute('data-theme',t)");
    expect(layout).toContain('r.style.colorScheme=t');
    expect(layout).toContain('<ThemeSync />');
    expect(theme).toContain("root.setAttribute('data-theme', resolved)");
    expect(theme).toContain('root.style.colorScheme = resolved');
  });
});
