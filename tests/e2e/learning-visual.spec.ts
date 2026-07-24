import { expect, test } from '@playwright/test';
import { openLearningWorkspace } from './study-onboarding';

test.describe('学习页视觉基线', () => {
  test('桌面端 Chat-empty（纸面亮色默认）', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLearningWorkspace(page);

    await expect(
      page.getByRole('heading', { name: '今天想学点什么？' }),
    ).toBeVisible();
    /* 两支笔基线:光场不回归,扉页只有衬线问候与朱砂笔触 */
    await expect(page.locator('.ambient-halo__layer')).toHaveCount(0);
    await expect(page.locator('.hero-ink-text')).toBeVisible();
    // Chat-empty 基线只比较内容画布；Learning Rail 由独立交互 E2E 覆盖。
    await page.addStyleTag({
      content: '[aria-label="学习记录侧栏"] { display: none !important; }',
    });
    await expect(page).toHaveScreenshot('chat-empty-desktop.png', {
      animations: 'disabled',
      fullPage: true,
    });
  });

  test('移动端 Chat-empty 无装饰残留', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await openLearningWorkspace(page);

    await expect(
      page.getByRole('heading', { name: '今天想学点什么？' }),
    ).toBeVisible();
    await expect(page.locator('.ambient-halo__layer')).toHaveCount(0);
    await expect(page).toHaveScreenshot('chat-empty-mobile.png', {
      animations: 'disabled',
      fullPage: true,
    });
  });

  test('reduced-motion 的静止扉页在五秒后保持像素稳定', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLearningWorkspace(page);
    await expect(
      page.getByRole('heading', { name: '今天想学点什么？' }),
    ).toBeVisible();

    const first = await page.screenshot({ animations: 'disabled' });
    await page.waitForTimeout(5_000);
    const second = await page.screenshot({ animations: 'disabled' });
    expect(second.equals(first)).toBe(true);
  });

  test('移动端真实 AI 未接入状态', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await openLearningWorkspace(page);

    const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
    await composer.fill('为什么计算机能认出图片？');
    await composer.press('Enter');

    await expect(
      page.getByRole('banner').getByText('EduCanvas', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('为什么计算机能认出图片？')).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(
      page.getByText('AI 老师暂时无法连接，请稍后重试。', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot('chat-unavailable-mobile.png', {
      animations: 'disabled',
      fullPage: true,
    });
  });
});
