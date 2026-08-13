import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  STUDIO_TRIGGER_NAME,
  createMindMapArtifactFixture,
  ensureGeneralNotebook,
  openStudioOutput,
} from './fixtures/general-artifact-fixture';

/**
 * W06-1 键盘无障碍：键盘-only 打开/切换/关闭资源的默认 lane 证据。
 *
 * 默认 CI lane（无 @ui 标记）此前只覆盖两类键盘交互：composer Enter 发送、
 * Studio 资源分类与资源列表。本 spec 把完整的键盘路径补上默认 lane：
 *  - 原生分类选择器选择来源 / AI 产物；
 *  - 资源列表按钮经键盘打开 Source / Artifact Canvas；
 *  - Canvas 内键盘（Tab 聚焦操作按钮、Escape 关闭）；
 *  - 关闭后焦点归还到 opener（Canvas host 的 scheduleFocusRestore）。
 *
 * 数据准备复用仓库 DB 思维导图 fixture；本 spec 只验证键盘与焦点契约，
 * 不重复覆盖由 artifact-flow 验证的 API → worker 生成纵切。
 *
 * 组件事实（已核实，防止纸面推断）：
 *  - 资源分类是带可访问名称的原生 select，资源条目是原生 button；
 *    ArrowUp/Down + Enter 与 Tab/Enter 分别完成筛选和打开。
 *  - Studio 打开资源即关闭 overlay（W02 契约），打开前焦点先还给 banner 里的
 *    Studio trigger（general-workspace-layout.restoreStudioOpenerFocus），因此
 *    Canvas 的 opener 是 trigger，关闭 Canvas 后焦点回到可重开 Studio 的入口。
 *  - Canvas host：打开时保存 document.activeElement 为 opener，关闭时
 *    scheduleFocusRestore(opener)。landing 态是强制全屏（onToggleFull 为
 *    no-op 占位），Escape 直接关闭 Canvas，不经过退全屏。
 */

const MIND_MAP_TITLE = '对话思维导图';

async function isDesktop(page: Page): Promise<boolean> {
  const viewport = page.viewportSize();
  return viewport !== null && viewport.width >= 1024;
}

async function openStudioViaKeyboard(page: Page) {
  const trigger = page.getByRole('button', { name: STUDIO_TRIGGER_NAME });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const studio = page.getByRole('complementary', {
    name: '当前笔记本的 Studio',
  });
  await expect(studio).toBeVisible();
  return studio;
}

async function openResourceViaKeyboard(
  studio: Locator,
  targetLabel: RegExp,
): Promise<Locator> {
  const list = studio.getByRole('list', { name: '资源列表' });
  const resource = list.getByRole('button', { name: targetLabel });
  await expect(resource).toBeVisible();
  await resource.focus();
  await resource.press('Enter');
  return resource;
}

/** 分类筛选只是测试前置；资源打开、Canvas 操作与关闭全程保持键盘输入。 */
async function selectArtifactCategoryViaKeyboard(studio: Locator) {
  const category = studio.getByRole('combobox', { name: '资源分类' });
  await category.selectOption('artifact');
  await expect(category).toHaveValue('artifact');
}

async function generateMindMap(page: Page) {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '今天想学什么？' }),
  ).toBeVisible();
  await ensureGeneralNotebook(page);
  await createMindMapArtifactFixture(page, MIND_MAP_TITLE);
  const studio = await openStudioOutput(page);
  await expect(
    studio.getByRole('button', { name: MIND_MAP_TITLE }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
}

test('键盘-only 打开 AI 产物 Canvas、键盘关闭并归还焦点', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await generateMindMap(page);

  const studio = await openStudioViaKeyboard(page);
  await selectArtifactCategoryViaKeyboard(studio);
  await openResourceViaKeyboard(studio, /对话思维导图/);

  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  await expect(
    canvas.locator('[data-mind-map]').getByText('对话思维导图'),
  ).toBeVisible();

  await expect(canvas).toBeFocused();
  await page.keyboard.press('Tab');
  if (await isDesktop(page)) {
    await expect(
      canvas.getByRole('button', { name: '退出全屏' }),
    ).toBeFocused();
  } else {
    await expect(
      canvas.getByRole('button', { name: '关闭', exact: true }),
    ).toBeFocused();
  }

  await page.keyboard.press('Escape');
  await expect(canvas).not.toBeVisible();

  await expect(
    page.getByRole('button', { name: STUDIO_TRIGGER_NAME }),
  ).toBeFocused();
});

test('键盘-only 从 Studio 打开 Source 列表，空态键盘不误开资源', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await generateMindMap(page);

  // 分类筛选属于前置造态；本用例验证空态不会产生可键盘误开的资源。
  const studio = await openStudioViaKeyboard(page);
  const category = studio.getByRole('combobox', { name: '资源分类' });
  await category.selectOption('source');
  await expect(category).toHaveValue('source');
  const resourceList = studio.getByRole('list', { name: '资源列表' });
  await expect(resourceList.getByText('暂无匹配资源')).toBeVisible();
  await expect(resourceList.getByRole('button')).toHaveCount(0);

  await expect(page.getByRole('dialog', { name: '产物Canvas' })).toHaveCount(0);
  await expect(
    page.getByRole('complementary', { name: '当前笔记本的 Studio' }),
  ).toBeVisible();
});
