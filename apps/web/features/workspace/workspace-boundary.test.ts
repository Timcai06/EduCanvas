import { readFileSync } from 'node:fs';
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

  it('keeps Halo animation on compositor properties and pauses while hidden', () => {
    const halo = read('features/workspace/shared/ambient-halo.tsx');

    expect(halo).toContain("document.addEventListener('visibilitychange'");
    expect(halo).toContain('animation.paused(document.hidden)');
    expect(halo).toContain("'(prefers-reduced-motion: reduce)'");
    expect(halo).not.toMatch(
      /^\s+(?:filter|background|backgroundPosition)\s*:\s*['"`]/m,
    );
    expect(halo).not.toMatch(/^\s+(?:width|height|top|left)\s*:\s*-?\d/m);
  });
});
