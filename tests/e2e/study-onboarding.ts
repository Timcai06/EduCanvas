import { expect, type Page } from '@playwright/test';

/** 通过真实 Server Actions 完成 P1 学习计划与短诊断，不在测试里伪造数据库状态。 */
export async function openLearningWorkspace(page: Page): Promise<void> {
  // The onboarding helper verifies the real Server Action flow, not entrance
  // animation timing. Use the supported reduced-motion path so a saturated CI
  // runner cannot leave GSAP-managed controls unstable for pointer actionability.
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
    const startButton = page.getByRole('button', {
      name: '开始',
      exact: true,
    });
    await startButton.focus();
    await expect(startButton).toBeFocused();
    await page.keyboard.press('Enter');
  }

  const diagnosticHeading = page.getByRole('heading', {
    name: '找到最适合你的起点',
  });
  await expect(diagnosticHeading.or(composer)).toBeVisible();
  if (await composer.isVisible()) return;
  const groups = page.locator('fieldset');
  const count = await groups.count();
  for (let index = 0; index < count; index += 1) {
    /* 诊断只是共享 setup，不验证选项卡的指针动画。慢 runner 曾让 label 的
       Playwright 稳定性检测单次等待 28s；直接 check 原生 radio 仍触发真实
       change/React 状态，同时不把整条 smoke 的预算耗在无关的布局稳定性上。 */
    await groups.nth(index).getByRole('radio').first().check({ force: true });
  }
  await page.getByRole('button', { name: '提交并进入学习' }).click();

  await expect(composer).toBeVisible();
}
