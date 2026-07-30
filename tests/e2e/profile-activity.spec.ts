import { expect, test } from '@playwright/test';

/** 合成合法 Activity 响应 */
function okActivity(activeDays = 5) {
  const days = [];
  for (let i = 0; i < 371; i++) {
    const d = new Date(Date.UTC(2026, 6, 24));
    d.setUTCDate(d.getUTCDate() - 370 + i);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    days.push({ date: key, count: activeDays > 0 && i === 370 ? 1 : 0 });
  }
  return {
    activity: { days, totalSessions: activeDays, activeDays, streakDays: activeDays, masteryPercent: 72 },
  };
}

test.describe('档案活动 E2E', () => {
  test('Activity 成功后统计可见且 busy 结束', async ({ page }) => {
    await page.route('**/api/v1/me/activity', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(okActivity(5)) }),
    );
    await page.goto('/');

    // 打开档案抽屉
    const trigger = page.locator('button[aria-haspopup="dialog"]').first();
    await trigger.click();
    await expect(page.getByRole('heading', { name: '我的档案' })).toBeVisible();

    // 等待活动数据展示
    await expect(page.getByRole('button', { name: '查看完整档案' })).toBeVisible();
    // busy 结束：aria-busy 应为 false
    const statArea = page.locator('[data-sheet-item] [aria-busy="false"]');
    await expect(statArea).toBeVisible({ timeout: 10000 });

    // 连续天数和活跃天数可见（由 CountUp 渲染数字）
    await expect(page.getByText('5', { exact: false })).toBeVisible();
  });

  test('第一次返回 500 时出现安全失败提示和重试按钮', async ({ page }) => {
    let firstCall = true;
    await page.route('**/api/v1/me/activity', (route) => {
      if (firstCall) {
        firstCall = false;
        return route.fulfill({ status: 500, body: 'Internal Server Error' });
      }
      return route.fulfill({ status: 200, body: JSON.stringify(okActivity(5)) });
    });

    await page.goto('/');
    const trigger = page.locator('button[aria-haspopup="dialog"]').first();
    await trigger.click();
    await expect(page.getByRole('heading', { name: '我的档案' })).toBeVisible();

    // 出现安全失败提示（固定文案，不是原始 500 body）
    const failMsg = page.locator('text=暂时无法加载学习活动');
    await expect(failMsg).toBeVisible({ timeout: 10000 });

    // busy 结束
    const statArea = page.locator('[data-sheet-item] [aria-busy]');
    await expect(statArea).toHaveAttribute('aria-busy', 'false');

    // 重试按钮可见
    const retryBtn = page.getByRole('button', { name: '重试' });
    await expect(retryBtn).toBeVisible();
  });

  test('点击重试后返回合法响应并恢复统计', async ({ page }) => {
    let firstCall = true;
    await page.route('**/api/v1/me/activity', (route) => {
      if (firstCall) {
        firstCall = false;
        return route.fulfill({ status: 500 });
      }
      return route.fulfill({ status: 200, body: JSON.stringify(okActivity(3)) });
    });

    await page.goto('/');
    const trigger = page.locator('button[aria-haspopup="dialog"]').first();
    await trigger.click();
    await expect(page.getByRole('heading', { name: '我的档案' })).toBeVisible();

    // 等待失败出现
    await expect(page.getByText('暂时无法加载学习活动')).toBeVisible({ timeout: 10000 });

    // 点击重试
    await page.getByRole('button', { name: '重试' }).click();

    // 失败提示消失，统计恢复
    await expect(page.getByText('暂时无法加载学习活动')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText('3', { exact: false })).toBeVisible();
  });

  test('响应含敏感信息时页面不得显示', async ({ page }) => {
    // 模拟一个成功的 API 响应，但返回体中嵌入了敏感的诱饵字符串
    // 这种场景下，schema 校验会失败，但关键是不直接渲染 body
    await page.route('**/api/v1/me/activity', (route) =>
      route.fulfill({
        status: 500,
        body: JSON.stringify({
          error: {
            code: 'activity_unavailable',
            message: '暂时无法加载学习活动',
            actualError: 'postgres://user:password@localhost:5432/db',
            stack: 'Error: at Server.run (/app/server.js:123:45)',
          },
        }),
      }),
    );

    await page.goto('/');
    const trigger = page.locator('button[aria-haspopup="dialog"]').first();
    await trigger.click();
    await expect(page.getByRole('heading', { name: '我的档案' })).toBeVisible();

    // 等待失败消息出现
    await expect(page.getByText('暂时无法加载学习活动')).toBeVisible({ timeout: 10000 });

    // 确保页面不包含诱饵敏感信息
    const pageText = await page.locator('[role="dialog"]').innerText();
    expect(pageText).not.toContain('postgres://');
    expect(pageText).not.toContain('password');
    expect(pageText).not.toContain('ECONNREFUSED');
  });

  test('320px 窄屏不产生横向溢出，重试按钮可键盘操作', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 600 });
    let firstCall = true;
    await page.route('**/api/v1/me/activity', (route) => {
      if (firstCall) {
        firstCall = false;
        return route.fulfill({ status: 500 });
      }
      return route.fulfill({ status: 200, body: JSON.stringify(okActivity(5)) });
    });

    await page.goto('/');
    const trigger = page.locator('button[aria-haspopup="dialog"]').first();
    await trigger.click();
    await expect(page.getByRole('heading', { name: '我的档案' })).toBeVisible();

    // 等待失败和重试按钮
    const retryBtn = page.getByRole('button', { name: '重试' });
    await expect(retryBtn).toBeVisible({ timeout: 10000 });

    // 重试按钮可通过 Tab 聚焦且 Enter/Space 触发
    await retryBtn.focus();
    await expect(retryBtn).toBeFocused();
    await retryBtn.press('Enter');

    // 重试后恢复
    await expect(page.getByText('暂时无法加载学习活动')).not.toBeVisible({ timeout: 10000 });

    // 窄屏无横向溢出：body/clientWidth <= viewport
    const bodyWidth = await page.evaluate(() => document.body.clientWidth);
    expect(bodyWidth).toBeLessThanOrEqual(320);
  });
});
