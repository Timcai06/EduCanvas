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
    await expect(canvas.getByRole('button', { name: '全屏' })).toBeVisible();

    // 用关闭按钮关闭（限定在 canvas 内查找，避免页面上其他"关闭"按钮）
    await canvas.getByRole('button', { name: /关闭/ }).click();
    await expect(canvas).not.toBeVisible();
  });
});

test.describe('Canvas shell 键盘焦点', () => {
  test('关闭按钮关闭后焦点回到页面可聚焦元素', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);
    const opener = page.getByRole('button', { name: '打开', exact: true });

    await canvas.getByRole('button', { name: /关闭/ }).click();
    await expect(canvas).not.toBeVisible();
    await expect(opener).toBeFocused();
  });

  test('全屏按钮可通过键盘 Tab 到达', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);

    await expect(canvas).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      canvas.getByRole('button', { name: '退出全屏' }),
    ).toBeFocused();
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

test.describe('Canvas shell 极端内容与失败状态', () => {
  test('200 字标题和超长内容不挤掉操作按钮或产生横向溢出', async ({ page }) => {
    const longTitle = '超长标题'.repeat(50);
    const longLabel = '长内容'.repeat(40);
    await page.route('**/api/v1/chat/artifacts/*', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (
        request.method() !== 'GET' ||
        !/^\/api\/v1\/chat\/artifacts\/[0-9a-f-]+$/i.test(pathname)
      ) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      if (!response.ok()) {
        await route.fulfill({ response });
        return;
      }
      const payload = (await response.json()) as {
        artifact?: { title?: string };
        version?: {
          content?: {
            root?: {
              children?: Array<{
                id: string;
                label: string;
                children?: Array<{ id: string; label: string }>;
              }>;
            };
          };
        } | null;
      };
      if (payload.artifact) payload.artifact.title = longTitle;
      if (payload.version?.content?.root) {
        payload.version.content.root.children = Array.from(
          { length: 8 },
          (_, index) => ({
            id: `long-${index + 1}`,
            label: longLabel,
            children: Array.from({ length: 3 }, (_, childIndex) => ({
              id: `long-${index + 1}-${childIndex + 1}`,
              label: `嵌套长内容 ${index + 1}-${childIndex + 1}`,
            })),
          }),
        );
      }
      await route.fulfill({ response, json: payload });
    });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);
    await expect(
      canvas.getByRole('heading', { name: longTitle }),
    ).toBeVisible();
    await expect(canvas.getByRole('button', { name: /关闭/ })).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: '退出全屏' }),
    ).toBeAttached();
    await expect(canvas.getByText(longLabel).first()).toBeVisible();

    const { scrollWidth, clientWidth } = await canvas.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    const contentScroller = canvas.getByRole('region', {
      name: 'Canvas 内容',
    });
    await expect(contentScroller).toBeVisible();
    const overflow = await contentScroller.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        bodyOverflow: document.body.style.overflow,
      };
    });
    expect(overflow.overflowY).toBe('auto');
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
    expect(overflow.bodyOverflow).toBe('hidden');
  });

  test('资源验证失败展示可重试的安全失败状态', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const canvas = await openCanvasViaMindMap(page);
    await canvas.getByRole('button', { name: /关闭/ }).click();

    await page.route(
      '**/api/v1/canvas/resources/artifact/**',
      async (route) => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'resource_unavailable',
              message: '暂时无法读取资源。',
            },
          }),
        });
      },
    );
    await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
    const studio = page.getByRole('complementary', {
      name: '当前笔记本的 Studio',
    });
    const wheel = studio.getByRole('listbox', {
      name: '选择 Studio 能力',
    });
    await wheel.press('ArrowDown');
    await wheel.press('Enter');
    const failedResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/canvas/resources/artifact/') &&
        response.status() === 503,
    );
    await studio.getByRole('option', { name: /对话思维导图/ }).click();
    await failedResponse;

    const statusSurface = page.getByLabel('Canvas 资源状态');
    await expect(
      statusSurface.getByRole('alert', { name: '无法打开资源' }),
    ).toBeVisible();
    await expect(
      statusSurface.getByRole('button', { name: '重试' }),
    ).toBeEnabled();
    await expect(statusSurface).not.toContainText('resource_unavailable');
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
