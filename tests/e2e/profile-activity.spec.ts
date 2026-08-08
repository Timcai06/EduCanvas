import { expect, test, type Page } from '@playwright/test';

function okActivity(activeDays = 5) {
  const today = new Date();
  const days = Array.from({ length: 371 }, (_value, index) => {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    date.setUTCDate(date.getUTCDate() - 370 + index);
    return {
      date: date.toISOString().slice(0, 10),
      count: activeDays > 0 && index === 370 ? 1 : 0,
    };
  });

  return {
    activity: {
      days,
      totalSessions: activeDays,
      activeDays,
      streakDays: activeDays,
      masteryPercent: 72,
    },
  };
}

async function openProfile(page: Page) {
  // UserMenu owns this deep link so the test does not guess which generic dialog
  // trigger happens to render first for an anonymous or authenticated fixture.
  await page.goto('/?profile=1');
  await expect(page.getByRole('heading', { name: '我的档案' })).toBeVisible();
}

test.describe('档案活动', () => {
  test('@ui 档案抽屉占据全局模态层并遮住工作区', async ({ page }) => {
    await openProfile(page);

    const dialog = page.getByRole('dialog', { name: '我的档案' });
    const modalRoot = dialog.locator('..');
    await expect(modalRoot).toHaveClass(/\bfixed\b/);
    await expect(modalRoot).toHaveClass(/\bz-50\b/);

    expect(
      await modalRoot.evaluate(
        (element) => element.parentElement === document.body,
      ),
    ).toBe(true);

    const overlay = page.getByRole('button', { name: '关闭面板' });
    expect(
      await overlay.evaluate(
        (element) =>
          document.elementFromPoint(20, window.innerHeight / 2) === element,
      ),
    ).toBe(true);
  });

  test('@smoke 打开档案后投影可信活动统计', async ({ page }) => {
    await page.route('**/api/v1/me/activity', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okActivity(5)),
      }),
    );

    await openProfile(page);

    const activity = page.locator('[data-sheet-item]').filter({
      has: page.getByText('掌握度', { exact: true }),
    });
    await expect(activity.locator('[aria-busy]')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await expect(activity.getByText('连续', { exact: true })).toBeVisible();
    await expect(activity.getByText('活跃', { exact: true })).toBeVisible();
    await expect(activity.getByText('掌握度', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '查看完整档案' }),
    ).toBeVisible();
  });

  test('失败只显示稳定文案且可重试恢复', async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/v1/me/activity', (route) => {
      attempts += 1;
      if (attempts === 1) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'activity_unavailable',
              message: 'postgres://user:password@localhost:5432/private',
              stack: 'Error: private stack',
            },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okActivity(3)),
      });
    });

    await openProfile(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('暂时无法加载学习活动')).toBeVisible();
    await expect(dialog).not.toContainText('postgres://');
    await expect(dialog).not.toContainText('private stack');

    await dialog.getByRole('button', { name: '重试' }).click();

    await expect(dialog.getByText('暂时无法加载学习活动')).toBeHidden();
    await expect(dialog.locator('[aria-busy]')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    expect(attempts).toBe(2);
  });
});
