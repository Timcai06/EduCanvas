import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(WORKSPACE_ROOT, '../..');

function read(relativePath: string): string {
  return readFileSync(join(WEB_ROOT, relativePath), 'utf8');
}

describe('workspace truth and motion boundaries', () => {
  it('does not describe planned assets or preset artifacts as active AI output', () => {
    const workspace = read('features/workspace/learning/learn-workspace.tsx');
    const assets = read('features/assets/assets-drawer.tsx');
    const studio = read('features/studio/studio-drawer.tsx');
    const menu = read('features/composer/plus-menu.tsx');

    expect(workspace).not.toContain('stageLabel="练习"');
    expect(assets).not.toContain('勾选的资料会成为老师讲解和出题的依据');
    expect(studio).not.toContain('老师为你生成过的演示');
    expect(menu).toContain("label: '打开互动演示'");
    /* 未接入的能力不渲染,而不是以"即将开放"占位伪装 */
    expect(menu).toContain('item.available &&');
    expect(menu).not.toContain('即将开放');
  });

  it('keeps the two-pen identity free of generic AI glow decoration', () => {
    const globals = read('app/globals.css');
    const hero = read('features/workspace/shared/hero-greeting.tsx');

    /* 「两支笔」身份的硬边界:朱砂/黛青语义 token 存在,光晕与渐变文字不回归 */
    expect(globals).toContain('--color-cinnabar');
    expect(globals).toContain('--color-accent');
    expect(globals).not.toContain('ambient-halo');
    expect(globals).not.toContain('hero-gradient-text');
    expect(
      existsSync(join(WEB_ROOT, 'features/workspace/shared/ambient-halo.tsx')),
    ).toBe(false);

    /* 扉页动效必须尊重 reduced-motion,朱砂笔触只能来自语义 token */
    expect(hero).toContain("'(prefers-reduced-motion: reduce)'");
    expect(hero).toContain('var(--color-cinnabar)');
  });
});
