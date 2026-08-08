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
];

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

      await page.goto(route, { waitUntil: 'networkidle' });
      // 等待客户端 hydration 与首屏脚本执行完成，再判定错误集合。
      await page.waitForTimeout(1500);

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

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // EduCanvas 是匿名优先应用：/ 直接渲染首页，不要求登录。
    await expect(
      page.getByRole('heading', { name: '今天想学什么？' }),
    ).toBeVisible();
    expect(hydrationErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
