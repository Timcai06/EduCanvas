import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * Chat-first 布局下 Canvas 与进度均按需打开：Canvas 经对话中的「打开互动演示」，
 * 进度经顶栏徽章展开抽屉。安全与幂等断言（Cookie 隔离、判分键不泄漏、重复提交
 * 只计一次）与布局无关，保持不变。
 */

function canvasRegion(page: Page) {
  return page.getByRole('region', { name: '教学Canvas' });
}

async function startLearning(page: Page) {
  await page.goto('/learn');
  await page.getByRole('button', { name: '开始学习' }).click();
  await expect(
    page.getByRole('button', { name: '打开互动演示' }),
  ).toBeVisible();
}

/** 从对话建议卡进入 Chat+Canvas 协作态。 */
async function openCanvasFromChat(page: Page) {
  await page.getByRole('button', { name: '打开互动演示' }).click();
  await expect(canvasRegion(page)).toBeVisible();
}

/** 打开进度抽屉并返回其中的可信进度区域。 */
async function openProgress(page: Page) {
  await page.getByRole('button', { name: /学习进度/ }).click();
  const progress = page.getByRole('region', { name: '学习进度' });
  await expect(progress).toBeVisible();
  return progress;
}

async function closeSheet(page: Page) {
  await page.keyboard.press('Escape');
}

async function completeVisibleArtifact(canvas: Locator) {
  const submit = canvas.getByRole('button', { name: /提交/ });
  const choices = canvas.getByRole('radio');
  const choiceCount = await choices.count();

  expect(choiceCount, 'Canvas 至少应提供一个可访问的单选项').toBeGreaterThan(0);
  const completedGroups = new Set<string>();
  for (let index = 0; index < choiceCount; index += 1) {
    const choice = choices.nth(index);
    const groupName = await choice.getAttribute('name');
    if (!groupName || completedGroups.has(groupName)) continue;
    await choice.check();
    completedGroups.add(groupName);
  }

  await expect(submit).toBeEnabled();
  return submit;
}

test('首次访问创建隔离的匿名 HttpOnly Cookie', async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();

  try {
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();
    await startLearning(firstPage);
    await startLearning(secondPage);

    const firstCookies = (await firstContext.cookies()).filter(
      (cookie) => cookie.httpOnly && cookie.path === '/',
    );
    const secondCookies = (await secondContext.cookies()).filter(
      (cookie) => cookie.httpOnly && cookie.path === '/',
    );

    expect(firstCookies).toHaveLength(1);
    expect(secondCookies).toHaveLength(1);
    expect(firstCookies[0]).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
    });
    expect(firstCookies[0]?.name).toBe('__Host-educanvas_anonymous_identity');
    expect(secondCookies[0]?.name).toBe(firstCookies[0]?.name);
    expect(secondCookies[0]?.value).not.toBe(firstCookies[0]?.value);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

test('Canvas 提交后展示反馈并持久化 Progress', async ({ page }) => {
  await startLearning(page);
  await openCanvasFromChat(page);
  const canvas = canvasRegion(page);

  expect(await page.content()).not.toMatch(
    /correctCategoryId|correctOptionId|gradingKey/,
  );
  const submit = await completeVisibleArtifact(canvas);
  await submit.click();

  await expect(canvas.getByRole('status').first()).toContainText('本次答对');

  const progress = await openProgress(page);
  await expect(progress).toContainText(/已作答\s*[:：]?\s*2/);
  await closeSheet(page);

  await page.reload();
  const progressAfterReload = await openProgress(page);
  await expect(progressAfterReload).toContainText(/已作答\s*[:：]?\s*2/);
});

test('快速重复操作在界面只增加一次 Progress', async ({ page }) => {
  await startLearning(page);
  await openCanvasFromChat(page);
  const submit = await completeVisibleArtifact(canvasRegion(page));

  await submit.dblclick();
  const progress = await openProgress(page);
  await expect(progress).toContainText(/已作答\s*[:：]?\s*2/);
  await closeSheet(page);

  await page.reload();
  const progressAfterReload = await openProgress(page);
  await expect(progressAfterReload).toContainText(/已作答\s*[:：]?\s*2/);
});

test('篡改匿名 Cookie 后不能访问原会话', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const forgedContext = await browser.newContext();

  try {
    const ownerPage = await ownerContext.newPage();
    await startLearning(ownerPage);
    await openCanvasFromChat(ownerPage);
    const submit = await completeVisibleArtifact(canvasRegion(ownerPage));
    await submit.click();
    await expect(
      canvasRegion(ownerPage).getByRole('status').first(),
    ).toContainText('本次答对');

    const [ownerCookie] = (await ownerContext.cookies()).filter(
      (cookie) => cookie.httpOnly && cookie.path === '/',
    );
    expect(ownerCookie).toBeDefined();
    const replacement = ownerCookie!.value.startsWith('A') ? 'B' : 'A';
    const forgedValue = `${replacement}${ownerCookie!.value.slice(1)}`;
    await forgedContext.addCookies([
      {
        ...ownerCookie!,
        value: forgedValue,
      },
    ]);

    const forgedPage = await forgedContext.newPage();
    await forgedPage.goto('/learn');
    await expect(
      forgedPage.getByRole('button', { name: '开始学习' }),
    ).toBeVisible();
    await expect(canvasRegion(forgedPage)).toHaveCount(0);
    await forgedPage.getByRole('button', { name: '开始学习' }).click();
    await expect(
      forgedPage.getByRole('button', { name: '打开互动演示' }),
    ).toBeVisible();
    const [rotatedCookie] = (await forgedContext.cookies()).filter(
      (cookie) => cookie.name === ownerCookie!.name,
    );
    expect(rotatedCookie?.value).not.toBe(forgedValue);
    expect(rotatedCookie?.value).not.toBe(ownerCookie!.value);

    await ownerPage.reload();
    const ownerProgress = await openProgress(ownerPage);
    await expect(ownerProgress).toContainText(/已作答\s*[:：]?\s*2/);
  } finally {
    await ownerContext.close();
    await forgedContext.close();
  }
});
