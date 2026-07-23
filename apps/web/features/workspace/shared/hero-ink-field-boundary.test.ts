import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

describe('安静墨点场边界', () => {
  it('入口显式关闭指针液态效果和点击涟漪', () => {
    const hero = source('./hero-ink-field.tsx');

    expect(hero).toContain('enableRipples={false}');
    expect(hero).toContain('liquid={false}');
  });

  it('尺寸变化后立即补渲且正常帧循环仍只调度一次', () => {
    const runtime = source('./pixel-blast-runtime.ts');
    const resize = runtime.slice(
      runtime.indexOf('private readonly resize'),
      runtime.indexOf('private shouldAnimate'),
    );
    const renderFrame = runtime.slice(
      runtime.indexOf('private readonly renderFrame'),
      runtime.indexOf('private renderOnce'),
    );

    expect(resize).toContain('this.renderOnce()');
    expect(renderFrame).toContain('this.renderOnce()');
    expect(renderFrame.match(/requestAnimationFrame/g)).toHaveLength(1);
  });
});
