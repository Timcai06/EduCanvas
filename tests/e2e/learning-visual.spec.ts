import { expect, test } from '@playwright/test';

test.describe('学习页视觉基线', () => {
  test('桌面端深色 Chat-empty', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/learn');

    await expect(
      page.getByRole('heading', { name: '你好，今天想探索什么？' }),
    ).toBeVisible();
    await expect(page.locator('.ambient-halo__layer')).toHaveCount(3);
    await expect(page).toHaveScreenshot('chat-empty-desktop-dark.png', {
      animations: 'disabled',
      fullPage: true,
    });
  });

  test('移动端深色 Chat-empty 降级为单动画核心', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/learn');

    await expect(
      page.getByRole('heading', { name: '你好，今天想探索什么？' }),
    ).toBeVisible();
    await expect(page.locator('.ambient-halo__bloom')).toBeHidden();
    await expect(page).toHaveScreenshot('chat-empty-mobile-dark.png', {
      animations: 'disabled',
      fullPage: true,
    });
  });

  test('reduced-motion 的 Halo 在五秒后保持像素稳定', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/learn');
    await expect(
      page.getByRole('heading', { name: '你好，今天想探索什么？' }),
    ).toBeVisible();

    const first = await page.screenshot({ animations: 'disabled' });
    await page.waitForTimeout(5_000);
    const second = await page.screenshot({ animations: 'disabled' });
    expect(second.equals(first)).toBe(true);
  });

  test('移动端真实 AI 未接入状态', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/learn');

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
    await expect(page).toHaveScreenshot('chat-unavailable-mobile-dark.png', {
      animations: 'disabled',
      fullPage: true,
    });
  });
});
