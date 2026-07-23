import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

describe('Composer 边缘扫光边界', () => {
  it('装饰层不参与交互且只使用语义色', () => {
    const composer = source('./composer.tsx');
    const effects = source('../../app/effects.css');

    expect(composer).toContain('<span aria-hidden="true" className="star-sweep">');
    expect(effects).toContain('pointer-events: none');
    expect(effects).toContain('var(--color-accent)');
  });

  it('减少动态时不播放边缘扫光', () => {
    const effects = source('../../app/effects.css');
    const reducedMotion = effects.slice(
      effects.indexOf('@media (prefers-reduced-motion: reduce)'),
    );

    expect(reducedMotion).not.toContain('.star-sweep');
    expect(effects).toContain(
      '@media (prefers-reduced-motion: no-preference)',
    );
  });
});
