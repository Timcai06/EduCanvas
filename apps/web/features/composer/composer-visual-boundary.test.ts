import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

describe('Composer 边框流动线边界', () => {
  it('装饰层不参与交互且只使用语义色', () => {
    const composer = source('./composer.tsx');
    const effects = source('../../app/effects.css');

    expect(composer).toContain('className="ink-flow-line"');
    expect(composer).toContain('aria-hidden="true"');
    expect(effects).toContain('pointer-events: none');
    expect(effects).toContain('var(--color-accent)');
  });

  it('减少动态时不流动，只在允许动态时旋转', () => {
    const effects = source('../../app/effects.css');
    const reducedMotion = effects.slice(
      effects.indexOf('@media (prefers-reduced-motion: reduce)'),
    );

    // 流动线的可见性与旋转都写在 no-preference 分支内，reduce 分支不得再启用它。
    expect(reducedMotion).not.toContain('.ink-flow-line');
    expect(effects).toContain('@media (prefers-reduced-motion: no-preference)');
  });
});
