import { expect, test, type Locator, type Page } from '@playwright/test';

function learningRegions(page: Page) {
  return {
    canvas: page.getByRole('region', { name: '教学Canvas' }),
    progress: page.getByRole('region', { name: '学习进度' }),
  };
}

async function startLearning(page: Page) {
  await page.goto('/learn');
  await page.getByRole('button', { name: '开始学习' }).click();
  await expect(page.getByRole('region', { name: '教学Canvas' })).toBeVisible();
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
  const { canvas, progress } = learningRegions(page);

  await expect(canvas).toBeVisible();
  await expect(progress).toBeVisible();
  expect(await page.content()).not.toMatch(
    /correctCategoryId|correctOptionId|gradingKey/,
  );
  const submit = await completeVisibleArtifact(canvas);
  await submit.click();

  await expect(canvas.getByRole('status')).toContainText('本次答对');
  await expect(progress).toContainText(/已作答\s*[:：]?\s*2/);

  await page.reload();
  await expect(progress).toContainText(/已作答\s*[:：]?\s*2/);
});

test('快速重复操作在界面只增加一次 Progress', async ({ page }) => {
  await startLearning(page);
  const { canvas, progress } = learningRegions(page);
  const submit = await completeVisibleArtifact(canvas);

  await submit.dblclick();
  await expect(progress).toContainText(/已作答\s*[:：]?\s*2/);

  await page.reload();
  await expect(progress).toContainText(/已作答\s*[:：]?\s*2/);
});

test('篡改匿名 Cookie 后不能访问原会话', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const forgedContext = await browser.newContext();

  try {
    const ownerPage = await ownerContext.newPage();
    await startLearning(ownerPage);
    const ownerRegions = learningRegions(ownerPage);
    const submit = await completeVisibleArtifact(ownerRegions.canvas);
    await submit.click();
    await expect(ownerRegions.progress).toContainText(/已作答\s*[:：]?\s*2/);

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
    await expect(
      forgedPage.getByRole('region', { name: '教学Canvas' }),
    ).toHaveCount(0);
    await forgedPage.getByRole('button', { name: '开始学习' }).click();
    await expect(
      forgedPage.getByRole('region', { name: '教学Canvas' }),
    ).toBeVisible();
    const [rotatedCookie] = (await forgedContext.cookies()).filter(
      (cookie) => cookie.name === ownerCookie!.name,
    );
    expect(rotatedCookie?.value).not.toBe(forgedValue);
    expect(rotatedCookie?.value).not.toBe(ownerCookie!.value);

    await ownerPage.reload();
    await expect(ownerRegions.progress).toContainText(/已作答\s*[:：]?\s*2/);
  } finally {
    await ownerContext.close();
    await forgedContext.close();
  }
});
