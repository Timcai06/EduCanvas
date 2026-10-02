import { expect, test } from '@playwright/test';

test('/login 抽屉可通过鼠标切换登录与注册模式', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login', { waitUntil: 'load' });

  const loginDialog = page.getByRole('dialog', { name: '继续学习旅程' });
  await expect(loginDialog).toBeVisible();
  await loginDialog.getByRole('button', { name: '第一次来？创建账号' }).click();

  const registerDialog = page.getByRole('dialog', { name: '创建你的账号' });
  await expect(registerDialog).toBeVisible();
  const returnToLogin = registerDialog.getByRole('button', {
    name: '已有账号？返回登录',
  });
  await expect(returnToLogin).toBeVisible();
  await returnToLogin.click();

  await expect(loginDialog).toBeVisible();
  await expect(
    loginDialog.getByRole('button', { name: '第一次来？创建账号' }),
  ).toBeVisible();
});
