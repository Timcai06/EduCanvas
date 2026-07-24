import { expect, test } from '@playwright/test';

test('账号注册、资料更新、改密码和会话撤销走真实服务端链路', async ({
  browser,
  page,
}) => {
  const suffix = Date.now().toString(36);
  const username = `e2e_user_${suffix}`;
  const nickname = '初始昵称';
  const updatedNickname = '新昵称';
  const oldPassword = 'OldPassword123!';
  const newPassword = 'NewPassword456!';

  await page.goto('/register');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('昵称').fill(nickname);
  await page.getByLabel('密码').fill(oldPassword);
  await expect(page.getByText('密码风险等级：')).toContainText('低风险');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(
    page.getByRole('heading', { name: `Hi ${nickname}，今天想学什么？` }),
  ).toBeVisible();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  try {
    await secondPage.goto('/login');
    await secondPage.getByLabel('用户名').fill(username);
    await secondPage.getByLabel('密码').fill(oldPassword);
    await secondPage.getByRole('button', { name: '登录' }).click();
    await expect(
      secondPage.getByRole('heading', {
        name: `Hi ${nickname}，今天想学什么？`,
      }),
    ).toBeVisible();

    await page.goto('/settings');
    await page.getByLabel('昵称').fill(updatedNickname);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('昵称已更新。')).toBeVisible();

    await page.getByLabel('当前密码').fill(oldPassword);
    await page.getByLabel('新密码').fill(newPassword);
    await page.getByLabel('确认新密码').fill(newPassword);
    await page.getByRole('button', { name: '更新密码' }).click();
    await expect(
      page.getByText('密码已更新，其他设备需要重新登录。'),
    ).toBeVisible();

    await secondPage.reload();
    await expect(secondPage.getByRole('link', { name: '登录' })).toBeVisible();

    await page.getByRole('link', { name: '返回对话' }).click();
    await expect(
      page.getByRole('heading', {
        name: `Hi ${updatedNickname}，今天想学什么？`,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('link', { name: '登录' })).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码').fill(oldPassword);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByText('用户名或密码不正确。')).toBeVisible();

    await page.getByLabel('密码').fill(newPassword);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(
      page.getByRole('heading', {
        name: `Hi ${updatedNickname}，今天想学什么？`,
      }),
    ).toBeVisible();
  } finally {
    await secondContext.close();
  }
});
