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
    const lineSidebar = read('components/LineSidebar.tsx');
    const studio = read('features/studio/studio-workspace.tsx');
    const studioOptions = read('features/studio/studio-workspace-options.ts');
    const studioOverlay = read('features/studio/studio-overlay.tsx');
    const optionWheel = read('components/OptionWheel.tsx');
    const optionWheelCss = read('components/OptionWheel.css');
    const pillNav = read('components/PillNav.tsx');
    const pillNavCss = read('components/PillNav.css');
    const logoLoop = read('components/LogoLoop.tsx');
    const technologyBrandLoop = read(
      'features/workspace/shared/technology-brand-loop.tsx',
    );
    const emptyHero = read('features/workspace/learning/empty-chat-hero.tsx');

    expect(generalWorkspace).toContain('<StudioWorkspace');
    expect(generalWorkspace).toContain('<StudioOverlay');
    expect(generalWorkspace).not.toContain('<SourcesPanel');
    expect(sidebar).not.toContain('children');
    expect(sidebar).not.toContain('来源');
    expect(sidebar).toContain('<LineSidebar');
    expect(lineSidebar).toContain('requestAnimationFrame');
    expect(lineSidebar).toContain('getBoundingClientRect');
    expect(lineSidebar).toContain('data-session-id');
    expect(studio).toContain('<OptionWheel');
    expect(studio).toContain('onSelect=');
    expect(studio).toContain('studio-cascade__wheel--primary');
    expect(studio).toContain('studio-cascade__wheel--secondary');
    expect(studio).toContain('一级保持可见');
    expect(studio).toContain('ROOT_ITEMS');
    expect(studioOptions).toContain('SOURCE_ADD_ITEMS');
    expect(studioOptions).toContain('OUTPUT_CREATE_ITEMS');
    expect(studio).toContain('GENERATED_SOFT_CLICK');
    expect(studio).toContain('soundVolume={0.38}');
    expect(optionWheel).toContain('requestAnimationFrame');
    expect(optionWheel).toContain('onSelectRef');
    expect(optionWheel).toContain('idPrefix');
    expect(optionWheelCss).not.toContain('border-radius: 50%');
    expect(optionWheelCss).not.toContain('stroke');
    expect(pillNav).toContain('useGSAP');
    expect(pillNav).toContain('ResizeObserver');
    expect(pillNav).toContain("'(prefers-reduced-motion: reduce)'");
    expect(pillNavCss).toContain('var(--color-accent)');
    expect(pillNavCss).not.toContain('#');
    expect(pillNavCss).toContain('backdrop-filter: blur(12px)');
    expect(logoLoop).toContain('requestAnimationFrame');
    expect(logoLoop).toContain('ResizeObserver');
    expect(logoLoop).toContain("'(prefers-reduced-motion: reduce)'");
    expect(technologyBrandLoop).toContain('SiPostgresql');
    expect(technologyBrandLoop).toContain('Built on an open learning stack');
    expect(emptyHero).toContain('<TechnologyBrandLoop');
    expect(studioOverlay).toContain('<aside');
    expect(studioOverlay).not.toContain('<Sheet');
    expect(studioOverlay).not.toContain('role="dialog"');
    expect(studioOverlay).not.toContain('bg-card');
  });

  it('keeps settings behind the avatar entry instead of a duplicate gear', () => {
    const header = read(
      'features/workspace/general/general-workspace-header.tsx',
    );
    const circularText = read('components/CircularText.tsx');
    const productMark = read('components/ProductMark.tsx');
    const sidebar = read('features/workspace/general/conversation-sidebar.tsx');
    const entry = read('features/workspace/general/general-chat-entry.tsx');
    const learningTopBar = read('features/workspace/learning/top-bar.tsx');
    const profilePage = read('app/profile/page.tsx');
    const profileDrawer = read('features/profile/profile-drawer.tsx');
    const userMenu = read('features/auth/user-menu.tsx');
    const sheet = read('features/workspace/shared/sheet.tsx');
    const settingsRoute = read('app/settings/page.tsx');

    expect(header).not.toContain('Gear');
    expect(header).toContain('<PillNav');
    expect(header).not.toContain('新建笔记本');
    expect(header).not.toContain('LogoMark');
    expect(header).toContain('<ProductMark');
    expect(entry).toContain('<ProductMark');
    expect(learningTopBar).toContain('<ProductMark');
    expect(profilePage).toContain('<ProductMark');
    expect(productMark).toContain('<CircularText');
    expect(circularText).toContain('gsap.matchMedia');
    expect(circularText).toContain("'(prefers-reduced-motion: reduce)'");
    expect(sidebar).toContain('新建笔记本');
    expect(sidebar).toContain('命名笔记本');
    expect(sidebar).toContain("method: 'PATCH'");
    expect(profileDrawer).toContain('<ThemeToggle');
    expect(profileDrawer).toContain('<ProfileSettings');
    expect(profileDrawer).toContain('<ConnectionSettings');
    expect(profileDrawer).toContain('stableHeight');
    expect(profileDrawer).toContain('activity?.streakDays');
    expect(userMenu).toContain('initialUser={user}');
    expect(sheet).toContain('stableHeight');
    expect(settingsRoute).toContain("redirect('/?profile=1')");
  });

  it('uses viewport coordinates for scrolled marginalia proximity', () => {
    const marginalia = read('features/workspace/shared/marginalia-nav.tsx');
    const lineSidebar = read('components/LineSidebar.tsx');

    expect(marginalia).toContain('rowRect.top + rowRect.height / 2');
    expect(marginalia).toContain('event.clientY - center');
    expect(marginalia).not.toContain('el.offsetTop - list.scrollTop');
    expect(lineSidebar).toContain(
      'const row = element.getBoundingClientRect()',
    );
    expect(lineSidebar).toContain('event.clientY - center');
    expect(lineSidebar).not.toContain('element.offsetTop');
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
    const textType = read('features/workspace/shared/text-type.tsx');
    const layout = read('app/layout.tsx');

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
    expect(hero).toContain('<TextType');
    expect(textType).toContain('pauseRange');
    expect(textType).toContain('Math.random()');
    expect(textType).not.toContain('cursor');
    expect(layout).toContain("from 'next/script'");
    expect(layout).toContain('strategy="beforeInteractive"');
    expect(layout).not.toContain('<script dangerouslySetInnerHTML');
  });
});
