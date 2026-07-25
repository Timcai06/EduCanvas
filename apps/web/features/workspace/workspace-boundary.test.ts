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
  it('keeps notebook history separate from Studio input and output', () => {
    const generalWorkspace = read(
      'features/workspace/general/general-chat-workspace.tsx',
    );
    const sidebar = read('features/workspace/general/conversation-sidebar.tsx');
    const studio = read('features/studio/studio-workspace.tsx');
    const studioDock = read('features/studio/studio-dock.tsx');
    const cornerArc = read('features/studio/studio-corner-arc.tsx');

    expect(generalWorkspace).toContain('<StudioWorkspace');
    expect(generalWorkspace).toContain('<StudioDock');
    expect(generalWorkspace).not.toContain('<SourcesPanel');
    expect(sidebar).not.toContain('children');
    expect(sidebar).not.toContain('来源');
    expect(studio).toContain('<StudioCornerArc');
    expect(studio).toContain('<OptionWheel');
    expect(studio).toContain('onSelect=');
    expect(studio).toContain("if (level === 'root')");
    expect(studio).toContain('onExpandedChange(true)');
    expect(cornerArc).toContain('文件输入');
    expect(cornerArc).toContain('内容输出');
    expect(studioDock).toContain('<aside');
    expect(studioDock).not.toContain('<Sheet');
    expect(studioDock).not.toContain('role="dialog"');
  });

  it('keeps settings behind the avatar entry instead of a duplicate gear', () => {
    const header = read(
      'features/workspace/general/general-workspace-header.tsx',
    );
    const profileDrawer = read('features/profile/profile-drawer.tsx');
    const settingsRoute = read('app/settings/page.tsx');

    expect(header).not.toContain('Gear');
    expect(profileDrawer).toContain('<ThemeToggle');
    expect(profileDrawer).toContain('<ProfileSettings');
    expect(profileDrawer).toContain('<ConnectionSettings');
    expect(settingsRoute).toContain("redirect('/?profile=1')");
  });

  it('uses viewport coordinates for scrolled marginalia proximity', () => {
    const marginalia = read('features/workspace/shared/marginalia-nav.tsx');

    expect(marginalia).toContain('rowRect.top + rowRect.height / 2');
    expect(marginalia).toContain('event.clientY - center');
    expect(marginalia).not.toContain('el.offsetTop - list.scrollTop');
  });

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

    /* 「两支笔」身份的硬边界:朱砂/墨紫语义 token 存在,光晕与渐变文字不回归 */
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
