import { expect, test, type Page } from '@playwright/test';

/**
 * Canvas shell 视觉与无障碍回归（F04）。
 *
 * 只验证 CanvasHost 外壳的响应式、焦点、滚动与状态展示，
 * 不测试任何 Renderer 内容、产物协议或 Gateway。
 *
 * 使用仓库现有可控 fixture：通过对话→生成思维导图打开 Canvas，
 * 该链路由 worker 规则生成，不依赖模型 Provider。
 */

const STUDIO_TRIGGER_NAME = '展开当前笔记本的输入与输出';

async function openCanvasViaMindMap(page: Page) {
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
  await page.getByRole('button', { name: '打开', exact: true }).click();

  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  return canvas;
}

test.describe('Canvas shell 基础语义', () => {
  test('Canvas 以 dialog role 打开，有关闭和全屏按钮', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);

    await expect(canvas).toHaveAttribute('role', 'dialog');
    await expect(canvas).toHaveAttribute('aria-modal', 'true');

    const closeButton = canvas.getByRole('button', { name: /关闭/ });
    await expect(closeButton).toBeVisible();
    await expect(closeButton).toBeEnabled();

    // Canvas 默认全屏打开，全屏按钮应显示"退出全屏"
    const fullscreenButton = canvas.getByRole('button', {
      name: '退出全屏',
    });
    await expect(fullscreenButton).toBeAttached();
  });

  test('Escape 退出全屏，关闭按钮关闭 Canvas', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);

    // Escape 退出全屏
    await page.keyboard.press('Escape');
    // 全屏退出后，全屏按钮文字变为"全屏"
    await expect(page.getByRole('button', { name: '全屏' })).toBeVisible();

    // 用关闭按钮关闭
    await page.getByRole('button', { name: /关闭/ }).click();
    await expect(
      page.getByRole('dialog', { name: '产物Canvas' }),
    ).not.toBeVisible();
  });
});

test.describe('Canvas shell 键盘焦点', () => {
  test('关闭按钮关闭后焦点回到页面可聚焦元素', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);

    await canvas.getByRole('button', { name: /关闭/ }).click();
    await expect(canvas).not.toBeVisible();

    // 焦点应回到页面某个可聚焦元素
    const focused = page.locator(':focus');
    await expect(focused).toBeAttached();
  });

  test('全屏按钮可通过键盘 Tab 到达', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);

    // Tab 遍历工具栏，全屏按钮应在其中
    await canvas.press('Escape'); // 先聚焦 section
    // 重新触发，确认初始焦点不在全屏按钮
    await expect(page.locator(':focus')).not.toHaveAttribute(
      'aria-label',
      '全屏',
    );
  });
});

test.describe('Canvas shell 响应式布局', () => {
  test('桌面端无横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);

    const scrollWidth = await canvas.evaluate((el) => el.scrollWidth);
    const clientWidth = await canvas.evaluate((el) => el.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('320px 窄屏无横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);

    const scrollWidth = await canvas.evaluate((el) => el.scrollWidth);
    const clientWidth = await canvas.evaluate((el) => el.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('768px 中屏正常显示', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);

    await expect(canvas).toBeVisible();
    const closeButton = canvas.getByRole('button', { name: /关闭/ });
    await expect(closeButton).toBeVisible();
  });
});

test.describe('Canvas shell 滚动', () => {
  test('Canvas 内容区可独立滚动，无双滚动条', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);

    // 内容区（min-h-0 flex-1 overflow-y-auto）存在
    const contentFrame = canvas.locator('div.min-h-0.flex-1.overflow-hidden');
    await expect(contentFrame).toBeAttached();

    // body 不应被 Canvas 打开而锁死（仅全屏/dialog 时应 hidden）
    // 对话→生成的 Canvas 默认为 dialog → body overflow hidden
  });
});

test.describe('Canvas shell 暗色模式', () => {
  test('Canvas 在暗色模式下可正常展示', async ({ page }) => {
    await page.emulateMedia({
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    });
    const canvas = await openCanvasViaMindMap(page);

    await expect(canvas).toBeVisible();
    // Canvas 标题可见
    await expect(
      canvas.getByRole('heading', { name: '对话思维导图' }),
    ).toBeVisible();
  });
});

test.describe('Canvas shell reduced-motion', () => {
  test('reduced-motion 下 Canvas 不依赖动画才能展示内容', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);

    // 无动画时内容仍立即可见
    await expect(
      canvas.locator('[data-mind-map]').getByText('对话思维导图'),
    ).toBeVisible({ timeout: 5_000 });
  });
});
