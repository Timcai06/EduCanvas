import { expect, test } from '@playwright/test';

/**
 * Hydration / 客户端运行时健康检查（Q05）。
 *
 * 访问公开路由与 design-qa 展示页（不依赖模型与登录），收集：
 * - 页面级未捕获错误（pageerror）；
 * - 与 React hydration 或 CSS 不匹配相关的 console error。
 * 任何一条都视为发布级回归：hydration 失败意味着客户端事件绑定失效，
 * 属于稳定性问题而不是视觉问题，因此在本 lane 必跑、不受 @ui 排除。
 *
 * 只断言错误集合，不读正文，不采集用户数据。
 */

const HYDRATION_ERROR_PATTERN =
  /hydrat|did not match|didn't match|unexpected token|client side rendering/i;

const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/design-qa/pipeline-flow',
  '/design-qa/canvas-provenance',
] as const;

async function proveClientReady(
  page: import('@playwright/test').Page,
  route: (typeof PUBLIC_ROUTES)[number],
) {
  if (route === '/login' || route === '/register') {
    const initialSwitch = page.getByRole('button', {
      name: route === '/login' ? '第一次来？创建账号' : '已有账号？返回登录',
    });
    const switchedLabel =
      route === '/login' ? '已有账号？返回登录' : '第一次来？创建账号';
    await expect(initialSwitch).toBeVisible();
    await initialSwitch.click();
    await expect(
      page.getByRole('button', { name: switchedLabel }),
    ).toBeVisible();
    return;
  }

  if (route === '/design-qa/pipeline-flow') {
    const shell = page.getByTestId('animation-shell');
    await expect(shell).toContainText('步骤 1/4');
    await shell.focus();
    await page.keyboard.press('ArrowRight');
    await expect(shell).toContainText('步骤 2/4');
    return;
  }

  await expect(page.getByTestId('artifact-provenance-qa')).toHaveAttribute(
    'data-hydrated',
    'true',
  );
}

test.describe('hydration 与客户端运行时健康', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} 无 pageerror 与 hydration 错误`, async ({ page }) => {
      const pageErrors: string[] = [];
      const hydrationErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      page.on('console', (message) => {
        if (
          message.type() === 'error' &&
          HYDRATION_ERROR_PATTERN.test(message.text())
        ) {
          hydrationErrors.push(message.text());
        }
      });

      await page.goto(route, { waitUntil: 'load' });
      await proveClientReady(page, route);

      expect(
        hydrationErrors,
        `hydration 错误: ${hydrationErrors.join(' | ') || '无'}`,
      ).toEqual([]);
      expect(
        pageErrors,
        `pageerror: ${pageErrors.join(' | ') || '无'}`,
      ).toEqual([]);
    });
  }

  test('@smoke / 匿名首页渲染且无 hydration 错误', async ({ page }) => {
    const pageErrors: string[] = [];
    const hydrationErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        HYDRATION_ERROR_PATTERN.test(message.text())
      ) {
        hydrationErrors.push(message.text());
      }
    });

    // Hydration correctness must not depend on the landing-page GSAP timeline
    // receiving enough main-thread time on a saturated CI runner. Reduced motion
    // is a supported product mode and keeps this gate focused on event binding.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'load' });

    // 通过真实客户端交互证明 hydration 已完成；固定 sleep 在慢 runner 上会
    // 偶发占满整个 test timeout，且并不能证明事件绑定已经可用。
    await expect(
      page.getByRole('heading', { name: '今天想学什么？' }),
    ).toBeVisible();
    const createMenuTrigger = page.getByRole('button', {
      name: '添加上下文或创建内容',
    });
    await createMenuTrigger.focus();
    await expect(createMenuTrigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('menuitem', { name: /生成思维导图/ }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    expect(hydrationErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
