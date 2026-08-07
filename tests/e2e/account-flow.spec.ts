import { expect, test } from '@playwright/test';

// 超长真实链路：注册 + 双上下文登录 + 改档 + 改密 + 会话撤销 + 两次重登，
// 含多次 bcrypt 哈希与 ~20 次服务端往返，本地实测 ~30s 恰好压住默认 30s
// 上限；CI runner 负载波动（如 2026-08-07 Actions 故障恢复期）即超时。
// 60s 预算与流程真实耗时匹配（Q05 门禁：预算真实，不靠无限 retry）。
// 注意：Playwright 的 test(title, details, body) 不支持 details.timeout，
// 必须用 test.setTimeout()。
test('账号注册、资料更新、改密码和会话撤销走真实服务端链路', async ({
  browser,
  page,
}) => {
  test.setTimeout(60_000);
  const suffix = Date.now().toString(36);
  const username = `e2e_user_${suffix}`;
  const nickname = '初始昵称';
  const updatedNickname = '新昵称';
  const oldPassword = 'OldPassword123!';
  const newPassword = 'NewPassword456!';
  const loginTrigger = (target: typeof page) =>
    target.locator('button[aria-haspopup="dialog"]', {
      hasText: /^登录$/,
    });

  await page.goto('/register');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('昵称').fill(nickname);
  await page.getByLabel('密码', { exact: true }).fill(oldPassword);
  await expect(page.getByText('密码风险等级：')).toContainText('低风险');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(
    page.getByRole('heading', { name: '今天想学什么？' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: nickname })).toBeVisible();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  try {
    await secondPage.goto('/login');
    await secondPage.getByLabel('用户名').fill(username);
    await secondPage.getByLabel('密码', { exact: true }).fill(oldPassword);
    await secondPage
      .locator('form')
      .getByRole('button', { name: '登录', exact: true })
      .click();
    await expect(
      secondPage.getByRole('heading', { name: '今天想学什么？' }),
    ).toBeVisible();
    await expect(
      secondPage.getByRole('button', { name: nickname }),
    ).toBeVisible();

    await page.getByRole('button', { name: nickname }).click();
    await expect(page.getByRole('heading', { name: '我的档案' })).toBeVisible();
    await page.locator('summary').filter({ hasText: '账号与头像' }).click();
    await page.getByRole('textbox', { name: '昵称' }).fill(updatedNickname);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('昵称已更新。')).toBeVisible();

    await page.getByLabel('当前密码', { exact: true }).fill(oldPassword);
    await page.getByLabel('新密码', { exact: true }).fill(newPassword);
    await page.getByLabel('确认新密码', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: '更新密码' }).click();
    await expect(
      page.getByText('密码已更新，其他设备需要重新登录。'),
    ).toBeVisible();

    await secondPage.reload();
    await expect(loginTrigger(secondPage)).toBeVisible();

    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '今天想学什么？' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: updatedNickname }),
    ).toBeVisible();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(loginTrigger(page)).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码', { exact: true }).fill(oldPassword);
    const loginForm = page.locator('form');
    await loginForm.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByText('用户名或密码不正确。')).toBeVisible();

    await page.getByLabel('密码', { exact: true }).fill(newPassword);
    await loginForm.getByRole('button', { name: '登录', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '今天想学什么？' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: updatedNickname }),
    ).toBeVisible();
  } finally {
    await secondContext.close();
  }
});
