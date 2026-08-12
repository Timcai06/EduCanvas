import { expect, test, type Locator, type Page } from '@playwright/test';

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
 * 数据准备复用 worker 规则生成思维导图（真实 worker 消费，无模型依赖），
 * 链路本身已在 artifact-flow / canvas-shell-visual 验证，这里只测键盘路径。
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

const STUDIO_TRIGGER_NAME = '展开当前笔记本的输入与输出';

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

/** 资源条目保持原生按钮语义；聚焦目标后只用 Enter 打开。 */
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

/** 分类默认「全部」；两次 ArrowDown 选择「AI 产物」。 */
async function selectArtifactCategoryViaKeyboard(studio: Locator) {
  const category = studio.getByRole('combobox', { name: '资源分类' });
  await category.focus();
  await category.press('ArrowDown');
  await category.press('ArrowDown');
  await category.press('Enter');
  await expect(category).toHaveValue('artifact');
}

async function generateMindMap(page: Page) {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '今天想学什么？' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: /生成思维导图/ }).click();
  const confirmSheet = page.getByRole('dialog', { name: '生成思维导图' });
  await expect(confirmSheet).toBeVisible();
  await confirmSheet.getByRole('button', { name: '开始生成' }).click();
  await expect(page.getByText('思维导图已生成')).toBeVisible({
    timeout: 30_000,
  });
}

test('键盘-only 打开 AI 产物 Canvas、键盘关闭并归还焦点', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await generateMindMap(page);

  const studio = await openStudioViaKeyboard(page);
  await selectArtifactCategoryViaKeyboard(studio);
  await openResourceViaKeyboard(studio, /对话思维导图/);

  // 资源按钮 Enter 应打开产物 Canvas（surface → artifact，landing 强制全屏）。
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  await expect(
    canvas.locator('[data-mind-map]').getByText('对话思维导图'),
  ).toBeVisible();

  // 打开后 Canvas 根获得焦点；Tab 到达首个可聚焦元素。全屏切换按钮
  // 只在 lg 以上视口可见（hidden lg:flex），<lg 的移动端首站是关闭按钮。
  await expect(canvas).toBeFocused();
  await page.keyboard.press('Tab');
  const viewport = page.viewportSize();
  const isDesktop = viewport !== null && viewport.width >= 1024;
  if (isDesktop) {
    await expect(
      canvas.getByRole('button', { name: '退出全屏' }),
    ).toBeFocused();
  } else {
    await expect(
      canvas.getByRole('button', { name: '关闭', exact: true }),
    ).toBeFocused();
  }

  // landing 强制全屏不可退：一次 Escape 直接关闭 Canvas（W06 修复）。
  // Escape listener 用 capture 阶段注册（cap:Escape 稳定到达 document；
  // bubble 阶段会被 React/Chrome 合成事件吞掉），真实键盘一次即关闭。
  await page.keyboard.press('Escape');
  await expect(canvas).not.toBeVisible();

  // 焦点归还 opener：Studio 打开资源即关闭，Canvas 的 opener 是 banner 里的
  // Studio trigger；关闭 Canvas 后焦点回到重新打开 Studio 的入口，不落 body。
  await expect(
    page.getByRole('button', { name: STUDIO_TRIGGER_NAME }),
  ).toBeFocused();
});

test('键盘-only 从 Studio 打开 Source 列表，空态键盘不误开资源', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await generateMindMap(page);

  // 分类默认「全部」：一次 ArrowDown 选择来源。未上传资产时显示空态。
  const studio = await openStudioViaKeyboard(page);
  const category = studio.getByRole('combobox', { name: '资源分类' });
  await category.focus();
  await category.press('ArrowDown');
  await category.press('Enter');
  await expect(category).toHaveValue('source');
  const resourceList = studio.getByRole('list', { name: '资源列表' });
  await expect(resourceList.getByText('暂无匹配资源')).toBeVisible();
  await expect(resourceList.getByRole('button')).toHaveCount(0);

  // 空态没有伪造的可聚焦资源按钮，不会误开任何资源。
  await expect(page.getByRole('dialog', { name: '产物Canvas' })).toHaveCount(0);
  await expect(
    page.getByRole('complementary', { name: '当前笔记本的 Studio' }),
  ).toBeVisible();
});
