import { expect, type Page } from '@playwright/test';

/** 通过真实 Server Actions 完成 P1 学习计划与短诊断，不在测试里伪造数据库状态。 */
export async function openLearningWorkspace(page: Page): Promise<void> {
  await page.goto('/learn');
  await completeStudyOnboarding(page);
}

/** 在当前页面完成可能出现的画像/诊断步骤；不主动导航，避免打断进行中的 Server Action。 */
export async function completeStudyOnboarding(page: Page): Promise<void> {
  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  if (await composer.isVisible()) return;

  const setupHeading = page.getByRole('heading', {
    name: '先说目标，再由 AI 老师决定从哪里开始。',
  });
  if (await setupHeading.isVisible()) {
    await page.getByRole('button', { name: '开始短诊断' }).click();
  }

  const notebookSetupHeading = page.getByRole('heading', {
    name: '今天想学会什么？',
  });
  if (await notebookSetupHeading.isVisible()) {
    await page
      .getByRole('textbox', { name: '这次想学会什么' })
      .fill('理解图像 AI 如何根据特征完成分类');
    await page.getByRole('button', { name: '开始', exact: true }).click();
  }

  const diagnosticHeading = page.getByRole('heading', {
    name: '找到最适合你的起点',
  });
  await expect(diagnosticHeading.or(composer)).toBeVisible();
  if (await composer.isVisible()) return;
  const groups = page.locator('fieldset');
  const count = await groups.count();
  for (let index = 0; index < count; index += 1) {
    await groups.nth(index).locator('label').first().click();
  }
  await page.getByRole('button', { name: '提交并进入学习' }).click();

  await expect(composer).toBeVisible();
}
